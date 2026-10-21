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
     IG_TOKEN           — необязательно, секрет: токен Instagram из Meta for Developers (60 дней)
   Привязка IG_KV (KV namespace) — необязательно: тогда токен Instagram продлевается сам.
   Привязка AI (Settings → Bindings → Workers AI, имя AI) — запасной бесплатный ИИ и фоны для креативов. */

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
  designer: {
    name: 'Дизайнер креативов', json: true, ctx: true,
    prompt: `Твоя роль — ДИЗАЙНЕР КРЕАТИВОВ студии для Instagram. Ты придумываешь тексты и раскладку для картинок-креативов (пост или сторис), а картинку по твоему описанию соберёт сайт по шаблону.
Верни ТОЛЬКО JSON без пояснений:
{"caption":"готовый текст публикации для Instagram: 3–6 коротких абзацев, призыв написать в Direct или WhatsApp, 5–8 хештегов (#оклейкаавто и т.п.)",
 "variants":[{"template":"bold|photo|price|list","theme":"blue|dark|light","headline":"заголовок до 45 символов","sub":"подзаголовок до 100 символов или пусто","bullets":["до 4 пунктов по 40 символов, только для list"],"price":"цена из прайса, например «от 5 000 ₸», или пусто","cta":"призыв до 24 символов, например «Пиши в Direct»","badge":"плашка до 16 символов, например «Акция» или «Новинка», или пусто","bg_prompt":"English prompt for a photorealistic background photo matching the topic, no text, no letters, no logos"}]}
Сделай 3 разных варианта: разные шаблоны и разные углы подачи (выгода, процесс или результат, цена или оффер).
Шаблоны: bold — крупный заголовок на цветном фоне; photo — фото на весь экран, текст снизу; price — фото сверху и круглый ценник; list — заголовок и список преимуществ.
Заголовок — цепляющий, разговорный, конкретный, без канцелярита. Цены бери только из прайса или офферов в данных ниже; если цены нет — оставь price пустым. Не выдумывай акции, которых нет в данных, если владелец сам о них не написал.`
  },
  planner: {
    name: 'Планировщик', json: true, ctx: true,
    prompt: `Ты превращаешь маркетинговый план в записи календаря так, чтобы по каждой записи можно было работать БЕЗ возврата к переписке.
Верни ТОЛЬКО JSON без пояснений:
{"events":[{"date":"ГГГГ-ММ-ДД","title":"коротко, до 70 символов","type":"strategy|offer|content|sales|growth","time":"сколько займёт, например «40 минут»","goal":"зачем это делаем и какой результат ждём — 1–2 предложения","steps":["конкретный шаг 1","шаг 2","… 3–8 шагов, каждый — одно действие, которое можно отметить галочкой"],"details":"markdown со всеми материалами для этого пункта"}]}
type: strategy — этап стратегии или цель; offer — акция или запуск оффера; content — публикация, Reels, сторис; sales — продажи, аутрич, звонки, визиты, КП; growth — замер метрик, итоги, разбор цифр.
Что класть в details (markdown: заголовки ###, списки, таблицы):
- content (Reels, пост, сторис): сценарий и раскадровка таблицей «Кадр | Что снимаем | Сек | Текст на экране», звук, готовая подпись к публикации, хештеги, призыв;
- sales: кому писать или куда идти и сколько контактов, готовые тексты сообщений или скрипт звонка/визита, что ответить на возражения, что записать в учёт;
- offer: условия, цена, срок, тексты для объявления, сторис и WhatsApp;
- strategy / growth: что именно посчитать или решить, где взять цифры, критерий успеха.
Главное правило: ПЕРЕНОСИ ИЗ ПЛАНА ДОСЛОВНО всё, что относится к этому пункту — сценарии, тексты, скрипты, раскадровки, цены. Ничего не сокращай. Если в плане деталей нет — допиши их сам по данным студии ниже, конкретно, готово к использованию.
Если у пункта нет даты, но есть день недели или «неделя 1/2…», вычисли дату от даты начала из запроса. Одинаковые пункты в разные дни — отдельные записи. Не больше 25 записей.`
  },
  detailer: {
    name: 'Расписать событие', json: true, ctx: true,
    prompt: `Владелец поставил в календарь маркетинговую задачу. Распиши её так, чтобы её можно было выполнить, не задавая вопросов.
Верни ТОЛЬКО JSON без пояснений:
{"time":"сколько займёт","goal":"зачем и какой результат ждём — 1–2 предложения","steps":["3–8 конкретных шагов, каждый можно отметить галочкой"],"details":"markdown со всеми материалами"}
Что класть в details: для контента — сценарий и раскадровку таблицей «Кадр | Что снимаем | Сек | Текст на экране», звук, готовую подпись, хештеги; для продаж — кому писать и сколько, готовые тексты или скрипт, ответы на возражения; для акций — условия, цену, тексты для сторис и WhatsApp; для стратегии и цифр — что посчитать, где взять данные, критерий успеха.
Опирайся на данные студии ниже: прайс, офферы, Instagram, «О студии». Не выдумывай цены и акции, которых нет в данных.`
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
  if (R.json && !R.ctx) return R.prompt;
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
      generationConfig: { maxOutputTokens: role === 'planner' ? 32768 : 8192, temperature: ROLES[role].json && !ROLES[role].ctx ? 0.2 : 0.8, ...(ROLES[role].json ? { responseMimeType: 'application/json' } : {}) }
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
  const out = await env.AI.run(CF_MODEL, { messages: [{ role: 'system', content: system }, ...messages], max_tokens: ROLES[role].json ? 7000 : 4000, temperature: ROLES[role].json && !ROLES[role].ctx ? 0.2 : 0.8 });
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
      body: JSON.stringify({ model: env.CLAUDE_MODEL || CLAUDE_MODEL, max_tokens: role === 'planner' ? 16000 : 6000, system, messages: msgs, ...(tools ? { tools } : {}) })
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

/* ---------- картинка-фон от ИИ (Cloudflare Workers AI, бесплатно в дневной норме) ---------- */
async function makeImage(env, prompt) {
  if (!env.AI) throw new Error('Для фонов от ИИ подключите Workers AI: Settings → Bindings → Workers AI, имя AI.');
  const out = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: String(prompt).slice(0, 1500) + '. Professional commercial photography, natural light, high detail. No text, no letters, no words, no logos, no watermark.', steps: 6 });
  if (!out || !out.image) throw new Error('ИИ не прислал картинку');
  return 'data:image/jpeg;base64,' + out.image;
}

