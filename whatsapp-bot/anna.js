// «Менеджер Анна» в учёте: сводка дня для виджета на главной и ответы на вопросы сотрудников.
// Сводка — документ wa_anna/digest; учёт просит обновить её через wa_anna/request (кнопка «Обновить»),
// вопросы сотрудники пишут в коллекцию wa_anna_q, Анна отвечает в поле a. Всё на бесплатном Gemini.

import { GEMINI_MODELS, SERVICE_NAMES, openOrders } from './brain.js';

const DAY = 24 * 3600e3;
const MORNING = 9;                          // с 9 утра по Алматы готовим сводку на день (один раз, если компьютер включён)
const ST = { new: 'новый', design: 'макет', prod: 'в производстве', ready: 'готов, ждёт клиента' };

const PERSONA = `Ты Анна, виртуальный менеджер студии брендирования «Разгуляев». Ты отвечаешь клиентам в WhatsApp,
а сейчас говоришь с командой студии в их учёте: руководитель Евгений и менеджер Милана.
Говори как живой толковый коллега: коротко, по-деловому, по-дружески, на русском, без канцелярита и без markdown.
Опирайся только на данные ниже, ничего не выдумывай. Называй клиентов и заказы по имени клиента; служебные id в квадратных скобках никогда не показывай.`;

// Время Казахстана (UTC+5) как объект Date с «местными» UTC-полями
const kz = (t = Date.now()) => new Date(t + 5 * 3600e3);

/* ---------- данные для Анны ---------- */

async function collect(fs) {
  const now = Date.now();
  const chats = (await fs.list('wa_chats')).filter(c => now - (c.updatedAt || 0) < DAY);
  const orders = await openOrders(fs);
  const today = kz().toISOString().slice(0, 10);
  const name = c => c.name || (c.phone ? '+' + c.phone : 'Клиент');
  const needManager = chats.filter(c => c.needsManager)
    .sort((a, b) => (a.managerCalledAt || 0) - (b.managerCalledAt || 0))
    .map(c => ({ id: c.id, name: c.name || '', phone: c.phone || '', reason: c.managerReason || '', since: c.managerCalledAt || c.updatedAt || now }));
  const kaspi = await kaspiToDo(fs);
  const tasks = (await fs.query('tasks', { where: { fieldFilter: { field: { fieldPath: 'done' }, op: 'EQUAL', value: { booleanValue: false } } } }).catch(() => []))
    .sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9'))).slice(0, 30)
    .map(t => `[задача ${t.id}] ${t.date || 'без даты'}${t.time ? ' ' + t.time : ''}: ${t.title || ''}${t.who ? ' (' + t.who + ')' : ''}`).join('\n');
  const botOrders = orders.filter(o => o.source === 'whatsapp' && o.status === 'new');
  const voice = chats.reduce((n, c) => n + (c.messages || []).filter(m => now - (m.at || 0) < DAY && /^\[голосовое сообщение\]/.test(m.text || '')).length, 0);
  const stats = { chats: chats.length, botOrders: botOrders.length, needManager: needManager.length, voice };

  // Компактный текст для ИИ: диалоги за сутки и открытые заказы
  const dialogs = chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 25).map(c => {
    const who = { client: 'клиент', bot: 'Анна', manager: 'менеджер', notice: 'уведомление' };
    const tail = (c.messages || []).slice(-6).map(m => `  ${who[m.role] || m.role}: ${String(m.text || '').slice(0, 220)}`).join('\n');
    const flags = [c.needsManager ? `ЖДЁТ МЕНЕДЖЕРА (${c.managerReason || 'без причины'})` : '', c.lastRole === 'client' ? 'последним писал клиент' : ''].filter(Boolean).join(', ');
    return `[чат ${c.id}] ${name(c)}${flags ? ' — ' + flags : ''}\n${tail}`;
  }).join('\n\n');
  const list = orders.sort((a, b) => String(a.deadline || '9').localeCompare(String(b.deadline || '9'))).slice(0, 40).map(o =>
    `[заказ ${o.id}] ${o.client || 'без имени'}: ${SERVICE_NAMES[o.service] || o.customService || o.service || ''}, ${ST[o.status] || o.status}` +
    `, срок ${o.deadline || 'не назначен'}${o.deadline && o.deadline < today ? ' (ПРОСРОЧЕН)' : o.deadline === today ? ' (СЕГОДНЯ)' : ''}` +
    `${o.source === 'whatsapp' && o.status === 'new' ? ', оформила Анна — нужно подтвердить' : ''}${o.desc ? ' — ' + String(o.desc).slice(0, 120) : ''}`).join('\n');
  const d = kz();
  const facts = `Сейчас ${d.toISOString().slice(0, 16).replace('T', ' ')} по Алматы.
Статистика за сутки: диалогов ${stats.chats}, ждут менеджера ${stats.needManager}, заказов от Анны ждут подтверждения ${stats.botOrders}, голосовых ${voice}.

Диалоги WhatsApp за сутки:
${dialogs || 'нет'}

Открытые заказы студии (по сроку):
${list || 'нет'}

Kaspi (по данным учёта, обновляются, когда открыт раздел Kaspi):
${kaspi || 'нет'}

Невыполненные задачи студии:
${tasks || 'нет'}`;
  return { facts, needManager, stats };
}

