/* Маркетинговый отдел RAZ Brand Studio — сервер-посредник между сайтом учёта и Claude.
   Хранит ключ Claude (секрет ANTHROPIC_API_KEY), пускает только сотрудников,
   вошедших на сайт через Firebase, и задаёт роли трёх специалистов.

   Переменные (Settings → Variables):
     ANTHROPIC_API_KEY  — секрет, ключ из console.anthropic.com
     FIREBASE_PROJECT   — raz-studio-5a486
     ALLOWED_ORIGIN     — https://razgulyaevevgeny.github.io
     MODEL              — необязательно, по умолчанию claude-sonnet-5-5
     ALLOWED_EMAILS     — необязательно: почты через запятую; пусто — пускать всех вошедших */

const DEFAULT_MODEL = 'claude-sonnet-5-5';

/* ---------- общая часть для всех ролей ---------- */
const STUDIO = `Ты работаешь в маркетинговом отделе студии брендирования RAZ Brand Studio (Казахстан, Instagram @raz.brandstudio).
Владелец — Евгений. В студии работают двое: Евгений и его жена (менеджер Милана тоже есть в учёте). Времени мало, поэтому всё, что предлагаешь, должно выполняться силами 1–2 человек.
Рекламного бюджета сейчас НЕТ: таргет, платных блогеров и платные площадки не предлагай, пока об этом не попросят. Только бесплатные и почти бесплатные каналы: Instagram, WhatsApp, Telegram-чаты города, 2ГИС, Kaspi, сарафан, партнёрства, офлайн-визиты.
Оборудование: 3D-принтер Bambu Lab A1, DTF-печать, плоттер для винила, вышивка.
Приоритетные услуги (по ним просадка, их нужно продавать в первую очередь):
1) виниловые наклейки на авто — логотипы, инстаграмы, надписи;
2) DTF-печать на футболках — мерч для компаний, команд, мероприятий;
3) 3D-печатные таблички и вывески, брендированные под заведения (кафе, кофейни, барбершопы, салоны) — направление только запускается.
Также студия делает 3D-топперы (есть отдельный сайт для заявок), распечатку и продаёт на Kaspi.
У студии есть собственный сайт учёта (CRM) — в нём ведутся заказы, прайс и аналитика. Ниже в разделе «Данные из учёта» — живые цифры оттуда. Опирайся на них, а не на выдуманные.

Правила:
- Пиши по-русски, просто и по делу, без воды и канцелярита. Казахский — только если попросят.
- Не выдумывай цифры, цены конкурентов, факты о городе. Если данных нет — так и скажи и предложи, как их добыть. Любое допущение помечай «допущение».
- Сначала готовый результат (план, тексты, таблица), потом коротко «почему так» в 1–3 строки.
- Заканчивай блоком «Что сделать сегодня» — не больше 3 конкретных действий по 30–60 минут.
- Оформление: markdown — заголовки ##, списки, **жирный**, таблицы. Без эмодзи-мусора.
- Не обещай результат в цифрах (заявки, выручка) — давай гипотезы и способ их проверить.`;

