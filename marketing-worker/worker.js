/* Маркетинговый отдел RAZ Brand Studio — сервер-посредник между сайтом учёта и ИИ.
   Пускает только сотрудников, вошедших на сайт через Firebase, и задаёт роли специалистов.

   БЕСПЛАТНО: Google Gemini (бесплатный тариф, ключ без карты на aistudio.google.com).
   Если бесплатный лимит Gemini на сегодня кончился — запасной бесплатный вариант:
   Cloudflare Workers AI (подключается привязкой AI, см. README).
   По желанию, платно и умнее, с поиском в интернете — Claude (ключ ANTHROPIC_API_KEY).

   Переменные (Settings → Variables and Secrets):
     GEMINI_API_KEY     — секрет, ключ из aistudio.google.com (бесплатно)
     FIREBASE_PROJECT   — raz-studio-5a486
     ALLOWED_ORIGIN     — https://razgulyaevevgeny.github.io
     GEMINI_MODEL       — необязательно, по умолчанию gemini-flash-latest
     ANTHROPIC_API_KEY  — необязательно, платно; если задан, отвечает Claude
     ALLOWED_EMAILS     — необязательно: почты через запятую; пусто — пускать всех вошедших
   Привязка AI (Settings → Bindings → Workers AI, имя AI) — необязательно, запасной бесплатный ИИ. */

const GEMINI_DEFAULT = 'gemini-flash-latest';
const CF_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CLAUDE_MODEL = 'claude-sonnet-5-5';

/* ---------- общая часть для всех ролей ---------- */
const STUDIO = `Ты работаешь в маркетинговом отделе студии брендирования RAZ Brand Studio (Казахстан, Instagram @raz.brandstudio).
Владелец — Евгений. Команда студии — 2 человека (Евгений и его жена). Времени мало, поэтому всё, что предлагаешь, должно выполняться силами 1–2 человек.
Рекламного бюджета сейчас НЕТ: таргет, платных блогеров и платные площадки не предлагай, пока об этом не попросят. Только бесплатные и почти бесплатные каналы: Instagram, WhatsApp, Telegram-чаты города, 2ГИС, Kaspi, сарафан, партнёрства, офлайн-визиты.
Оборудование: 3D-принтер Bambu Lab A1, DTF-печать, плоттер для винила, вышивка.
Приоритетные услуги (по ним просадка, их нужно продавать в первую очередь):
1) виниловые наклейки на авто — логотипы, инстаграмы, надписи;
2) DTF-печать на футболках — мерч для компаний, команд, мероприятий;
3) 3D-печатные таблички и вывески, брендированные под заведения (кафе, кофейни, барбершопы, салоны) — направление только запускается.
Также студия делает 3D-топперы (есть отдельный сайт для заявок), распечатку и продаёт на Kaspi.
У студии есть сайт учёта (CRM) с маркетинговым разделом: календарь, конкуренты, идеи, офферы. Ниже — живые данные оттуда. Опирайся на них, а не на выдуманные.

Правила:
- Пиши по-русски, просто и по делу, без воды и канцелярита. Казахский — только если попросят.
- Не выдумывай цифры, цены конкурентов, факты о городе. Если данных нет — так и скажи и подскажи, где и как их собрать. Любое допущение помечай «допущение».
- Сначала готовый результат (план, тексты, таблица), потом коротко «почему так» в 1–3 строки.
- Когда предлагаешь план по датам, пиши даты явно (например, 21.10) — владелец разложит их в календарь одной кнопкой.
- Заканчивай блоком «Что сделать сегодня» — не больше 3 конкретных действий по 30–60 минут.
- Оформление: markdown — заголовки ##, списки, **жирный**, таблицы. Без эмодзи-мусора.
- Не обещай результат в цифрах (заявки, выручка) — давай гипотезы и способ их проверить.`;

