// Cloudflare Worker "kaspi-orders"
// Забирает активные заказы из магазина Kaspi и отдаёт их учёту заказов.
// Пускает только тех, кто вошёл в учёт через Firebase и есть в списке ALLOWED_EMAILS.
//
// Переменные Worker (Settings → Variables and Secrets):
//   KASPI_TOKEN       — токен API из кабинета продавца Kaspi (тип Secret!)
//   FIREBASE_API_KEY  — apiKey из firebaseConfig учёта (тип Text)
//   ALLOWED_EMAILS    — почты через запятую, кому можно видеть заказы (тип Text)

const ALLOWED_ORIGIN = 'https://razgulyaevevgeny.github.io';
const KASPI = 'https://kaspi.kz/shop/api/v2';
// Активные состояния заказа. ARCHIVE (выданные/отменённые) не берём.
const STATES = ['NEW', 'SIGN_REQUIRED', 'PICKUP', 'DELIVERY', 'KASPI_DELIVERY'];
// Kaspi отдаёт заказы окнами не больше 14 дней — смотрим 3 окна подряд, то есть 6 недель назад.
const WINDOWS = 3;
const DAY = 24 * 3600 * 1000;
const MAX_ENTRY_REQUESTS = 30; // лимит бесплатного Worker — 50 запросов наружу

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
      });

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // 1. Проверяем, что запрос пришёл от вошедшего в учёт пользователя
    const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!idToken) return json({ error: 'no auth' }, 401);

    const check = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
    );
    const who = await check.json();
    const email = who.users?.[0]?.email?.toLowerCase();
    const allowed = (env.ALLOWED_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (!email || !allowed.includes(email)) return json({ error: 'forbidden' }, 403);

    // 2. Забираем заказы из Kaspi
    const kaspiHeaders = {
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      'X-Auth-Token': String(env.KASPI_TOKEN || '').trim(),
      'User-Agent': 'Mozilla/5.0 (raz-studio-crm)',
    };
    const now = Date.now();
    const seen = new Map();
    const stats = {};

    for (const state of STATES) {
      stats[state] = 0;
      for (let w = 0; w < WINDOWS; w++) {
        const to = now - w * 14 * DAY;
        const from = to - 14 * DAY + 60 * 1000;
        const url =
          `${KASPI}/orders?page[number]=0&page[size]=100` +
          `&filter[orders][state]=${state}` +
          `&filter[orders][creationDate][$ge]=${from}` +
          `&filter[orders][creationDate][$le]=${to}` +
          `&include[orders]=user`;
        const r = await fetch(url, { headers: kaspiHeaders });
        if (!r.ok) {
          return json({ error: 'kaspi', state, status: r.status, body: (await r.text()).slice(0, 300) }, 502);
        }
        const d = await r.json();
        const users = new Map((d.included || []).map(x => [x.id, x.attributes || {}]));
        for (const o of d.data || []) {
          if (seen.has(o.id)) continue;
          stats[state]++;
          const a = o.attributes || {};
          const uid = o.relationships?.user?.data?.id;
          const c = { ...(uid && users.get(uid) || {}), ...(a.customer || {}) };
          seen.set(o.id, {
            id: o.id,
            code: a.code,
            state: a.state || state,
            status: a.status,
            total: a.totalPrice,
            created: a.creationDate,
            plannedDelivery: a.plannedDeliveryDate || a.kaspiDelivery?.courierTransmissionPlanningDate || null,
            deliveryMode: a.deliveryMode || null,
            customer: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || '',
            phone: c.cellPhone || '',
            items: [],
          });
        }
      }
    }
    const orders = [...seen.values()];

    // 3. Состав заказа (товары) — отдельный запрос на каждый заказ
    for (const o of orders.slice(0, MAX_ENTRY_REQUESTS)) {
      const r = await fetch(`${KASPI}/orders/${o.id}/entries?include[orderentries]=product`, { headers: kaspiHeaders });
      if (!r.ok) continue;
      const d = await r.json();
      const prods = new Map((d.included || []).map(x => [x.id, x.attributes || {}]));
      o.items = (d.data || []).map(e => {
        const at = e.attributes || {};
        const pid = e.relationships?.product?.data?.id;
        const p = (pid && prods.get(pid)) || {};
        return {
          name: at.offer?.name || at.product?.name || p.name || '',
          sku: at.offer?.code || p.code || '',
          qty: at.quantity || 1,
          price: at.basePrice ?? at.totalPrice ?? null,
        };
      });
    }

    return json({ updated: now, count: orders.length, stats, orders });
  },
};