// Заказы Kaspi из коллекции kaspi_orders (её заполняет учёт, когда открыт раздел Kaspi):
// что собрать и передать курьеру, и сколько Kaspi должен заплатить за отправленное в ближайшую неделю
const KASPI_FEE = 0.30; // как в учёте: примерная комиссия и доставка Kaspi
async function kaspiToDo(fs) {
  const ACTIVE = ['NEW', 'SIGN_REQUIRED', 'PICKUP', 'DELIVERY', 'KASPI_DELIVERY'];
  const list = (await fs.query('kaspi_orders', {
    where: { fieldFilter: { field: { fieldPath: 'state' }, op: 'IN', value: { arrayValue: { values: ACTIVE.map(v => ({ stringValue: v })) } } } },
  }).catch(() => [])).filter(k => !k.returned && !['CANCELLED', 'CANCELLING', 'COMPLETED'].includes(k.status));
  const day = t => t ? kz(+t).toISOString().slice(0, 10) : '';
  const what = k => (k.items || []).map(i => (i.name || 'товар') + (i.qty > 1 ? ' × ' + i.qty : '')).join(', ') || 'заказ ' + k.code;
  const money = n => Math.round(n).toLocaleString('ru-RU') + ' ₸';
  const shipped = k => k.transmitted || ((k.assembled || k.waybill) && k.state !== 'KASPI_DELIVERY');
  const todo = list.filter(k => !shipped(k))
    .sort((a, b) => (+a.transmitPlan || +a.created || 0) - (+b.transmitPlan || +b.created || 0)).slice(0, 25)
    .map(k => `[kaspi ${k.id}] ${what(k)} — ${k.assembled || k.waybill ? 'собран, передать курьеру' : 'собрать'}` +
      `${k.transmitPlan ? ', передать до ' + day(k.transmitPlan) : ''}${k.customer ? ', покупатель ' + k.customer : ''}`);
  const week = Date.now() + 7 * DAY;
  const pay = list.filter(shipped).map(k => ({ k, at: +k.plannedDelivery || +k.transmitPlan || 0 })).filter(p => p.at && p.at <= week)
    .sort((a, b) => a.at - b.at);
  const total = pay.reduce((s, p) => s + (+p.k.total || 0), 0);
  const payText = pay.length ? pay.map(p => `${day(p.at)}: ${what(p.k)} — ${money(p.k.total || 0)}`).join('\n') +
    `\nИтого за неделю: ${money(total)}, на руки примерно ${money(total * (1 - KASPI_FEE))} (минус ~${KASPI_FEE * 100}% комиссии и доставки)` : 'нет';
  return `Собрать: ${todo.filter(t => t.includes('— собрать')).length}, передать курьеру: ${todo.filter(t => t.includes('передать курьеру')).length}\n` +
    (todo.join('\n') || 'нет') + `\n\nKaspi заплатит в ближайшие 7 дней (отправленные заказы, по плановой дате доставки):\n${payText}`;
}

/* ---------- 3D-принтеры (воркер bambu-watch, тот же, что на главной учёта) ---------- */