/* ---------- универсальный запрос для сайта отдела маркетинга ----------
   Инструкции агентов приходят с сайта, поэтому менять их можно без обновления воркера.
   Повторяет запрос при лимитах Gemini, при неудаче отвечает запасной моделью Cloudflare. */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function geminiGen(env, system, messages, o) {
  const model = env.GEMINI_MODEL || GEMINI_DEFAULT;
  let schema = o.schema || null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: o.maxTokens, temperature: o.temperature, ...(o.json ? { responseMimeType: 'application/json' } : {}), ...(o.json && schema ? { responseSchema: schema } : {}) }
      })
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 400 && schema) { schema = null; continue; }            // схема не подошла — просим JSON без схемы
    if (r.status === 429 || r.status === 503 || r.status === 500) { if (attempt < 3) { await sleep([3000, 8000, 15000][attempt]); continue; } throw new Quota('limit'); }
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Gemini ответил ' + r.status));
    const c = (j.candidates || [])[0];
    const text = ((c && c.content && c.content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('');
    if (!text) { if (attempt < 3) { await sleep(2000); continue; } throw new Error('Gemini не ответил' + (c && c.finishReason ? ' (' + c.finishReason + ')' : '')); }
    return { text, engine: 'Gemini', truncated: !!(c && c.finishReason === 'MAX_TOKENS') };
  }
  throw new Quota('limit');
}
async function cfGen(env, system, messages, o) {
  const sys = system.length > 14000 ? system.slice(0, 14000) + '\n…' : system;
  const out = await env.AI.run(CF_MODEL, { messages: [{ role: 'system', content: sys + (o.json ? '\n\nОтветь ТОЛЬКО валидным JSON без пояснений и без ```.' : '') }, ...messages.map(m => ({ role: m.role, content: m.content.slice(0, 12000) }))], max_tokens: Math.min(o.maxTokens, 6000), temperature: o.temperature });
  const text = typeof out.response === 'string' ? out.response : JSON.stringify(out.response || '');
  if (!text) throw new Error('Пустой ответ');
  return { text, engine: 'Llama' };
}
async function claudeGen(env, system, messages, o) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.CLAUDE_MODEL || CLAUDE_MODEL, max_tokens: Math.min(o.maxTokens, 16000), system: system + (o.json ? '\n\nОтветь ТОЛЬКО валидным JSON без пояснений.' : ''), messages })
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || ('Claude ответил ' + r.status));
  return { text: (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim(), engine: 'Claude' };
}
async function generate(env, system, messages, o) {
  if (env.ANTHROPIC_API_KEY) return claudeGen(env, system, messages, o);
  if (env.GEMINI_API_KEY) {
    try { return await geminiGen(env, system, messages, o); }
    catch (e) { if (!env.AI) throw e instanceof Quota ? new Error('Бесплатный лимит Gemini сейчас исчерпан. Подождите минуту и повторите.') : e; }
  }
  if (env.AI) {
    try { return await cfGen(env, system, messages, o); }
    catch (e) { throw new Error('Бесплатные лимиты ИИ сейчас исчерпаны. Подождите пару минут и повторите. (' + e.message + ')'); }
  }
  throw new Error('На сервере не задан ключ GEMINI_API_KEY.');
}

