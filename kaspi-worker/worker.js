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
const MAX_ENTRY_REQUESTS = 35; // лимит бесплатного Worker — 50 запросов наружу

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

    // 2. Забираем заказы из Kaspi (API отдаёт максимум за 14 дней)
    const kaspiHeaders = {
      'Content-Type': 'application/vnd.api+json',
      'X-Auth-Token': env.KASPI_TOKEN,
      'User-Agent': 'Mozilla/5.0 (raz-studio-crm)',
    };
    const now = Date.now();
    const from = now - 14 * 24 * 3600 * 1000 + 60 * 1000;

    const orders = [];
    for (const state of STATES) {
      const url =
        `${KASPI}/orders?page[number]=0&page[size]=100` +
        `&filter[orders][state]=${state}` +
        `&filter[orders][creationDate][$ge]=${from}` +
        `&filter[orders][creationDate][$le]=${now}` +
        `&include[orders]=user`;
      const r = await fetch(url, { headers: kaspiHeaders });
      if (!r.ok) {
        return json({ error: 'kaspi', state, status: r.status, body: (await r.text()).slice(0, 300) }, 502);
      }
      const d = await r.json();
      for (const o of d.data || []) {
        const a = o.attributes || {};
        const c = a.customer || {};
        orders.push({
          id: o.id,
          code: a.code,
          state: a.state,
          status: a.status,
          total: a.totalPrice,
          created: a.creationDate,
          plannedDelivery: a.plannedDeliveryDate || null,
          deliveryMode: a.deliveryMode || null,
          customer: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || '',
          phone: c.cellPhone || '',
          items: [],
        });
      }
    }

    // 3. Состав заказа (товары) — отдельный запрос на каждый заказ
    for (const o of orders.slice(0, MAX_ENTRY_REQUESTS)) {
      const r = await fetch(`${KASPI}/orders/${o.id}/entries`, { headers: kaspiHeaders });
      if (!r.ok) continue;
      const d = await r.json();
      o.items = (d.data || []).map(e => ({
        name: e.attributes?.offer?.name || e.attributes?.product?.name || '',
        sku: e.attributes?.offer?.code || '',
        qty: e.attributes?.quantity || 1,
        price: e.attributes?.basePrice ?? e.attributes?.totalPrice ?? null,
      }));
    }

    return json({ updated: now, count: orders.length, orders });
  },
};