const PRINT_API = 'https://bambu-watch.design-onegin.workers.dev/api/status';
const PSTATE = { RUNNING: 'печатает', PRINTING: 'печатает', PREPARE: 'готовится к печати', SLICING: 'готовится к печати', PAUSE: 'на паузе', PAUSED: 'на паузе', FINISH: 'свободен, печать завершена', FAILED: 'ошибка печати', IDLE: 'свободен' };
export const printerBusy = p => !!p && p.online !== false && ['RUNNING', 'PRINTING', 'PREPARE', 'SLICING', 'PAUSE', 'PAUSED'].includes(String(p.state || '').toUpperCase());
export async function printers() {
  try { return (await (await fetch(PRINT_API, { cache: 'no-store' })).json()).printers || []; } catch (_) { return null; }
}
async function printerFacts() {
  const list = await printers();
  if (!list) return 'нет связи с принтерами';
  return list.map(p => {
    const st = p.online === false ? 'не в сети' : PSTATE[String(p.state || '').toUpperCase()] || 'в сети';
    const pc = printerBusy(p) && p.progress != null && p.progress !== '' ? `, готово ${Math.round(+p.progress)}%` : '';
    const rem = printerBusy(p) && +p.remain > 0 ? `, осталось ~${Math.round(+p.remain)} мин` : '';
    return `[принтер ${p.name}] ${st}${pc}${rem}${p.errorText ? ', ошибка: ' + p.errorText : ''}`;
  }).join('\n') || 'нет';
}

/* ---------- Gemini ---------- */

async function gemini(env, system, text, json) {
  const key = String(env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('в .env нет GEMINI_API_KEY');
  for (const model of GEMINI_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 4096, ...(json ? { responseMimeType: 'application/json', responseSchema: json } : {}) },
      }),
    });
    if (r.status === 429 || r.status === 503) continue;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Gemini ответил ' + r.status));
    return (j.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  }
  throw new Error('бесплатный лимит Gemini исчерпан');
}

/* ---------- сводка дня ---------- */

export async function makeDigest(fs, env) {
  const { facts, needManager, stats } = await collect(fs);
  const raw = await gemini(env, PERSONA + `
Подготовь сводку для главной страницы учёта:
- summary: 2–5 предложений от первого лица, как будто ты рассказываешь команде, что было и что важно сегодня
  (сколько обращений, о чём чаще спрашивали, кто ждёт ответа, какие заказы горят, что по Kaspi). Начни с приветствия по времени суток.
- todo: до 6 конкретных дел на сегодня в повелительном наклонении, самое срочное первым: ответить клиентам, подтвердить заказы от Анны,
  просроченные и сегодняшние заказы, собрать и передать заказы Kaspi; если срочного мало — предложи, чем полезно заняться.
  Заказы называй по имени клиента, без номеров («Сдать заказ Калинина», «Собрать на Kaspi 2 топпера»).
  Если дело про заказ студии — укажи его id из [заказ …] в orderId; если про Kaspi — id из [kaspi …] в kaspiId.
  Не предлагай «прослушать/проверить голосовые»: голосовые уже расшифрованы, их текст в диалогах.
- waiting: для каждого чата с пометкой ЖДЁТ МЕНЕДЖЕРА — chatId из [чат …] и brief: 1–3 предложения от тебя, что хочет клиент
  (товар, количество, сроки, вопросы, что прислал), чтобы менеджеру не читать весь чат.
Никогда не пиши в тексте служебные id.`, facts, {
    type: 'OBJECT',
    properties: {
      summary: { type: 'STRING' },
      todo: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, orderId: { type: 'STRING' }, kaspiId: { type: 'STRING' } }, required: ['text'] } },
      waiting: { type: 'ARRAY', items: { type: 'OBJECT', properties: { chatId: { type: 'STRING' }, brief: { type: 'STRING' } }, required: ['chatId', 'brief'] } },
    },
    required: ['summary', 'todo'],
  });
  let out;
  try { out = JSON.parse(raw); } catch (_) { out = { summary: raw, todo: [] }; }
  const briefs = new Map((out.waiting || []).map(w => [String(w.chatId), String(w.brief || '').slice(0, 600)]));
  const known = id => (id && facts.includes(id + ']')) ? String(id) : ''; // ссылки только на настоящие заказы из данных
  const digest = {
    at: Date.now(), summary: String(out.summary || '').slice(0, 1500),
    todo: (out.todo || []).slice(0, 6).map(t => typeof t === 'string' ? { text: t.slice(0, 200) } : {
      text: String(t.text || '').slice(0, 200),
      ...(known(t.orderId) ? { orderId: known(t.orderId) } : {}), ...(known(t.kaspiId) ? { kaspiId: known(t.kaspiId) } : {}),
    }).filter(t => t.text),
    needManager: needManager.slice(0, 8).map(({ id, ...c }) => ({ ...c, ...(briefs.get(id) ? { brief: briefs.get(id) } : {}) })), stats,
  };
  await fs.set('wa_anna/digest', digest);
  return digest;
}