/* ---------- Instagram (официальный API, Instagram Login) ---------- */
const IG = 'https://graph.instagram.com/v25.0';
async function igToken(env) {
  let t = env.IG_TOKEN || '';
  if (!env.IG_KV) return t;
  const saved = await env.IG_KV.get('token', 'json');
  if (saved && saved.token && saved.src === t) t = saved.token;
  // продлеваем токен раз в 7 дней, чтобы он не истёк через 60 дней
  if (t && (!saved || saved.src !== env.IG_TOKEN || Date.now() - (saved.at || 0) > 7 * 864e5)) {
    try {
      const r = await fetch('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(t));
      const j = await r.json();
      if (j.access_token) { t = j.access_token; await env.IG_KV.put('token', JSON.stringify({ token: t, at: Date.now(), src: env.IG_TOKEN })); }
    } catch (_) {}
  }
  return t;
}
async function instagram(env) {
  const t = await igToken(env);
  if (!t) throw new Error('Instagram не подключён: на сервере нет IG_TOKEN.');
  const get = async u => { const r = await fetch(u); const j = await r.json(); if (j.error) throw new Error('Instagram: ' + (j.error.message || 'ошибка')); return j; };
  const profile = await get(`${IG}/me?fields=user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count&access_token=${encodeURIComponent(t)}`);
  const posts = [];
  let next = `${IG}/me/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url&limit=50&access_token=${encodeURIComponent(t)}`;
  for (let i = 0; i < 4 && next; i++) { const j = await get(next); posts.push(...(j.data || [])); next = j.paging && j.paging.next; }
  return {
    profile: { username: profile.username, name: profile.name || '', followers: profile.followers_count ?? null, follows: profile.follows_count ?? null, media: profile.media_count ?? null, avatar: profile.profile_picture_url || '' },
    posts: posts.map(p => ({ id: p.id, caption: String(p.caption || '').slice(0, 2200), type: p.media_product_type === 'REELS' ? 'reels' : p.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : p.media_type === 'VIDEO' ? 'reels' : 'photo', link: p.permalink || '', ts: p.timestamp || '', likes: p.like_count ?? null, comments: p.comments_count ?? null, thumb: p.thumbnail_url || (p.media_type === 'IMAGE' || p.media_type === 'CAROUSEL_ALBUM' ? p.media_url : '') || '' }))
  };
}

/* ================= Отдел маркетинга на автопилоте =================
   Раз в неделю (Cron Trigger: пн 08:00 по Павлодару = 03:00 UTC) или кнопкой «Запустить отдел» на сайте
   агенты работают по очереди: аналитик → разведка трендов → генератор идей → SMM-план → сценарист.
   Результат пишется в коллекцию marketing: отчёт (kind:'run'), ролики в календарь (kind:'event'), идеи (kind:'idea').
   Без участия людей воркер входит в базу как отдельный сотрудник:
     AGENT_EMAIL, AGENT_PASSWORD — секреты: почта и пароль сотрудника с доступом в учёт (можно взять вход бота Ани);
     TELEGRAM_BOT_TOKEN — необязательно, секрет: тот же токен, что у бота Ани, тогда итог недели придёт в Telegram. */
const FB_API_KEY = 'AIzaSyCNpsnF-9swN11uS2L22-w9cXF45G54Hj0'; // публичный ключ из firebase-config.js
const SITE = 'https://razgulyaevevgeny.github.io/raz-studio-crm/marketing/';
const kzNow = () => new Date(Date.now() + 5 * 3600e3);               // Казахстан, UTC+5
const kzDay = () => kzNow().toISOString().slice(0, 10);
const addD = (s, n) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10);
const wdOf = s => new Date(Date.parse(s)).getUTCDay();
const WDN = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const tg = n => Math.round(n || 0).toLocaleString('ru-RU') + ' ₸';
const SVC_NAME = { vinyl: 'Винил на авто', dtf: 'DTF-печать', print3d: '3D-печать', sign3d: '3D-вывеска', embroidery: 'Вышивка', printing: 'Распечатка', kaspi: 'Kaspi', other: 'Другое' };
const SVC_RX = { 'Винил на авто': /винил|наклейк|оклейк|авто|машин|стекл|плот/i, 'DTF-печать': /dtf|дтф|футболк|худи|свитшот|принт|мерч|одежд/i, '3D-вывески и таблички': /табличк|вывеск|навигац|qr|кофе|кафе|барбер|салон/i, '3D-печать': /3d|3д|принтер|печат.*3|фигурк|bambu/i };
const ABOUT_L = { city: 'Город и адрес', contacts: 'Контакты', hours: 'График', usp: 'Чем мы лучше', services: 'Услуги и условия', audience: 'Клиенты', tone: 'Как общаемся', brand: 'Фирменный стиль', shooting: 'Чем и где снимаем', cases: 'Кейсы', goals: 'Цели на 3 месяца', tried: 'Что не сработало', notes: 'Дополнительно' };

/* ---------- Firestore REST: вход сотрудника и чтение/запись ---------- */
async function agentToken(env) {
  if (!env.AGENT_EMAIL || !env.AGENT_PASSWORD) throw new Error('Для запуска по расписанию задайте секреты AGENT_EMAIL и AGENT_PASSWORD.');
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + (env.FIREBASE_API_KEY || FB_API_KEY), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: env.AGENT_EMAIL, password: env.AGENT_PASSWORD, returnSecureToken: true })
  });
  const j = await r.json().catch(() => ({}));
  if (!j.idToken) throw new Error('Отдел не смог войти в базу: ' + ((j.error && j.error.message) || r.status));
  return j.idToken;
}
const decV = v => 'stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue
  : 'timestampValue' in v ? v.timestampValue : 'arrayValue' in v ? (v.arrayValue.values || []).map(decV) : 'mapValue' in v ? decF(v.mapValue.fields) : null;
const decF = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, decV(v)]));
const decD = d => ({ id: d.name.split('/').pop(), ...decF(d.fields) });
const encV = x => x == null ? { nullValue: null } : typeof x === 'string' ? { stringValue: x } : typeof x === 'boolean' ? { booleanValue: x }
  : typeof x === 'number' ? (Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x }) : Array.isArray(x) ? { arrayValue: { values: x.map(encV) } } : { mapValue: { fields: encF(x) } };
const encF = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encV(v)]));
function firestore(env, token) {
  const name = `projects/${env.FIREBASE_PROJECT || 'raz-studio-5a486'}/databases/(default)/documents`, root = 'https://firestore.googleapis.com/v1/' + name;
  const call = async (url, init) => {
    const r = await fetch(url, { ...init, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
    if (r.status === 404) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('База: ' + ((j.error && j.error.message) || r.status));
    return j;
  };
  return {
    async get(path) { const j = await call(root + '/' + path); return j ? decD(j) : null; },
    async query(coll, select, where) {
      const q = { from: [{ collectionId: coll }] };
      if (select) q.select = { fields: select.map(f => ({ fieldPath: f })) };
      if (where) q.where = where;
      const j = await call(root + ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: q }) });
      return (j || []).filter(x => x.document).map(x => decD(x.document));
    },
    async write(docs) { // [{ path, data, merge }]
      for (let i = 0; i < docs.length; i += 400) await call(root + ':commit', { method: 'POST', body: JSON.stringify({ writes: docs.slice(i, i + 400).map(d => ({ update: { name: name + '/' + d.path, fields: encF(d.data) }, ...(d.merge ? { updateMask: { fieldPaths: Object.keys(d.data) } } : {}) })) }) });
    }
  };
}