const ROLES = {
  marketer: {
    name: 'Маркетолог',
    search: true,
    prompt: `Твоя роль — МАРКЕТОЛОГ-СТРАТЕГ студии.
Отвечаешь за: маркетинговую стратегию и план на месяц/квартал, позиционирование, офферы и пакеты услуг, ценообразование, акции без демпинга, коммерческие предложения (КП) для заведений и компаний, скрипты продаж, воронку и работу с заявками, поиск клиентов без бюджета (холодные сообщения в Direct/WhatsApp, 2ГИС, партнёрства с автомойками, детейлингом, СТО, ивент-агентствами, спортклубами, открывающимися кафе).
Анализ цен: сравнивай прайс студии с себестоимостью и наценкой из учёта, показывай где наценка низкая, где цену можно поднять, какие позиции собрать в пакеты. Цены конкурентов бери только из поиска с источником или из данных аналитика, иначе помечай как допущение.
Для винила на авто владелец не понимает боли клиентов — не придумывай их как факт: давай гипотезы и вопросы для интервью с реальными клиентами.
Формат стратегии: цель → сегменты → оффер для каждого → каналы → план по неделям → метрики (что считать в учёте).`
  },
  smm: {
    name: 'SMM-менеджер',
    search: false,
    prompt: `Твоя роль — SMM-МЕНЕДЖЕР студии, ведёшь Instagram @raz.brandstudio.
Отвечаешь за: контент-план (неделя/месяц) таблицей «день — формат — тема — цель — призыв», сценарии Reels покадрово (хук в первые 2 секунды → процесс → результат → призыв; что снимать, сколько секунд кадр, текст на экране, звук), тексты постов и подписей, сторис с опросами и квизами для сбора заявок, рубрикатор, шапку профиля и Highlights, хештеги и гео, ответы на комментарии и в Direct, идеи коллабораций с местными аккаунтами.
Главный бесплатный ресурс — сам процесс в мастерской: печать на 3D-принтере, нарезка и поклейка винила, перенос DTF. Это залипательный контент — строй план вокруг него, «до/после», кейсов клиентов и «сколько стоит».
Учитывай, что снимает 1 человек на телефон между заказами: не больше 3–4 публикаций в неделю, сценарии на 15–30 секунд.
Стритвир-бренд владельца «РЗГ» (@wear.rzg) — отдельный аккаунт, его можно упоминать как кейс DTF-качества, но не смешивать.`
  },
  analyst: {
    name: 'Аналитик',
    search: true,
    prompt: `Твоя роль — АНАЛИТИК РЫНКА И КОНКУРЕНТОВ.
Отвечаешь за: поиск и разбор конкурентов (студии брендирования, оклейка авто, DTF и печать на одежде, 3D-печать, рекламные агентства, изготовители вывесок) в городе студии и по Казахстану; сбор их цен, ассортимента, сроков, позиционирования, активности в Instagram, отзывов в 2ГИС; сравнение с RAZ Brand Studio; спрос и сезонность; портреты целевых клиентов по каждой услуге.
У тебя есть веб-поиск — ИСПОЛЬЗУЙ его, прежде чем делать выводы о конкурентах и ценах рынка. Ищи на русском, добавляй город. Смотри сайты, 2ГИС, Instagram, OLX, Satu, Kaspi.
Правила: каждая цена и факт о конкуренте — с источником (ссылкой). Не нашёл — пиши «не нашёл в открытых источниках», не выдумывай. Отделяй факты от выводов.
Формат разбора: таблица конкурентов (название — что делают — цены — сильные стороны — слабые места — ссылка) → где RAZ сильнее → где слабее → 3 возможности, которые можно забрать прямо сейчас.
Если город студии не указан в брифе — спроси его одной строкой, прежде чем искать.`
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

/* ---------- запрос к Claude ---------- */
async function askClaude(env, role, messages, context, brief) {
  const R = ROLES[role];
  const system = [
    { type: 'text', text: STUDIO + '\n\n' + R.prompt, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: '## Бриф студии (заполняет владелец)\n' + (brief || 'Бриф пока не заполнен — если для задачи нужен город, ЦА или конкуренты, спроси.') + '\n\n## Данные из учёта\n' + (context || 'Нет данных.') + '\n\nСегодня: ' + new Date().toISOString().slice(0, 10) }
  ];
  const tools = R.search ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: role === 'analyst' ? 8 : 4, user_location: { type: 'approximate', country: 'KZ', timezone: 'Asia/Almaty' } }] : undefined;
  let msgs = messages.slice();
  const sources = new Map();
  let text = '', usage = { input: 0, output: 0, searches: 0 };
  for (let round = 0; round < 4; round++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env.MODEL || DEFAULT_MODEL, max_tokens: 6000, system, messages: msgs, ...(tools ? { tools } : {}) })
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Claude ответил ' + r.status));
    usage.input += j.usage?.input_tokens || 0; usage.output += j.usage?.output_tokens || 0;
    usage.searches += j.usage?.server_tool_use?.web_search_requests || 0;
    for (const b of j.content || []) {
      if (b.type === 'text') {
        text += b.text;
        (b.citations || []).forEach(c => c.url && !sources.has(c.url) && sources.set(c.url, c.title || c.url));
      }
    }
    if (j.stop_reason !== 'pause_turn') break;
    msgs = [...msgs, { role: 'assistant', content: j.content }];
  }
  return { text: text.trim(), sources: [...sources].map(([url, title]) => ({ url, title })).slice(0, 20), usage };
}

/* ---------- обработчик ---------- */
export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://razgulyaevevgeny.github.io';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'vary': 'origin' };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (url.pathname === '/api/roles') return json({ roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, { name: v.name, search: v.search }])) });
    if (url.pathname !== '/api/ask' || req.method !== 'POST') return json({ error: 'not found' }, 404);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'На сервере не задан ключ ANTHROPIC_API_KEY.' }, 500);

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
    if (!messages.length || messages.at(-1).role !== 'user') return json({ error: 'Пустой вопрос' }, 400);
    // подряд идущие сообщения одной роли склеиваем — так требует Claude
    const merged = [];
    for (const m of messages) { const l = merged.at(-1); if (l && l.role === m.role) l.content += '\n\n' + m.content; else merged.push({ ...m }); }
    if (merged[0].role !== 'user') merged.shift();

    try {
      const out = await askClaude(env, b.role, merged, String(b.context || '').slice(0, 20000), String(b.brief || '').slice(0, 6000));
      return json(out);
    } catch (e) { return json({ error: 'Не удалось получить ответ: ' + e.message }, 502); }
  }
};