// Нужна ли свежая сводка: попросили кнопкой «Обновить» или наступило утро, а сегодня её ещё не было
export async function digestDue(fs) {
  const [digest, req] = await Promise.all([fs.get('wa_anna/digest'), fs.get('wa_anna/request')]);
  const at = digest?.at || 0;
  if ((req?.refreshAt || 0) > at) return 'по просьбе из учёта';
  const d = kz();
  const morning = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), MORNING) - 5 * 3600e3;
  if (Date.now() >= morning && at < morning) return 'утренняя';
  return '';
}

/* ---------- вопросы сотрудников ---------- */

export async function answerQuestions(fs, env) {
  const qs = await fs.query('wa_anna_q', {
    where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'new' } } }, limit: 5,
  });
  if (!qs.length) return 0;
  const { facts } = await collect(fs);
  for (const q of qs) {
    let a;
    try {
      a = await gemini(env, PERSONA + '\nОтветь сотруднику на вопрос по данным ниже: 1–6 предложений, по делу. Если данных не хватает — честно скажи, чего не знаешь.',
        facts + '\n\nВопрос сотрудника: ' + String(q.q || '').slice(0, 500));
    } catch (e) {
      a = 'Не получилось ответить: ' + String(e?.message || e).slice(0, 200) + '. Спросите ещё раз чуть позже.';
    }
    await fs.patch('wa_anna_q/' + q.id, { a: a.slice(0, 2000) || 'Не знаю, что ответить.', status: 'done', answeredAt: Date.now() });
  }
  return qs.length;
}

/* ---------- Аня в Telegram: вопросы и задачи голосом или текстом ---------- */

// who — как обращаться к сотруднику. Возвращает {reply, task?}; задачу сохраняет в учёт (раздел «Задачи»)
export async function tgAssistant(fs, env, text, who, chat) {
  const facts = (await collect(fs)).facts + '\n\n3D-принтеры в мастерской:\n' + await printerFacts();
  const raw = await gemini(env, PERSONA.replace('Ты Анна', 'Ты Аня (Анна)') + `
Сейчас тебе пишет в Telegram ${who}. Обращайся к нему(ней) именно так: «${who}». Отвечай коротко, как в мессенджере, 1–6 предложений, без markdown.
Если просят записать, поставить или напомнить задачу — заполни task: title (коротко, с глагола: «Купить удлинитель»), date (YYYY-MM-DD; «сегодня», «завтра»,
«в пятницу» считай от текущей даты; без даты — сегодня), time (HH:MM, если назван). В reply подтверди, что записала и на какой день.
Если просят оповестить, сообщить, написать, когда что-то случится («оповести, когда принтер закончит печать», «скажи, когда закроется заказ Калинина»,
«напиши, когда выполнят задачу …») — это НЕ задача, task не заполняй, а заполни watch:
  kind: printer (принтер закончит печать), order (заказ студии), task (задача);
  ref: для принтера — точное имя из [принтер …], для заказа — id из [заказ …], для задачи — id из [задача …];
  when (только для заказа): ready — когда будет готов, closed — когда выдадут или закроют (по умолчанию), any — при любой смене статуса.
  В reply скажи, что оповестишь. Если такого принтера, заказа или задачи в данных нет — watch не заполняй и честно скажи, что не нашла.
Если спрашивают про Kaspi, деньги, заказы, задачи, принтеры, клиентов — отвечай по данным ниже, с цифрами. Если данных нет или они могут быть неполными — честно скажи.`,
    facts + '\n\nСообщение: ' + String(text).slice(0, 1500), {
      type: 'OBJECT',
      properties: {
        reply: { type: 'STRING' },
        task: { type: 'OBJECT', properties: { title: { type: 'STRING' }, date: { type: 'STRING' }, time: { type: 'STRING' } }, required: ['title'] },
        watch: { type: 'OBJECT', properties: { kind: { type: 'STRING', enum: ['printer', 'order', 'task'] }, ref: { type: 'STRING' }, when: { type: 'STRING', enum: ['ready', 'closed', 'any'] } }, required: ['kind', 'ref'] },
      },
      required: ['reply'],
    });
  let out;
  try { out = JSON.parse(raw); } catch (_) { out = { reply: raw }; }
  const t = out.task;
  const w = out.watch && facts.includes(`[${{ printer: 'принтер', order: 'заказ', task: 'задача' }[out.watch.kind]} ${out.watch.ref}]`) ? out.watch : null;
  if (w && chat) await addWatch(fs, { kind: w.kind, ref: String(w.ref), when: w.kind === 'order' ? (w.when || 'closed') : '', chat, who, at: Date.now() });
  else if (t && t.title) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') ? t.date : kz().toISOString().slice(0, 10);
    await fs.create('tasks', {
      kind: 'boss', title: String(t.title).slice(0, 200), desc: 'Записала Аня из Telegram по просьбе: ' + who, dateFrom: '', date,
      who: '', time: /^\d{2}:\d{2}$/.test(t.time || '') ? t.time : '', timeTo: '', status: 'new', by: 'Аня (Telegram)', files: [], comments: [],
      done: false, doneAt: null, createdAt: Date.now(),
    });
  }
  let reply = String(out.reply || 'Готово.').slice(0, 3000);
  if (out.watch && !w) reply = 'Не нашла, за чем следить: уточните название принтера, имя клиента в заказе или задачу.';
  return { reply, task: !w && t && t.title ? t : null, watch: w };
}