/* ---------- данные студии для агентов (без имён и телефонов клиентов) ---------- */
async function loadStudio(db) {
  const kinds = ['offer', 'competitor', 'idea', 'event', 'igpost', 'trend', 'run'];
  const [orders, prices, items, about, agents, ig] = await Promise.all([
    db.query('orders', ['price', 'service', 'customService', 'status', 'receivedAt', 'createdAt']),
    db.query('prices', ['svc', 'name', 'unit', 'price', 'from', 'calc', 'cost', 'mat', 'work', 'extra', 'hidden']),
    db.query('marketing', ['kind', 'title', 'status', 'date', 'type', 'format', 'price', 'audience', 'includes', 'until', 'name', 'services', 'prices', 'strong', 'weak', 'caption', 'likes', 'link', 'note', 'createdAt'],
      { fieldFilter: { field: { fieldPath: 'kind' }, op: 'IN', value: encV(kinds) } }),
    db.get('marketing/about'), db.get('marketing/agents'), db.get('marketing/ig')
  ]);
  return { orders, prices, items, about: about || {}, agents: agents || {}, ig: ig || {} };
}
function salesFacts(orders, today) {
  const day = o => o.receivedAt || (o.createdAt ? new Date(+o.createdAt + 5 * 3600e3).toISOString().slice(0, 10) : '');
  const L = orders.filter(o => o.status !== 'cancel').map(o => [day(o), SVC_NAME[o.service] || o.customService || 'Другое', +o.price || 0]).filter(([d]) => d);
  const sum = (a, b) => { const m = new Map(); L.forEach(([d, k, p]) => { if (d >= a && d <= b) { const e = m.get(k) || { n: 0, r: 0 }; e.n++; e.r += p; m.set(k, e); } }); return m; };
  const w = sum(addD(today, -6), today), w4 = sum(addD(today, -34), addD(today, -7)), m1 = sum(addD(today, -29), today), m0 = sum(addD(today, -59), addD(today, -30)), q1 = sum(addD(today, -89), today), q0 = sum(addD(today, -179), addD(today, -90));
  const keys = [...new Set([...q1.keys(), ...q0.keys()])], g = (m, k) => m.get(k) || { n: 0, r: 0 };
  const pct = (a, b) => b ? Math.round((a - b) / b * 100) + '%' : a ? 'новое' : '—';
  const rows = keys.map(k => `| ${k} | ${g(w, k).n} / ${tg(g(w, k).r)} | ${(g(w4, k).n / 4).toFixed(1)} / ${tg(g(w4, k).r / 4)} | ${g(m1, k).n} / ${tg(g(m1, k).r)} | ${g(m0, k).n} / ${tg(g(m0, k).r)} | ${pct(g(m1, k).r, g(m0, k).r)} | ${pct(g(q1, k).r, g(q0, k).r)} |`);
  return keys.length ? '| Услуга | 7 дней (заказы / выручка) | в среднем за неделю до этого | 30 дней | предыдущие 30 | Выручка 30 д к прошлым 30 | 90 д к прошлым 90 |\n|---|---|---|---|---|---|---|\n' + rows.join('\n') : 'Заказов в учёте за полгода нет.';
}
function studioContext(S, today) {
  const of = k => S.items.filter(x => x.kind === k), out = [];
  const about = Object.entries(ABOUT_L).filter(([k]) => String(S.about[k] || '').trim()).map(([k, l]) => `- **${l}:** ${String(S.about[k]).trim()}`);
  out.push('## О студии\n' + (about.join('\n') || 'Раздел «О студии» не заполнен.'));
  const unit = x => x.cost != null && x.cost !== '' ? +x.cost : (+x.mat || 0) + (+x.work || 0) + (+x.extra || 0);
  const pr = S.prices.filter(x => !x.hidden).slice(0, 90).map(x => `| ${SVC_NAME[x.svc] || x.svc || ''} | ${x.name || ''} | ${x.unit || 'шт'} | ${x.calc ? 'по расчёту' : (x.from ? 'от ' : '') + tg(x.price)} | ${!x.calc && unit(x) ? tg(unit(x)) : '—'} |`);
  out.push('## Прайс\n' + (pr.length ? '| Услуга | Позиция | За что | Цена | Себестоимость |\n|---|---|---|---|---|\n' + pr.join('\n') : 'нет данных'));
  out.push('## Продажи по услугам (посчитано точно из учёта, Kaspi не входит)\n' + salesFacts(S.orders, today));
  const offs = of('offer').filter(o => o.status !== 'archive');
  out.push('## Офферы\n' + (offs.length ? offs.map(o => `- ${o.title}${o.price ? ' — ' + o.price : ''}${o.audience ? ', для: ' + o.audience : ''}${o.until ? ', до ' + o.until : ''}`).join('\n') : 'нет'));
  const comp = of('competitor');
  if (comp.length) out.push('## Конкуренты\n' + comp.slice(0, 15).map(c => `- ${c.name}${c.services ? ' — ' + c.services : ''}${c.strong ? '. Сильные: ' + String(c.strong).replace(/\s+/g, ' ') : ''}${c.weak ? '. Слабые: ' + String(c.weak).replace(/\s+/g, ' ') : ''}`).join('\n'));
  const posts = [...((S.ig.posts || []).map(p => ({ date: String(p.ts || '').slice(0, 10), type: p.type, caption: p.caption, likes: p.likes }))), ...of('igpost').map(p => ({ date: p.date, type: p.type, caption: p.caption, likes: p.likes }))].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const cov = Object.entries(SVC_RX).map(([l, rx]) => { const P = posts.filter(p => rx.test(p.caption || '')); return `${l} — ${P.length}${P[0] ? ' (последний ' + P[0].date + ')' : ''}`; }).join('; ');
  out.push('## Instagram @raz.brandstudio\n' + (posts.length ? `Публикаций за 30 дней: ${posts.filter(p => p.date >= addD(today, -30)).length}. По услугам: ${cov}.\nПоследние:\n` + posts.slice(0, 15).map(p => `- ${p.date} ${p.type || ''}${p.likes != null ? ' ❤' + p.likes : ''}: ${String(p.caption || '').replace(/\s+/g, ' ').slice(0, 120)}`).join('\n') : 'данных нет'));
  const evs = of('event').filter(e => e.date >= addD(today, -7) && e.date <= addD(today, 30)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  out.push('## Календарь маркетинга (−7…+30 дней)\n' + (evs.length ? evs.slice(0, 50).map(e => `- ${e.date} [${e.type || ''}${e.format && e.format !== 'none' ? ', ' + e.format : ''}] ${e.title}`).join('\n') : 'пусто'));
  const ideas = of('idea').filter(x => x.status === 'new' || x.status === 'work');
  if (ideas.length) out.push('## Идеи, которые уже есть\n' + ideas.slice(0, 30).map(x => '- ' + x.title).join('\n'));
  return out.join('\n\n');
}

/* ---------- инструкции агентов отдела (можно переписать в «Справочник → Агенты») ---------- */
const DEPT = {
  analyst: `Ты — АНАЛИТИК отдела. Каждый понедельник делаешь «Сводку недели» для владельца.
Цифры продаж в данных уже посчитаны точно — не пересчитывай и не выдумывай другие.
Формат (до 250 слов, markdown):
## Что происходит — 3–5 пунктов с цифрами из таблицы продаж.
## Что просело — какие услуги упали и возможные причины (помечай «гипотеза»). Если данных мало — так и скажи.
## 3 приоритета на неделю — какие услуги толкаем контентом и каким углом подачи. Приоритет по умолчанию: винил на авто, DTF на футболках, 3D-вывески — но если цифры говорят другое, скажи.`,
  scout: `Ты — РАЗВЕДЧИК ТРЕНДОВ. Найди в интернете свежие (за последние 1–2 месяца) форматы и тренды Instagram Reels и TikTok, которые подходят мастерской брендирования: оклейка авто винилом, печать на одежде DTF, 3D-печать, вывески для кафе и барбершопов. Добавь инфоповоды и праздники в Казахстане на ближайшие 3 недели.
Выдай 5–7 пунктов: **тренд** — что это — как адаптировать для RAZ одной фразой — источник (ссылка). Только то, что реально нашёл; без воды.`,
  ideas: `Ты — ГЕНЕРАТОР ИДЕЙ для роликов. Придумай 8 идей Reels/сторис, которые закрывают просадки и приоритеты из сводки аналитика.
Опирайся на тренды из разведки и копилку трендов (ссылки, которые владелец сохранил). Не повторяй темы последних публикаций и уже существующие идеи.
Каждая идея снимается одним человеком на телефон за 15–40 минут в мастерской или у клиента.
Поля: title — название до 70 символов; service — услуга; format — reels, stories, carousel или post; hook — первые 2 секунды (текст на экране + что в кадре); why — какую просадку или приоритет закрывает и на какой тренд опирается, 1–2 предложения; source — ссылка на тренд или пусто.`,
  smm: `Ты — SMM-МЕНЕДЖЕР. Собери контент-план на неделю из идей генератора: 3–4 публикации (не больше 1 в день, только будни, даты строго внутри периода).
Не ставь на даты, где в календаре уже есть съёмка или публикация. Минимум 2 из них — Reels по приоритетным услугам.
Поля: date — ГГГГ-ММ-ДД; title — конкретно до 70 символов; format — reels, stories, carousel или post; service — услуга; idea — 2–3 предложения: что снимаем, для кого, чем цепляем и во сколько публикуем (лучшее время: будни 10:00–12:00 или 17:00–18:00); idx — номер идеи из списка (с 1).`,
  writer: `Ты — СЦЕНАРИСТ Reels. Распиши ОДИН ролик так, чтобы его можно было снять без вопросов.
- hooks — 5 разных хуков на первые 2 секунды: «текст на экране» + что в кадре. Разные углы: результат, процесс, боль клиента, цифра или цена, интрига.
- variants — РОВНО 3 варианта съёмки одного и того же ролика:
  1) «Быстро на телефон» — один человек, 10–15 минут, можно без лица;
  2) «Процесс и звук» — крупные планы, ASMR-звук работы (плоттер, ракель, принтер), без слов;
  3) «С человеком» — владелец говорит в кадр или реакция клиента на результат.
  Для каждого: name, how (1–2 предложения: в чём суть варианта), time (сколько займёт съёмка и монтаж), shots — 4–8 кадров (frame — что в кадре; angle — план и ракурс; sec — секунды, всего 15–30; onscreen — текст на экране; voice — что говорим или пусто), music — настроение и что вбить в поиск аудиотеки Instagram, edit — монтаж и обложка.
- voice — закадровый текст для варианта 1 (или пусто, если без слов);
- caption — подпись к публикации, 3–5 коротких абзацев, призыв написать в Direct или WhatsApp, без хештегов;
- hashtags — 6–10 хештегов одной строкой;
- goal — зачем этот ролик и какой результат ждём;
- prep — что подготовить до съёмки (реквизит, образцы, свет, чистый объектив);
- steps — 5–8 шагов по порядку.
Цены — только из прайса. Не выдумывай факты о студии.`
};
const S_ = { type: 'STRING' }, A_ = it => ({ type: 'ARRAY', items: it });
const SCH_IDEAS = { type: 'OBJECT', properties: { ideas: A_({ type: 'OBJECT', properties: { title: S_, service: S_, format: S_, hook: S_, why: S_, source: S_ }, required: ['title', 'hook'] }) }, required: ['ideas'] };
const SCH_PLAN = { type: 'OBJECT', properties: { events: A_({ type: 'OBJECT', properties: { date: S_, title: S_, format: S_, service: S_, idea: S_, idx: { type: 'INTEGER' } }, required: ['date', 'title'] }) }, required: ['events'] };
const SHOT = { type: 'OBJECT', properties: { frame: S_, angle: S_, sec: S_, onscreen: S_, voice: S_ }, required: ['frame'] };
const SCH_SCRIPT = { type: 'OBJECT', properties: { goal: S_, hooks: A_(S_), variants: A_({ type: 'OBJECT', properties: { name: S_, how: S_, time: S_, shots: A_(SHOT), music: S_, edit: S_ }, required: ['name', 'shots'] }), voice: S_, caption: S_, hashtags: S_, prep: A_(S_), steps: A_(S_) }, required: ['hooks', 'variants'] };
function parseJ(t) {
  t = String(t || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (_) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('ИИ ответил не в том формате');
}
// из обрезанного ответа (ИИ упёрся в лимит длины) достаём все целые объекты массива key
function salvage(t, key) {
  t = String(t || ''); const i = t.indexOf('"' + key + '"'), a = i < 0 ? -1 : t.indexOf('[', i);
  if (a < 0) return null;
  const out = []; let depth = 0, st = -1, str = false, esc = false;
  for (let k = a + 1; k < t.length; k++) {
    const c = t[k];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === '{') { if (!depth) st = k; depth++; }
    else if (c === '}') { depth--; if (!depth && st >= 0) { try { out.push(JSON.parse(t.slice(st, k + 1))); } catch (_) {} st = -1; } }
    else if (c === ']' && !depth) break;
  }
  return out.length ? { [key]: out } : null;
}
// разведка с поиском Google (бесплатный тариф Gemini); если поиск недоступен — отдел работает без неё
async function scoutTrends(env, system, task) {
  if (!env.GEMINI_API_KEY) return '';
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || GEMINI_DEFAULT}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: task }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 8192, temperature: 0.6 } })
    });
    const j = await r.json().catch(() => ({}));
    const c = (j.candidates || [])[0];
    return ((c && c.content && c.content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
  } catch (_) { return ''; }
}
function scriptNotes(s) {
  const shots = v => (v.shots || []).length ? '| Кадр | Что снимаем | Ракурс | Сек | Текст на экране |\n|---|---|---|---|---|\n' + v.shots.map((x, i) => `| ${i + 1} | ${String(x.frame || '').replace(/\|/g, '/')} | ${x.angle || ''} | ${x.sec || ''} | ${String(x.onscreen || '').replace(/\|/g, '/')} |`).join('\n') : '';
  const out = ['### 5 хуков на выбор\n' + (s.hooks || []).map((h, i) => `${i + 1}. ${h}`).join('\n')];
  (s.variants || []).forEach((v, i) => out.push(`### Вариант ${i + 1}: ${v.name || ''}${i === 0 ? ' (расписан в карточке выше)' : ''}\n${v.how || ''}${v.time ? '\n\n**Время:** ' + v.time : ''}${i ? '\n\n' + shots(v) + (v.music ? '\n\n**Музыка:** ' + v.music : '') + (v.edit ? '\n\n**Монтаж:** ' + v.edit : '') : ''}`));
  return out.join('\n\n');
}

