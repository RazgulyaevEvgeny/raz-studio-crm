// «Менеджер Аня» в учёте: сводка дня для виджета на главной и ответы на вопросы сотрудников.
// Сводка — документ wa_anna/digest; учёт просит обновить её через wa_anna/request (кнопка «Обновить»),
// вопросы сотрудники пишут в коллекцию wa_anna_q, Аня отвечает в поле a. Всё на бесплатном Gemini.

import { GEMINI_MODELS, SERVICE_NAMES, openOrders, normPhone } from './brain.js';

const DAY = 24 * 3600e3;
const MORNING = 9;                          // с 9 утра по Алматы готовим сводку на день (один раз, если компьютер включён)
const ST = { new: 'новый', design: 'макет', prod: 'в производстве', ready: 'готов, ждёт клиента' };

const PERSONA = `Ты Аня, виртуальный помощник студии брендирования «Разгуляев». Ты отвечаешь клиентам в WhatsApp,
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
  const name = c => c.clientName || c.name || (c.phone ? '+' + c.phone : 'Клиент');
  const needManager = chats.filter(c => c.needsManager)
    .sort((a, b) => (a.managerCalledAt || 0) - (b.managerCalledAt || 0))
    .map(c => ({ id: c.id, name: c.clientName || c.name || '', phone: c.phone || '', reason: c.managerReason || '', since: c.managerCalledAt || c.updatedAt || now }));
  const kaspi = await kaspiToDo(fs);
  const tasks = (await fs.query('tasks', { where: { fieldFilter: { field: { fieldPath: 'done' }, op: 'EQUAL', value: { booleanValue: false } } } }).catch(() => []))
    .sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9'))).slice(0, 30)
    .map(t => `[задача ${t.id}] ${t.date || 'без даты'}${t.time ? ' ' + t.time : ''}: ${t.title || ''}${t.who ? ' (' + t.who + ')' : ''}`).join('\n');
  const botOrders = orders.filter(o => o.source === 'whatsapp' && o.status === 'new');
  const voice = chats.reduce((n, c) => n + (c.messages || []).filter(m => now - (m.at || 0) < DAY && /^\[голосовое сообщение\]/.test(m.text || '')).length, 0);
  const stats = { chats: chats.length, botOrders: botOrders.length, needManager: needManager.length, voice };

  // Компактный текст для ИИ: диалоги за сутки и открытые заказы
  const dialogs = chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 25).map(c => {
    const who = { client: 'клиент', bot: 'Аня', manager: 'менеджер', notice: 'уведомление' };
    const tail = (c.messages || []).slice(-6).map(m => `  ${who[m.role] || m.role}: ${String(m.text || '').slice(0, 220)}`).join('\n');
    const flags = [c.needsManager ? `ЖДЁТ МЕНЕДЖЕРА (${c.managerReason || 'без причины'})` : '', c.lastRole === 'client' ? 'последним писал клиент' : ''].filter(Boolean).join(', ');
    return `[чат ${c.id}] ${name(c)}${flags ? ' — ' + flags : ''}\n${tail}`;
  }).join('\n\n');
  const list = orders.sort((a, b) => String(a.deadline || '9').localeCompare(String(b.deadline || '9'))).slice(0, 40).map(o =>
    `[заказ ${o.id}] ${o.client || 'без имени'}: ${SERVICE_NAMES[o.service] || o.customService || o.service || ''}, ${ST[o.status] || o.status}` +
    `, срок ${o.deadline || 'не назначен'}${o.deadline && o.deadline < today ? ' (ПРОСРОЧЕН)' : o.deadline === today ? ' (СЕГОДНЯ)' : ''}` +
    `${o.source === 'whatsapp' && o.status === 'new' ? ', оформила Аня — нужно подтвердить' : ''}${o.desc ? ' — ' + String(o.desc).slice(0, 120) : ''}`).join('\n');
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
    if (r.status === 429 || r.status === 503 || r.status === 404) continue;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Gemini ответил ' + r.status));
    return (j.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  }
  throw new Error('бесплатный лимит Gemini исчерпан');
}

/* ---------- сводка дня ---------- */

// Дела, которые в учёте отметили сделанными (кружок в «Сегодня сделать»): wa_anna/done {items:{ключ:{text, at, orderId?, kaspiId?}}}.
// Ключ считается так же, как в index.html (annaTodoKey). Сутки после отметки дело не возвращаем; старые записи чистим.
const DONE_TTL = DAY;
const todoKey = text => {
  const x = String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
  let h = 0; for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) | 0;
  return 'k' + (h >>> 0).toString(36);
};
async function doneTodo(fs) {
  const items = (await fs.get('wa_anna/done').catch(() => null))?.items || {};
  const fresh = Object.fromEntries(Object.entries(items).filter(([, r]) => r && Date.now() - (+r.at || 0) < DONE_TTL));
  if (Object.keys(fresh).length < Object.keys(items).length) await fs.set('wa_anna/done', { items: fresh }).catch(() => {});
  return Object.entries(fresh).map(([key, r]) => ({ key, ...r }));
}

export async function makeDigest(fs, env) {
  const { facts, needManager, stats } = await collect(fs);
  const done = await doneTodo(fs);
  const doneText = done.length ? '\n\nУЖЕ СДЕЛАНО СЕГОДНЯ (команда отметила в учёте, в todo НЕ повторять ни дословно, ни другими словами):\n' + done.map(r => '- ' + r.text).join('\n') : '';
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
Никогда не пиши в тексте служебные id.`, facts + doneText, {
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
    }).filter(t => t.text && !done.some(r => r.key === todoKey(t.text) || (t.orderId && r.orderId === t.orderId) || (t.kaspiId && r.kaspiId === t.kaspiId))),
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
  const raw = await gemini(env, PERSONA + `
Сейчас тебе пишет в Telegram ${who}. Обращайся к нему(ней) именно так: «${who}». Отвечай коротко, как в мессенджере, 1–6 предложений, без markdown.
Если просят записать, поставить или напомнить задачу — заполни task: title (коротко, с глагола: «Купить удлинитель»), date (YYYY-MM-DD; «сегодня», «завтра»,
«в пятницу» считай от текущей даты; без даты — сегодня), time (HH:MM, если назван). В reply подтверди, что записала и на какой день.
Если просят оповестить, сообщить, написать, когда что-то случится («оповести, когда принтер закончит печать», «скажи, когда закроется заказ Калинина»,
«напиши, когда выполнят задачу …») — это НЕ задача, task не заполняй, а заполни watch:
  kind: printer (принтер закончит печать), order (заказ студии), task (задача);
  ref: для принтера — точное имя из [принтер …], для заказа — id из [заказ …], для задачи — id из [задача …];
  when (только для заказа): ready — когда будет готов, closed — когда выдадут или закроют (по умолчанию), any — при любой смене статуса.
  В reply скажи, что оповестишь. Если такого принтера, заказа или задачи в данных нет — watch не заполняй и честно скажи, что не нашла.
Если просят аналитику или разбор переписок, выводы по клиентам за неделю или месяц — заполни insights: week или month (по умолчанию week),
а в reply коротко скажи, что сейчас пришлёшь разбор.
Если спрашивают про Kaspi, деньги, заказы, задачи, принтеры, клиентов — отвечай по данным ниже, с цифрами. Если данных нет или они могут быть неполными — честно скажи.`,
    facts + '\n\nСообщение: ' + String(text).slice(0, 1500), {
      type: 'OBJECT',
      properties: {
        reply: { type: 'STRING' },
        task: { type: 'OBJECT', properties: { title: { type: 'STRING' }, date: { type: 'STRING' }, time: { type: 'STRING' } }, required: ['title'] },
        insights: { type: 'STRING', enum: ['week', 'month'] },
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
  if (out.insights === 'week' || out.insights === 'month') {
    try { reply = insightsText(await makeInsights(fs, env, out.insights), out.insights); }
    catch (e) { reply = 'Не получилось сделать разбор: ' + String(e?.message || e).slice(0, 200); }
  }
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

/* ---------- аналитика переписок за неделю и месяц ---------- */
// Документ wa_anna/insights: {week:{…}, month:{…}}; каждый — {at, days, summary, services:[{name,count}], questions:[], offers:[],
//   lost:[{name, phone, why, suggest}], followups:[{name, phone, text}], chats, orders}.
// Готовим по просьбе (кнопка в учёте пишет wa_anna/request.insights = 'week'|'month', или просьба Ане в Telegram)
// и сами: недельную по понедельникам, месячную 1-го числа (утром, если компьютер включён).
const PERIODS = { week: 7, month: 30 };

export async function makeInsights(fs, env, period = 'week') {
  const days = PERIODS[period] || 7, since = Date.now() - days * DAY;
  const chats = (await fs.list('wa_chats')).filter(c => (c.updatedAt || 0) >= since);
  const orders = await fs.query('orders', {
    where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(since - 30 * DAY) } } },
  }).then(l => l.filter(o => !o.deletedAt)).catch(() => []);
  const inPeriod = orders.filter(o => (o.createdAt || 0) >= since && o.status !== 'cancel' && o.service !== 'kaspi');
  // Полная переписка из архива wa_log (в самом чате хранятся только последние 40 сообщений)
  const months = [...new Set([since, Date.now()].map(t => { const d = kz(t); return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0'); }))];
  for (const c of chats.slice(0, 60)) {
    const log = [];
    for (const m of months) log.push(...(((await fs.get('wa_log/' + c.id + '_' + m).catch(() => null))?.messages) || []));
    if (log.length > (c.messages || []).length) c.messages = log.filter(m => (m.at || 0) >= since).sort((a, b) => (a.at || 0) - (b.at || 0));
  }
  const count = new Map();
  for (const o of inPeriod) { const n = SERVICE_NAMES[o.service] || o.customService || o.service || 'Другое'; count.set(n, (count.get(n) || 0) + 1); }
  const services = [...count].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count);
  const byPhone = new Map(orders.map(o => [normPhone(o.phone), o]).filter(([p]) => p));
  const who = { client: 'клиент', bot: 'Аня', manager: 'менеджер', notice: 'уведомление' };
  const dialogs = chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 60).map(c => {
    const o = byPhone.get(normPhone(c.phone));
    const msgs = (c.messages || []).filter(m => m.role !== 'notice').slice(period === 'month' ? -24 : -14)
      .map(m => `  ${who[m.role] || m.role}: ${String(m.text || '').slice(0, 200)}`).join('\n');
    const quiet = Math.round((Date.now() - (c.updatedAt || 0)) / DAY);
    return `[чат ${c.id}] ${c.clientName || c.name || 'Клиент'}${c.phone ? ' +' + c.phone : ''}; ` +
      `${o ? 'заказ есть: ' + (SERVICE_NAMES[o.service] || o.service) + ', статус ' + (ST[o.status] || o.status) : 'заказа нет'}; ` +
      `последнее сообщение ${quiet ? quiet + ' дн назад' : 'сегодня'}, последним писал ${who[c.lastRole] || c.lastRole || '?'}\n${msgs}`;
  }).join('\n\n');
  const raw = await gemini(env, PERSONA + `
Сделай для команды мини-аналитику переписок WhatsApp за последние ${days} дней. Пиши коротко и по делу, от первого лица.
- summary: 2–4 предложения: сколько было обращений, с чем приходили, что получилось и что нет.
- questions: до 6 частых вопросов клиентов, своими словами («Сколько стоит печать на футболке А4»).
- offers: до 5 идей, что можно предложить другим клиентам или как продавать больше (по тому, что спрашивали и заказывали).
- lost: клиенты, которые проконсультировались, но заказ не оформили и пропали (заказа нет, последним писала Аня или менеджер, тишина больше суток):
  chatId из [чат …], why — почему, как ты думаешь, ушёл (дорого, долго не ответили, не было нужного, просто узнавал цену…), suggest — что ему написать.
- followups: до 6 конкретных сообщений, кому стоит написать ещё раз или уточнить актуальность заказа: chatId и text — готовый короткий текст сообщения клиенту.
Никогда не пиши служебные id в тексте.`, `Заказов студии за период: ${inPeriod.length}. По услугам: ${services.map(x => x.name + ' — ' + x.count).join(', ') || 'нет'}.
Диалогов за период: ${chats.length}.

${dialogs || 'Диалогов нет.'}`, {
    type: 'OBJECT',
    properties: {
      summary: { type: 'STRING' },
      questions: { type: 'ARRAY', items: { type: 'STRING' } },
      offers: { type: 'ARRAY', items: { type: 'STRING' } },
      lost: { type: 'ARRAY', items: { type: 'OBJECT', properties: { chatId: { type: 'STRING' }, why: { type: 'STRING' }, suggest: { type: 'STRING' } }, required: ['chatId', 'why'] } },
      followups: { type: 'ARRAY', items: { type: 'OBJECT', properties: { chatId: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['chatId', 'text'] } },
    },
    required: ['summary'],
  });
  let out;
  try { out = JSON.parse(raw); } catch (_) { out = { summary: raw }; }
  const chat = new Map(chats.map(c => [c.id, c]));
  const person = id => { const c = chat.get(String(id)); return c ? { name: c.clientName || c.name || (c.phone ? '+' + c.phone : 'Клиент'), phone: c.phone || '' } : null; };
  const res = {
    at: Date.now(), days, chats: chats.length, orders: inPeriod.length, services: services.slice(0, 8),
    summary: String(out.summary || '').slice(0, 1500),
    questions: (out.questions || []).slice(0, 6).map(q => String(q).slice(0, 200)),
    offers: (out.offers || []).slice(0, 5).map(q => String(q).slice(0, 300)),
    lost: (out.lost || []).map(l => person(l.chatId) && { ...person(l.chatId), why: String(l.why || '').slice(0, 300), suggest: String(l.suggest || '').slice(0, 300) }).filter(Boolean).slice(0, 10),
    followups: (out.followups || []).map(f => person(f.chatId) && { ...person(f.chatId), text: String(f.text || '').slice(0, 400) }).filter(Boolean).slice(0, 6),
  };
  await fs.patch('wa_anna/insights', { [period]: res });
  return res;
}

// Текст аналитики для Telegram
export function insightsText(r, period) {
  const L = [`📊 Аналитика переписок за ${period === 'month' ? 'месяц' : 'неделю'}`, r.summary];
  if (r.services.length) L.push('Чаще заказывали: ' + r.services.map(s => `${s.name} (${s.count})`).join(', '));
  if (r.questions.length) L.push('Часто спрашивали:\n' + r.questions.map(q => '• ' + q).join('\n'));
  if (r.offers.length) L.push('Что предложить:\n' + r.offers.map(q => '• ' + q).join('\n'));
  if (r.lost.length) L.push('Ушли без заказа:\n' + r.lost.map(l => `• ${l.name} — ${l.why}${l.suggest ? ' Написать: ' + l.suggest : ''}`).join('\n'));
  if (r.followups.length) L.push('Кому написать:\n' + r.followups.map(f => `• ${f.name}: «${f.text}»${f.phone ? ' https://wa.me/' + f.phone : ''}`).join('\n'));
  return L.filter(Boolean).join('\n\n');
}

// Какую аналитику пора готовить: по просьбе из учёта или по расписанию
export async function insightsDue(fs) {
  const [ins, req] = await Promise.all([fs.get('wa_anna/insights'), fs.get('wa_anna/request')]);
  const want = req?.insights, wantAt = req?.insightsAt || 0;
  if (PERIODS[want] && wantAt > (ins?.[want]?.at || 0)) return want;
  const d = kz();
  if (d.getUTCHours() < MORNING) return '';
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 5 * 3600e3;
  if (d.getUTCDay() === 1 && (ins?.week?.at || 0) < today) return 'week';
  if (d.getUTCDate() === 1 && (ins?.month?.at || 0) < today) return 'month';
  return '';
}