/* ---------- оповещения «сообщи, когда…» (список в wa_anna/watches, проверяет notify.js) ---------- */

async function addWatch(fs, w) {
  if (w.kind === 'order') w.start = (await fs.get('orders/' + w.ref))?.status || '';
  if (w.kind === 'printer') w.busy = printerBusy((await printers() || []).find(p => p.name === w.ref));
  const list = ((await fs.get('wa_anna/watches'))?.list) || [];
  list.push(w);
  await fs.set('wa_anna/watches', { list });
}

const ORDER_ST = { new: 'новый', design: 'макет', prod: 'в производстве', ready: 'готов', done: 'выдан клиенту', cancel: 'отменён' };
const WATCH_DAYS = 7;
// Возвращает [{w, text}] — что пора отправить; сам список обновляет
export async function checkWatches(fs) {
  const doc = await fs.get('wa_anna/watches');
  const list = doc?.list || [];
  if (!list.length) return [];
  const pr = list.some(w => w.kind === 'printer') ? await printers() : null;
  const out = [], keep = [];
  let changed = false;
  for (const w of list) {
    let text = '';
    if (w.kind === 'printer' && pr) {
      const p = pr.find(x => x.name === w.ref);
      const busy = printerBusy(p);
      if (busy && !w.busy) { w.busy = true; changed = true; }
      else if (w.busy && !busy) {
        const st = String(p?.state || '').toUpperCase();
        text = !p || p.online === false ? `принтер ${w.ref} пропал из сети, печать могла прерваться` :
          st === 'FAILED' || p.errorText ? `принтер ${w.ref} остановился с ошибкой${p.errorText ? ': ' + p.errorText : ''}` : `принтер ${w.ref} закончил печать`;
      }
    } else if (w.kind === 'order') {
      const o = await fs.get('orders/' + w.ref);
      const name = o?.client ? `заказ ${o.client}` : 'заказ';
      if (!o) text = 'заказ, за которым я следила, удалили из учёта';
      else if (w.when === 'ready' ? ['ready', 'done'].includes(o.status) : w.when === 'any' ? o.status !== w.start : ['done', 'cancel'].includes(o.status))
        text = `${name}: ${ORDER_ST[o.status] || o.status}`;
    } else if (w.kind === 'task') {
      const t = await fs.get('tasks/' + w.ref);
      if (!t) text = 'задачу, за которой я следила, удалили';
      else if (t.done) text = `задача «${t.title || ''}» выполнена`;
    }
    if (!text && Date.now() - (w.at || 0) > WATCH_DAYS * DAY) text = `неделю следила, но так и не дождалась: ${w.kind === 'printer' ? 'принтер ' + w.ref : w.kind === 'order' ? 'заказ' : 'задача'}. Больше не слежу`;
    if (text) { out.push({ w, text }); changed = true; } else keep.push(w);
  }
  if (changed) {
    // пока проверяли, могли добавить новые оповещения — берём свежий список и убираем только сработавшие
    const fresh = ((await fs.get('wa_anna/watches'))?.list) || [];
    const done = new Set(out.map(x => x.w.at + x.w.ref));
    const upd = new Map(keep.map(w => [w.at + w.ref, w]));
    await fs.set('wa_anna/watches', { list: fresh.filter(w => !done.has(w.at + w.ref)).map(w => upd.get(w.at + w.ref) || w) });
  }
  return out;
}
