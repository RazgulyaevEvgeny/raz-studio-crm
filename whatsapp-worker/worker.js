// Cloudflare Worker "whatsapp-bot" — уведомления клиентам студии в WhatsApp.
// Учёт вызывает его, когда менеджер меняет статус заказа или переносит срок.
// Пускает только тех, кто вошёл в учёт через Firebase и есть в списке ALLOWED_EMAILS.
//
// Переменные Worker (Settings → Variables and Secrets):
//   WA_TOKEN          — постоянный токен WhatsApp Cloud API из кабинета Meta (тип Secret!)
//   WA_PHONE_ID       — Phone number ID рабочего номера из кабинета Meta (тип Text)
//   FIREBASE_API_KEY  — apiKey из firebaseConfig учёта (тип Text)
//   FIREBASE_PROJECT  — projectId из firebaseConfig учёта, например raz-studio-5a486 (тип Text)
//   ALLOWED_EMAILS    — почты через запятую, кому можно (тип Text)
//
// Пока WA_TOKEN или WA_PHONE_ID не заполнены, воркер ничего не отправляет и отвечает {skipped:'off'}.
//
// Запрос: POST {id, event}
//   event 'status' — сообщение по текущему статусу заказа (Новый, Макет, Производство, Готов)
//   event 'delay'  — сообщение о переносе срока на новую дату
// Каждое сообщение уходит один раз: что отправлено, воркер помечает в заказе (поле waSent).

const ALLOWED_ORIGIN = 'https://razgulyaevevgeny.github.io';
const GRAPH = 'https://graph.facebook.com/v23.0';
const LANG = 'ru';
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Шаблоны сообщений. Названия должны совпадать с шаблонами, одобренными в кабинете Meta.
// Тексты шаблонов — в README, раздел «WhatsApp: уведомления клиентам».
const TEMPLATES = {
  new:    { name: 'order_accepted',   params: o => [o.client, o.num, o.due] },
  design: { name: 'order_design',     params: o => [o.client, o.num] },
  prod:   { name: 'order_production', params: o => [o.client, o.num, o.due] },
  ready:  { name: 'order_ready',      params: o => [o.client, o.num] },
  delay:  { name: 'order_delay',      params: o => [o.client, o.num, o.due] },
};

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ error: 'method' }, 405);

    // 1. Кто спрашивает
    const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!idToken) return json({ error: 'no auth' }, 401);
    const who = await (await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
    )).json();
    const email = who.users?.[0]?.email?.toLowerCase();
    const allowed = (env.ALLOWED_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (!email || !allowed.includes(email)) return json({ error: 'forbidden' }, 403);

    if (!env.WA_TOKEN || !env.WA_PHONE_ID) return json({ skipped: 'off' });

    let body = {};
    try { body = await request.json(); } catch (_) {}
    const id = String(body.id || '');
    const event = body.event === 'delay' ? 'delay' : 'status';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: 'bad id' }, 400);

    // 2. Заказ из базы (читаем правами сотрудника, который нажал кнопку)
    const docUrl = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents/orders/${id}`;
    const fsH = { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' };
    const r = await fetch(docUrl, { headers: fsH });
    if (!r.ok) return json({ error: 'order', status: r.status }, 502);
    const o = fromFirestore((await r.json()).fields || {});

    // 3. Что отправить
    if (o.service === 'kaspi' || (Array.isArray(o.kaspi) && o.kaspi.length)) return json({ skipped: 'kaspi' });
    const phone = normPhone(o.phone);
    if (!phone) return json({ skipped: 'no phone' });
    const kind = event === 'delay' ? 'delay' : o.status;
    const tpl = TEMPLATES[kind];
    if (!tpl) return json({ skipped: 'status' });
    if ((kind === 'new' || kind === 'prod' || kind === 'delay') && !o.deadline) return json({ skipped: 'no deadline' });
    const key = kind === 'delay' ? 'delay_' + o.deadline : kind;
    const sent = o.waSent && typeof o.waSent === 'object' ? o.waSent : {};
    if (sent[key]) return json({ skipped: 'already sent' });

    const view = {
      client: String(o.client || '').trim() || 'клиент',
      num: String(o.num || '').padStart(3, '0'),
      due: fmtDue(o.deadlineFrom, o.deadline),
    };

    // 4. Отправка шаблона через WhatsApp Cloud API
    const wa = await fetch(`${GRAPH}/${env.WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + String(env.WA_TOKEN).trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: tpl.name,
          language: { code: LANG },
          components: [{ type: 'body', parameters: tpl.params(view).map(text => ({ type: 'text', text: String(text) })) }],
        },
      }),
    });
    const res = await wa.json().catch(() => ({}));
    if (!wa.ok) return json({ error: 'whatsapp', status: wa.status, message: res.error?.message || '' }, 502);

    // 5. Помечаем, что это сообщение уже ушло
    sent[key] = Date.now();
    await fetch(docUrl + '?updateMask.fieldPaths=waSent', {
      method: 'PATCH', headers: fsH, body: JSON.stringify({ fields: { waSent: toFirestore(sent) } }),
    }).catch(() => {});

    return json({ ok: true, template: tpl.name, to: phone });
  },
};

// Казахстанские номера: «+7 707 123 45 67», «8 707…», «707…» → 77071234567
function normPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d.length === 11 && d[0] === '7' ? d : '';
}

// «2026-10-25» → «25 октября», диапазон → «23–25 октября»
function fmtDue(from, to) {
  const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? { d: +m[3], m: +m[2] - 1 } : null; };
  const b = p(to);
  if (!b) return '';
  const a = p(from);
  if (a && a.m === b.m && a.d < b.d) return `${a.d}–${b.d} ${MONTHS_GEN[b.m]}`;
  if (a && (a.m !== b.m)) return `${a.d} ${MONTHS_GEN[a.m]} – ${b.d} ${MONTHS_GEN[b.m]}`;
  return `${b.d} ${MONTHS_GEN[b.m]}`;
}

function fromFirestore(fields) {
  const val = v => {
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return +v.integerValue;
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
    if ('mapValue' in v) return fromFirestore(v.mapValue.fields || {});
    return null;
  };
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, val(v)]));
}

function toFirestore(map) {
  return { mapValue: { fields: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { integerValue: String(v) }])) } };
}