const ROLES = {
  marketer: {
    name: 'Маркетолог',
    prompt: `Твоя роль — МАРКЕТОЛОГ-СТРАТЕГ студии.
Отвечаешь за: маркетинговую стратегию и план на месяц/квартал, цели по продажам и росту, позиционирование, офферы и пакеты услуг, ценообразование, акции без демпинга, коммерческие предложения (КП) для заведений и компаний, скрипты продаж, воронку и работу с заявками, поиск клиентов без бюджета (холодные сообщения в Direct/WhatsApp, 2ГИС, партнёрства с автомойками, детейлингом, СТО, ивент-агентствами, спортклубами, открывающимися кафе).
Анализ цен: сравнивай прайс студии с себестоимостью и наценкой из учёта, показывай где наценка низкая, где цену можно поднять, какие позиции собрать в пакеты. Цены конкурентов бери из раздела «Конкуренты», иначе помечай как допущение.
Для винила на авто владелец не понимает боли клиентов — не выдавай гипотезы за факт: давай гипотезы и вопросы для интервью с реальными клиентами.
Формат стратегии: цель (в цифрах учёта) → сегменты → оффер для каждого → каналы → план по неделям с датами → что считать в учёте.`
  },
  smm: {
    name: 'SMM-менеджер',
    prompt: `Твоя роль — SMM-МЕНЕДЖЕР студии, ведёшь Instagram @raz.brandstudio.
Отвечаешь за: контент-план (неделя/месяц) таблицей «дата — формат — тема — цель — призыв», сценарии Reels покадрово (хук в первые 2 секунды → процесс → результат → призыв; что снимать, сколько секунд кадр, текст на экране, звук), тексты постов и подписей, сторис с опросами и квизами для сбора заявок, рубрикатор, шапку профиля и Highlights, хештеги и гео, ответы на комментарии и в Direct, идеи коллабораций с местными аккаунтами.
Главный бесплатный ресурс — сам процесс в мастерской: печать на 3D-принтере, нарезка и поклейка винила, перенос DTF. Строй план вокруг него, «до/после», кейсов клиентов и «сколько стоит». Связывай контент с активными офферами и событиями календаря.
Снимает 1 человек на телефон между заказами: не больше 3–4 публикаций в неделю, сценарии на 15–30 секунд.
Стритвир-бренд владельца «РЗГ» (@wear.rzg) — отдельный аккаунт, его можно упоминать как кейс DTF-качества, но не смешивать.`
  },
  analyst: {
    name: 'Аналитик',
    prompt: `Твоя роль — АНАЛИТИК РЫНКА И КОНКУРЕНТОВ.
Отвечаешь за: разбор конкурентов (студии брендирования, оклейка авто, DTF и печать на одежде, 3D-печать, рекламные агентства, изготовители вывесок), сравнение их цен, ассортимента и подачи с RAZ Brand Studio; анализ продаж и роста по цифрам учёта (что растёт, что просело, где деньги); спрос и сезонность; портреты клиентов по каждой услуге.
{SEARCH}
Правила: отделяй факты от выводов. Чего нет в данных — пиши «нет данных» и говори, где взять: 2ГИС (цены, отзывы), Instagram конкурента (хайлайты «цены»), OLX, Satu, звонок «тайного покупателя» — давай готовый скрипт вопросов.
Формат разбора конкурентов: таблица (название — что делают — цены — сильные стороны — слабые места) → где RAZ сильнее → где слабее → 3 возможности, которые можно забрать прямо сейчас.
Если город студии не указан в брифе — спроси его одной строкой.`
  },
  planner: {
    name: 'Планировщик', hidden: true, json: true,
    prompt: `Ты превращаешь маркетинговый план в записи календаря. Верни ТОЛЬКО JSON без пояснений, формат:
{"events":[{"date":"ГГГГ-ММ-ДД","title":"коротко, до 70 символов","type":"strategy|offer|content|sales|growth","notes":"1–2 предложения: что сделать"}]}
type: strategy — этап стратегии или цель; offer — акция или запуск оффера; content — публикация, Reels, сторис; sales — продажи, аутрич, звонки, визиты, КП; growth — замер метрик, итоги, разбор цифр.
Бери только то, что есть в тексте плана. Если у пункта нет даты, но есть день недели или «неделя 1/2…», вычисли дату от даты начала, указанной в запросе. Не больше 40 записей.`
  }
};