async function runDepartment(env, opts = {}) {
  const today = kzDay(), cron = !!opts.cron;
  const db = firestore(env, opts.token || await agentToken(env));
  const runId = cron ? 'run_' + today : 'run_' + today + '_' + kzNow().toISOString().slice(11, 16).replace(':', '');
  const S = await loadStudio(db);
  const runs = S.items.filter(x => x.kind === 'run');
  if (cron && runs.some(r => r.id === runId)) return { skipped: true, runId };
  const busy = runs.find(r => r.status === 'working' && Date.now() - (+r.createdAt || 0) < 15 * 60e3);
  if (busy) throw new Error('Отдел уже работает, подождите несколько минут.');
  const start = wdOf(today) === 1 ? today : addD(today, 1), end = addD(start, 6);
  const run = { kind: 'run', status: 'working', stage: 'Аналитик смотрит продажи', date: today, period: start + '…' + end, createdAt: Date.now(), by: opts.by || 'Отдел (по расписанию)' };
  const save = patch => { Object.assign(run, patch); return db.write([{ path: 'marketing/' + runId, data: run }]); };
  await save({});
  try {
    const base = (S.agents.base && String(S.agents.base).trim()) || STUDIO;
    const ctx = studioContext(S, today);
    const sys = role => base + '\n\n' + ((S.agents['d_' + role] && String(S.agents['d_' + role]).trim()) || DEPT[role]) + '\n\n# Данные студии\n' + ctx + `\n\nСегодня: ${today} (${WDN[wdOf(today)]}). Планируем период ${start} — ${end}.`;
    const ask = (role, text, o = {}) => generate(env, sys(role), [{ role: 'user', content: text }], { json: !!o.schema, schema: o.schema || null, maxTokens: o.max || 8192, temperature: o.t ?? 0.7 });
    // JSON-ответ: до 3 попыток с запасом длины; если ответ обрезан — берём целые пункты
    const askJ = async (step, role, text, o) => {
      let last = '', eng = '';
      for (let i = 0; i < 3; i++) {
        const r = await ask(role, text, { ...o, max: Math.round(o.max * (1 + i * 0.75)), t: i ? Math.min(o.t, 0.5) : o.t });
        last = r.text; eng = r.engine;
        let j = null;
        try { j = parseJ(r.text); } catch (_) { j = o.key && salvage(r.text, o.key); }
        if (!o.key) { if (j) return j; continue; }
        // ИИ мог вернуть голый массив или назвать поле по-своему — берём первый массив в ответе
        const list = Array.isArray(j) ? j : j && (Array.isArray(j[o.key]) ? j[o.key] : Object.values(j).find(Array.isArray));
        if (list && list.length >= (o.min || 1)) return { [o.key]: list };
      }
      throw new Error(`${step}: ИИ (${eng || '?'}) ответил не в том формате. Начало ответа: ${String(last).replace(/\s+/g, ' ').slice(0, 160) || 'пусто'}`);
    };

    const summary = (await ask('analyst', 'Сделай сводку недели.', { t: 0.3 })).text.trim();
    await save({ summary, stage: 'Разведчик ищет тренды' });
    const trends = await scoutTrends(env, base + '\n\n' + DEPT.scout, `Сегодня ${today}. Найди тренды и инфоповоды.`);
    await save({ trends, stage: 'Генератор придумывает идеи' });
    const kopilka = S.items.filter(x => x.kind === 'trend' && (+x.createdAt || 0) > Date.now() - 45 * 864e5).slice(0, 20);
    const ideasIn = `Ответ — JSON вида {"ideas":[{"title":"…","service":"…","format":"reels","hook":"…","why":"…","source":""}]}\n\n## Сводка аналитика\n${summary}\n\n## Разведка трендов\n${trends || 'нет данных'}\n\n## Копилка трендов от владельца\n${kopilka.length ? kopilka.map(k => `- ${k.link || ''} — ${k.note || ''}`).join('\n') : 'пусто'}\n\nПридумай 8 идей.`;
    const ideas = ((await askJ('Генератор идей', 'ideas', ideasIn, { schema: SCH_IDEAS, max: 16000, t: 0.9, key: 'ideas', min: 4 })).ideas || [])
      .map(x => typeof x === 'string' ? { title: x, hook: '' } : { ...x, title: x.title || x.name || x['название'] || Object.values(x).find(v => typeof v === 'string') || '', hook: x.hook || x['хук'] || '' })
      .filter(x => x.title).slice(0, 10);
    if (!ideas.length) throw new Error('Генератор идей ничего не вернул');
    await save({ ideas, stage: 'SMM-менеджер собирает план' });
    const planIn = `Ответ — JSON вида {"events":[{"date":"ГГГГ-ММ-ДД","title":"…","format":"reels","service":"…","idea":"…","idx":1}]}\n\n## Сводка аналитика\n${summary}\n\n## Идеи\n${ideas.map((x, i) => `${i + 1}. ${x.title} [${x.service || ''}, ${x.format || ''}] — хук: ${x.hook}. ${x.why || ''}`).join('\n')}\n\nСобери план публикаций на ${start} — ${end}.`;
    const plan = ((await askJ('SMM-менеджер', 'smm', planIn, { schema: SCH_PLAN, max: 12000, t: 0.4, key: 'events', min: 2 })).events || [])
      .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') && e.date >= start && e.date <= end && e.title).slice(0, 4);
    if (!plan.length) throw new Error('SMM-менеджер не собрал план');
    const writes = [], eventIds = [];
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i], idea = ideas[(+p.idx || 0) - 1];
      await save({ stage: `Сценарист пишет ролик ${i + 1} из ${plan.length}` });
      let s = {};
      try { s = await askJ('Сценарист', 'writer', `Ролик: ${p.title}\nФормат: ${p.format || 'reels'}\nУслуга: ${p.service || ''}\nДата: ${p.date}\nИдея: ${p.idea || ''}${idea ? '\nИсходный хук: ' + idea.hook + '\nПочему: ' + (idea.why || '') : ''}`, { schema: SCH_SCRIPT, max: 20000, t: 0.8 }); }
      catch (e) { s = { goal: '', hooks: [], variants: [], notes: 'Сценарист не успел расписать: ' + e.message }; }
      const v = (s.variants || [])[0] || {};
      const id = 'auto' + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 8);
      eventIds.push(id);
      writes.push({ path: 'marketing/' + id, data: {
        kind: 'event', title: String(p.title).slice(0, 120), date: p.date, time: v.time || '', type: 'content', format: ['reels', 'post', 'carousel', 'stories'].includes(p.format) ? p.format : 'reels', status: 'plan', done: false,
        goal: s.goal || '', idea: (p.idea || '') + ((s.hooks || [])[0] ? '\n\nХук: ' + s.hooks[0] : ''),
        prep: (s.prep || []).map(t => ({ t: String(t), done: false })), steps: (s.steps || []).map(t => ({ t: String(t), done: false })),
        shots: (v.shots || []).map(x => ({ frame: x.frame || '', angle: x.angle || '', sec: String(x.sec || ''), onscreen: x.onscreen || '', voice: x.voice || '' })),
        voice: s.voice || '', music: v.music || '', edit: v.edit || '', caption: s.caption || '', hashtags: s.hashtags || '',
        notes: s.notes || scriptNotes(s), src: 'Отдел маркетинга, запуск ' + today, aiState: '', aiErr: '', run: runId,
        createdAt: Date.now(), updatedAt: Date.now(), by: 'Отдел маркетинга'
      } });
    }
    const used = new Set(plan.map(p => +p.idx));
    ideas.forEach((x, i) => { if (!used.has(i + 1)) writes.push({ path: 'marketing/idea' + Date.now().toString(36) + i, data: { kind: 'idea', title: String(x.title).slice(0, 200), status: 'new', notes: [x.service, x.format, 'Хук: ' + x.hook, x.why, x.source].filter(Boolean).join(' · '), run: runId, createdAt: Date.now(), updatedAt: Date.now(), by: 'Отдел маркетинга' } }); });
    await db.write(writes);
    await save({ status: 'done', stage: '', eventIds, finishedAt: Date.now() });
    if (opts.notify !== false) await notifyTeam(env, db, `Отдел маркетинга: план на ${start.slice(8)}.${start.slice(5, 7)}–${end.slice(8)}.${end.slice(5, 7)} готов.\n\n${plan.map(p => `• ${p.date.slice(8)}.${p.date.slice(5, 7)} — ${p.title}`).join('\n')}\n\nСводка, сценарии и 3 варианта съёмки: ${SITE}`).catch(() => {});
    return { ok: true, runId, events: eventIds.length, ideas: ideas.length };
  } catch (e) {
    await save({ status: 'error', stage: '', error: String(e.message || e) }).catch(() => {});
    throw e;
  }
}
async function notifyTeam(env, db, text) {
  const tok = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!tok) return;
  const chats = ((await db.get('wa_anna/telegram')) || {}).chats || [];
  for (const c of chats) if (c && c.chat) await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: c.chat, text, disable_web_page_preview: true }) });
}

