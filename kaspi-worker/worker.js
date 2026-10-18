// Cloudflare Worker "kaspi-orders" — связь учёта студии с магазином Kaspi.
// Пускает только тех, кто вошёл в учёт через Firebase и есть в списке ALLOWED_EMAILS.
//
// Переменные Worker (Settings → Variables and Secrets):
//   KASPI_TOKEN       — токен API из кабинета продавца Kaspi (тип Secret!)
//   FIREBASE_API_KEY  — apiKey из firebaseConfig учёта (тип Text)
//   ALLOWED_EMAILS    — почты через запятую, кому можно (тип Text)
//
// Что умеет (параметр ?mode=):
//   active   (по умолчанию) — активные заказы за 6 недель с составом
//   archive  &to=мс&windows=N — архив (выданные и отменённые) окнами по 14 дней назад от to
//   codes    &codes=a,b,c — заказы по номерам (обновить состояние)
//   entries  &ids=a,b,c — состав заказов
//   assemble POST {id, code} — «Скомплектован»: Kaspi формирует накладную, заказ уходит в «Передачу»
//   waybill  &url=... — скачать накладную (PDF) по ссылке Kaspi

const ALLOWED_ORIGIN = 'https://razgulyaevevgeny.github.io';
const KASPI = 'https://kaspi.kz/shop/api/v2';
const ACTIVE = ['NEW', 'SIGN_REQUIRED', 'PICKUP', 'DELIVERY', 'KASPI_DELIVERY'];
const DAY = 24 * 3600 * 1000;
const WIN = 14 * DAY;
const BUDGET = 45; // бесплатный Worker — 50 запросов наружу за раз

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

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

    // 2. Запросы к Kaspi
    let used = 1;
    const H = {
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      'X-Auth-Token': String(env.KASPI_TOKEN || '').trim(),
      'User-Agent': 'Mozilla/5.0 (raz-studio-crm)',
    };
    class KaspiError extends Error { constructor(status, body) { super('kaspi'); this.status = status; this.body = body; } }
    const kget = async path => {
      used++;
      const r = await fetch(KASPI + path, { headers: H });
      if (!r.ok) throw new KaspiError(r.status, (await r.text()).slice(0, 300));
      return r.json();
    };
    const listUrl = (state, from, to, page) =>
      `/orders?page[number]=${page}&page[size]=100&filter[orders][state]=${state}` +
      `&filter[orders][creationDate][$ge]=${from}&filter[orders][creationDate][$le]=${to}&include[orders]=user`;

    const norm = (o, users) => {
      const a = o.attributes || {};
      const uid = o.relationships?.user?.data?.id;
      const c = { ...((uid && users && users.get(uid)) || {}), ...(a.customer || {}) };
      const kd = a.kaspiDelivery || {};
      return {
        id: o.id,
        code: a.code || '',
        state: a.state || '',
        status: a.status || '',
        total: a.totalPrice ?? null,
        created: a.creationDate || null,
        completed: a.completionDate || null,
        plannedDelivery: a.plannedDeliveryDate || null,
        deliveryMode: a.deliveryMode || '',
        isKaspiDelivery: !!(a.isKaspiDelivery || a.state === 'KASPI_DELIVERY' || a.kaspiDelivery),
        assembled: !!a.assembled,
        preOrder: !!a.preOrder,
        waybill: kd.waybill || '',
        waybillNumber: kd.waybillNumber || '',
        transmitted: kd.courierTransmissionDate || null,
        transmitPlan: kd.courierTransmissionPlanningDate || null,
        returned: !!kd.returnedToWarehouse,
        deliveryCost: a.deliveryCostForSeller ?? null,
        customer: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || '',
        phone: c.cellPhone || '',
        town: a.deliveryAddress?.town || '',
      };
    };
    const usersOf = d => new Map((d.included || []).map(x => [x.id, x.attributes || {}]));
    const entriesOf = async id => {
      const d = await kget(`/orders/${id}/entries?include[orderentries]=product`);
      const prods = new Map((d.included || []).map(x => [x.id, x.attributes || {}]));
      return (d.data || []).map(e => {
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
    };
    const byCode = async code => {
      const d = await kget(`/orders?filter[orders][code]=${encodeURIComponent(code)}&include[orders]=user`);
      const o = (d.data || [])[0];
      return o ? norm(o, usersOf(d)) : null;
    };

    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') || 'active';
    try {
      // --- активные заказы за 6 недель ---
      if (mode === 'active') {
        const now = Date.now(), seen = new Map(), stats = {};
        for (const state of ACTIVE) {
          stats[state] = 0;
          for (let w = 0; w < 3; w++) {
            const to = now - w * WIN, from = to - WIN + 60000;
            const d = await kget(listUrl(state, from, to, 0));
            const users = usersOf(d);
            for (const o of d.data || []) if (!seen.has(o.id)) { seen.set(o.id, norm(o, users)); stats[state]++; }
          }
        }
        const orders = [...seen.values()];
        for (const o of orders) {
          if (used >= BUDGET) break;
          try { o.items = await entriesOf(o.id); } catch (_) {}
        }
        return json({ updated: now, count: orders.length, stats, orders });
      }

      // --- архив: выданные и отменённые ---
      if (mode === 'archive') {
        let to = +url.searchParams.get('to') || Date.now();
        const windows = Math.min(+url.searchParams.get('windows') || 12, 30);
        const orders = [];
        let done = 0;
        for (; done < windows && used < BUDGET - 2; done++) {
          const from = to - WIN + 1;
          for (let page = 0; page < 20 && used < BUDGET; page++) {
            const d = await kget(listUrl('ARCHIVE', from, to, page));
            const users = usersOf(d);
            (d.data || []).forEach(o => orders.push(norm(o, users)));
            if ((d.data || []).length < 100) break;
          }
          to = from - 1;
        }
        return json({ orders, next: to, windows: done });
      }

      // --- обновить заказы по номерам ---
      if (mode === 'codes') {
        const codes = (url.searchParams.get('codes') || '').split(',').filter(Boolean).slice(0, 40);
        const orders = [];
        for (const c of codes) { const o = await byCode(c); if (o) orders.push(o); }
        return json({ orders });
      }

      // --- состав заказов ---
      if (mode === 'entries') {
        const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 40);
        const items = {};
        for (const id of ids) { try { items[id] = await entriesOf(id); } catch (_) {} }
        return json({ items });
      }

      // --- «Скомплектован»: заказ в Передачу, Kaspi формирует накладную ---
      if (mode === 'assemble' && request.method === 'POST') {
        const b = await request.json();
        if (!b || !b.id || !b.code) return json({ error: 'bad request' }, 400);
        const send = async attrs => {
          used++;
          return fetch(KASPI + '/orders', {
            method: 'POST', headers: H,
            body: JSON.stringify({ data: { type: 'orders', id: String(b.id), attributes: { code: String(b.code), status: 'ASSEMBLE', ...attrs } } }),
          });
        };
        let r = await send({ numberOfSpace: String(b.places || 1) });
        if (!r.ok && (r.status === 400 || r.status === 422)) r = await send({});
        if (!r.ok) return json({ error: 'kaspi', status: r.status, body: (await r.text()).slice(0, 300) }, 502);
        let order = null;
        try { order = await byCode(b.code); } catch (_) {}
        return json({ ok: true, order });
      }

      // --- накладная PDF ---
      if (mode === 'waybill') {
        const link = url.searchParams.get('url') || '';
        let u;
        try { u = new URL(link); } catch (_) { return json({ error: 'bad url' }, 400); }
        if (u.protocol !== 'https:' || !(u.hostname === 'kaspi.kz' || u.hostname.endsWith('.kaspi.kz'))) return json({ error: 'bad url' }, 400);
        const r = await fetch(u.toString(), { headers: { 'X-Auth-Token': H['X-Auth-Token'], 'User-Agent': H['User-Agent'] } });
        const type = r.headers.get('content-type') || '';
        if (!r.ok || !/pdf|octet-stream/i.test(type)) return json({ error: 'waybill', status: r.status, type }, 502);
        return new Response(r.body, { headers: { ...cors, 'Content-Type': 'application/pdf' } });
      }

      return json({ error: 'unknown mode' }, 400);
    } catch (e) {
      if (e instanceof KaspiError) return json({ error: 'kaspi', status: e.status, body: e.body }, 502);
      return json({ error: 'worker', message: String(e && e.message || e) }, 500);
    }
  },
};
