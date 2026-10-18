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
Опирайся только на данные ниже, ничего не выдумывай. Называй клиентов по имени (или номеру), заказы — по номеру.`;

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
    .map(c => ({ name: c.name || '', phone: c.phone || '', reason: c.managerReason || '', since: c.managerCalledAt || c.updatedAt || now }));
  const botOrders = orders.filter(o => o.source === 'whatsapp' && o.status === 'new');
  const voice = chats.reduce((n, c) => n + (c.messages || []).filter(m => now - (m.at || 0) < DAY && /^\[голосовое сообщение\]/.test(m.text || '')).length, 0);
  const stats = { chats: chats.length, botOrders: botOrders.length, needManager: needManager.length, voice };

  // Компактный текст для ИИ: диалоги за сутки и открытые заказы
  const dialogs = chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 25).map(c => {
    const who = { client: 'клиент', bot: 'Анна', manager: 'менеджер', notice: 'уведомление' };
    const tail = (c.messages || []).slice(-6).map(m => `  ${who[m.role] || m.role}: ${String(m.text || '').slice(0, 220)}`).join('\n');
    const flags = [c.needsManager ? `ЖДЁТ МЕНЕДЖЕРА (${c.managerReason || 'без причины'})` : '', c.lastRole === 'client' ? 'последним писал клиент' : ''].filter(Boolean).join(', ');
    return `${name(c)}${flags ? ' — ' + flags : ''}\n${tail}`;
  }).join('\n\n');
  const list = orders.sort((a, b) => String(a.deadline || '9').localeCompare(String(b.deadline || '9'))).slice(0, 40).map(o =>
    `№${String(o.num || '').padStart(3, '0')} ${o.client || ''}: ${SERVICE_NAMES[o.service] || o.customService || o.service || ''}, ${ST[o.status] || o.status}` +
    `, срок ${o.deadline || 'не назначен'}${o.deadline && o.deadline < today ? ' (ПРОСРОЧЕН)' : o.deadline === today ? ' (СЕГОДНЯ)' : ''}` +
    `${o.source === 'whatsapp' && o.status === 'new' ? ', оформила Анна — нужно подтвердить' : ''}${o.desc ? ' — ' + String(o.desc).slice(0, 120) : ''}`).join('\n');
  const d = kz();
  const facts = `Сейчас ${d.toISOString().slice(0, 16).replace('T', ' ')} по Алматы.
Статистика за сутки: диалогов ${stats.chats}, ждут менеджера ${stats.needManager}, заказов от Анны ждут подтверждения ${stats.botOrders}, голосовых ${voice}.

Диалоги WhatsApp за сутки:
${dialogs || 'нет'}

Открытые заказы (по сроку):
${list || 'нет'}`;
  return { facts, needManager, stats };
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
- summary: 2–5 предложений от первого лица, как будто ты утром рассказываешь команде, что было и что важно сегодня
  (сколько обращений, о чём чаще спрашивали, кто ждёт ответа, какие заказы горят). Начни с приветствия по времени суток.
- todo: до 6 конкретных дел на сегодня в повелительном наклонении («Ответить Айгерим про опт», «Подтвердить заказ №045»),
  самое срочное первым. Если дел нет — пустой список.`, facts, {
    type: 'OBJECT',
    properties: { summary: { type: 'STRING' }, todo: { type: 'ARRAY', items: { type: 'STRING' } } },
    required: ['summary', 'todo'],
  });
  let out;
  try { out = JSON.parse(raw); } catch (_) { out = { summary: raw, todo: [] }; }
  const digest = {
    at: Date.now(), summary: String(out.summary || '').slice(0, 1500),
    todo: (out.todo || []).slice(0, 6).map(t => ({ text: String(t).slice(0, 200) })),
    needManager: needManager.slice(0, 8), stats,
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