/* ---------- обработчик ---------- */
export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://razgulyaevevgeny.github.io';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'vary': 'origin' };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (url.pathname === '/api/status') return json({ ok: true, engine: env.ANTHROPIC_API_KEY ? 'Claude' : env.GEMINI_API_KEY ? 'Gemini' : env.AI ? 'Llama' : null, fallback: !!env.AI, images: !!env.AI, instagram: !!env.IG_TOKEN, gen: 2, dept: true, deptAuto: !!(env.AGENT_EMAIL && env.AGENT_PASSWORD), deptTelegram: !!env.TELEGRAM_BOT_TOKEN });
    if (!['/api/ask', '/api/gen', '/api/image', '/api/instagram', '/api/department'].includes(url.pathname) || req.method !== 'POST') return json({ error: 'not found' }, 404);

    let user;
    try { user = await verifyFirebase((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.FIREBASE_PROJECT || 'raz-studio-5a486'); }
    catch (_) { return json({ error: 'Войдите на сайт учёта заново.' }, 401); }
    const allow = String(env.ALLOWED_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (allow.length && !allow.includes(String(user.email || '').toLowerCase())) return json({ error: 'Нет доступа к маркетинговому отделу.' }, 403);

    let b;
    try { b = await req.json(); } catch (_) { return json({ error: 'bad json' }, 400); }
    if (url.pathname === '/api/department') {
      // запуск отдела кнопкой: работаем с правами вошедшего сотрудника
      try { return json(await runDepartment(env, { token: (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), by: user.email || 'сотрудник', notify: !!b.notify })); }
      catch (e) { return json({ error: e.message || 'Отдел не смог отработать' }, 502); }
    }
    if (url.pathname === '/api/image') {
      try { return json({ image: await makeImage(env, b.prompt || 'branding studio workshop') }); }
      catch (e) { return json({ error: e.message || 'Не удалось нарисовать фон' }, 502); }
    }
    if (url.pathname === '/api/gen') {
      const msgs = (Array.isArray(b.messages) ? b.messages : [])
        .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
        .slice(-20).map(m => ({ role: m.role, content: m.text.slice(0, 60000) }));
      const merged = [];
      for (const m of msgs) { const l = merged.at(-1); if (l && l.role === m.role) l.content += '\n\n' + m.content; else merged.push({ ...m }); }
      while (merged.length && merged[0].role !== 'user') merged.shift();
      if (!merged.length || merged.at(-1).role !== 'user') return json({ error: 'Пустой вопрос' }, 400);
      const o = { json: !!b.json, schema: b.schema && typeof b.schema === 'object' ? b.schema : null, maxTokens: Math.max(512, Math.min(+b.maxTokens || 8192, 32768)), temperature: typeof b.temperature === 'number' ? b.temperature : 0.7 };
      try { return json(await generate(env, String(b.system || '').slice(0, 80000), merged, o)); }
      catch (e) { return json({ error: e.message || 'Не удалось получить ответ' }, 502); }
    }
    if (url.pathname === '/api/instagram') {
      try { return json(await instagram(env)); }
      catch (e) { return json({ error: e.message || 'Не удалось получить данные Instagram' }, 502); }
    }
    if (!ROLES[b.role]) return json({ error: 'Неизвестная роль' }, 400);
    const messages = (Array.isArray(b.messages) ? b.messages : [])
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
      .slice(-16).map(m => ({ role: m.role, content: m.text.slice(0, b.role === 'planner' ? 60000 : 30000) }));
    // подряд идущие сообщения одной роли склеиваем; разговор должен начинаться и заканчиваться вопросом
    const merged = [];
    for (const m of messages) { const l = merged.at(-1); if (l && l.role === m.role) l.content += '\n\n' + m.content; else merged.push({ ...m }); }
    while (merged.length && merged[0].role !== 'user') merged.shift();
    if (!merged.length || merged.at(-1).role !== 'user') return json({ error: 'Пустой вопрос' }, 400);

    try { return json(await answer(env, b.role, merged, String(b.context || '').slice(0, 24000), String(b.brief || '').slice(0, 6000))); }
    catch (e) { return json({ error: e.message || 'Не удалось получить ответ' }, 502); }
  },
  // по расписанию (Cron Trigger): отдел сам готовит план на неделю
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDepartment(env, { cron: true }).catch(e => console.log('Отдел маркетинга:', e.message || e)));
  }
};