/* ---------- проверка входа сотрудника (токен Firebase) ---------- */
let jwkCache = { keys: null, exp: 0 };
async function googleKeys() {
  if (jwkCache.keys && Date.now() < jwkCache.exp) return jwkCache.keys;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const j = await r.json();
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  jwkCache = { keys: j.keys, exp: Date.now() + (m ? +m[1] * 1000 : 3600e3) };
  return j.keys;
}
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function verifyFirebase(token, project) {
  const [h, p, s] = String(token || '').split('.');
  if (!h || !p || !s) throw new Error('no token');
  const head = JSON.parse(new TextDecoder().decode(b64u(h)));
  const body = JSON.parse(new TextDecoder().decode(b64u(p)));
  const now = Date.now() / 1000;
  if (head.alg !== 'RS256') throw new Error('alg');
  if (body.aud !== project || body.iss !== 'https://securetoken.google.com/' + project) throw new Error('aud');
  if (!(body.exp > now) || !(body.iat < now + 300) || !body.sub) throw new Error('exp');
  const jwk = (await googleKeys()).find(k => k.kid === head.kid);
  if (!jwk) throw new Error('kid');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(h + '.' + p));
  if (!ok) throw new Error('sig');
  return body;
}

/* ---------- системная инструкция ---------- */
function systemText(role, context, brief, search) {
  const R = ROLES[role];
  const searchLine = search
    ? 'У тебя есть веб-поиск — используй его, прежде чем делать выводы о конкурентах и ценах рынка; каждая цена и факт — со ссылкой.'
    : 'Поиска в интернете у тебя нет. Работай с карточками раздела «Конкуренты» и с текстом, который владелец вставит в чат (описания, прайсы, отзывы конкурентов).';
  if (R.json) return R.prompt;
  return STUDIO + '\n\n' + R.prompt.replace('{SEARCH}', searchLine) +
    '\n\n## Бриф студии (заполняет владелец)\n' + (brief || 'Бриф пока не заполнен — если для задачи нужен город, ЦА или конкуренты, спроси.') +
    '\n\n## Данные из учёта и маркетингового раздела\n' + (context || 'Нет данных.') +
    '\n\nСегодня: ' + new Date().toISOString().slice(0, 10);
}

/* ---------- ИИ: Gemini (бесплатно) ---------- */
class Quota extends Error {}
async function viaGemini(env, role, messages, system) {
  const model = env.GEMINI_MODEL || GEMINI_DEFAULT;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 8192, temperature: ROLES[role].json ? 0.2 : 0.7, ...(ROLES[role].json ? { responseMimeType: 'application/json' } : {}) }
    })
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 429) throw new Quota('limit');
  if (!r.ok) throw new Error((j.error && j.error.message) || ('Gemini ответил ' + r.status));
  const c = (j.candidates || [])[0];
  const text = ((c && c.content && c.content.parts) || []).map(p => p.text || '').join('');
  if (!text) throw new Error(c && c.finishReason ? 'Gemini не ответил (' + c.finishReason + ')' : 'Пустой ответ');
  return { text, sources: [], engine: 'Gemini' };
}

/* ---------- ИИ: Cloudflare Workers AI (бесплатный запасной) ---------- */
async function viaCloudflare(env, role, messages, system) {
  const out = await env.AI.run(CF_MODEL, { messages: [{ role: 'system', content: system }, ...messages], max_tokens: 4000, temperature: ROLES[role].json ? 0.2 : 0.7 });
  const text = typeof out.response === 'string' ? out.response : JSON.stringify(out.response || '');
  if (!text) throw new Error('Пустой ответ');
  return { text, sources: [], engine: 'Llama' };
}

/* ---------- ИИ: Claude (платно, по желанию) ---------- */
async function viaClaude(env, role, messages, system) {
  const search = !ROLES[role].json && role !== 'smm';
  const tools = search ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: role === 'analyst' ? 8 : 4, user_location: { type: 'approximate', country: 'KZ', timezone: 'Asia/Almaty' } }] : undefined;
  let msgs = messages.slice(), text = '';
  const sources = new Map();
  for (let round = 0; round < 4; round++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env.CLAUDE_MODEL || CLAUDE_MODEL, max_tokens: 6000, system, messages: msgs, ...(tools ? { tools } : {}) })
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Claude ответил ' + r.status));
    for (const b of j.content || []) if (b.type === 'text') { text += b.text; (b.citations || []).forEach(c => c.url && !sources.has(c.url) && sources.set(c.url, c.title || c.url)); }
    if (j.stop_reason !== 'pause_turn') break;
    msgs = [...msgs, { role: 'assistant', content: j.content }];
  }
  return { text: text.trim(), sources: [...sources].map(([url, title]) => ({ url, title })).slice(0, 20), engine: 'Claude' };
}

async function answer(env, role, messages, context, brief) {
  if (env.ANTHROPIC_API_KEY) return viaClaude(env, role, messages, systemText(role, context, brief, role !== 'smm'));
  const system = systemText(role, context, brief, false);
  if (env.GEMINI_API_KEY) {
    try { return await viaGemini(env, role, messages, system); }
    catch (e) {
      if (!env.AI) throw e instanceof Quota ? new Error('Бесплатный лимит Gemini на сегодня закончился. Попробуйте позже или подключите запасной Workers AI (см. README).') : e;
    }
  }
  if (env.AI) {
    try { return await viaCloudflare(env, role, messages, system); }
    catch (e) { throw new Error('Бесплатные лимиты на сегодня закончились. Попробуйте завтра. (' + e.message + ')'); }
  }
  throw new Error('На сервере не задан ключ GEMINI_API_KEY.');
}

/* ---------- обработчик ---------- */
export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://razgulyaevevgeny.github.io';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'vary': 'origin' };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (url.pathname === '/api/status') return json({ ok: true, engine: env.ANTHROPIC_API_KEY ? 'Claude' : env.GEMINI_API_KEY ? 'Gemini' : env.AI ? 'Llama' : null, fallback: !!env.AI });
    if (url.pathname !== '/api/ask' || req.method !== 'POST') return json({ error: 'not found' }, 404);

    let user;
    try { user = await verifyFirebase((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.FIREBASE_PROJECT || 'raz-studio-5a486'); }
    catch (_) { return json({ error: 'Войдите на сайт учёта заново.' }, 401); }
    const allow = String(env.ALLOWED_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (allow.length && !allow.includes(String(user.email || '').toLowerCase())) return json({ error: 'Нет доступа к маркетинговому отделу.' }, 403);

    let b;
    try { b = await req.json(); } catch (_) { return json({ error: 'bad json' }, 400); }
    if (!ROLES[b.role]) return json({ error: 'Неизвестная роль' }, 400);
    const messages = (Array.isArray(b.messages) ? b.messages : [])
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
      .slice(-16).map(m => ({ role: m.role, content: m.text.slice(0, 30000) }));
    // подряд идущие сообщения одной роли склеиваем; разговор должен начинаться и заканчиваться вопросом
    const merged = [];
    for (const m of messages) { const l = merged.at(-1); if (l && l.role === m.role) l.content += '\n\n' + m.content; else merged.push({ ...m }); }
    while (merged.length && merged[0].role !== 'user') merged.shift();
    if (!merged.length || merged.at(-1).role !== 'user') return json({ error: 'Пустой вопрос' }, 400);

    try { return json(await answer(env, b.role, merged, String(b.context || '').slice(0, 24000), String(b.brief || '').slice(0, 6000))); }
    catch (e) { return json({ error: e.message || 'Не удалось получить ответ' }, 502); }
  }
};
