// Карго L7 Cargo Pavlodar (l7cargopvl.kz) ↔ вкладка учёта «Kaspi → Из Китая».
// Личный кабинет L7 работает на Supabase: бот входит туда по телефону и паролю (L7_PHONE, L7_PASSWORD в .env)
// и раз в 15 минут (с 8 до 22 по Павлодару):
//   - забирает этапы «Выехал из Китая», «Прошел таможенный пост», «Готов к выдаче», вес и сумму карго в посылки учёта (по трек-номеру);
//   - посылки, которые есть только в L7, заводит в учёт (старые выданные — сразу как «Забрали», для статистики карго);
//   - трек-номера, которые вписали только в учёт, добавляет в кабинет L7 (как кнопка «Добавить посылку»).
// Сообщения в Telegram о смене этапа шлёт notify.js — он видит, что этап в учёте изменился.
// Адрес базы и открытый ключ (anon) L7 бот берёт со страницы l7cargopvl.kz сам, их не нужно никуда вписывать.
// Читаем только свои посылки (фильтр по своему user_id).

const SITE = 'https://l7cargopvl.kz';
const EVERY = 15 * 60e3;
const DAY = 864e5;
const ST = { 'Выехал из Китая': 'left', 'Прошел таможенный пост': 'customs', 'Готов к выдаче': 'ready' };
const ORD = ['ordered', 'sent', 'left', 'customs', 'ready', 'got'];
const LEG = [3, 5, 8, 3]; // обычные дни этапов, как в учёте
const kzDay = (t = Date.now()) => new Date(t + 5 * 3600e3).toISOString().slice(0, 10);
const normTrack = s => String(s || '').replace(/\s+/g, '').toUpperCase();
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + Math.round(n))).toISOString().slice(0, 10); };
const diff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const med = v => v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);

// Та же формула «придёт ≈», что в учёте: от даты текущего этапа по медиане ваших посылок (или по обычным срокам)
export function etaOf(p, all) {
  const legs = LEG.map((def, i) => {
    const a = ORD[i], b = ORD[i + 1];
    const v = all.map(x => x.dates?.[a] && x.dates?.[b] ? diff(x.dates[a], x.dates[b]) : null).filter(x => x != null && x >= 0 && x <= 90).sort((x, y) => x - y);
    return v.length >= 2 ? med(v) : def;
  });
  const i = Math.max(0, ORD.indexOf(p.stage));
  if (i >= 4) return p.dates?.ready || null;
  const base = p.dates?.[p.stage] || p.dates?.ordered || kzDay(p.createdAt || Date.now());
  return addDays(base, legs.slice(i, 4).reduce((s, x) => s + x, 0));
}

export function startL7({ fs, env, log }) {
  const phone = String(env.L7_PHONE || '').trim(), password = String(env.L7_PASSWORD || '').trim();
  if (!phone || !password) { log('L7 Cargo: не заполнены L7_PHONE и L7_PASSWORD в .env, посылки из карго не подтягиваются'); return null; }
  let cfg = null, sess = null, lastErr = '';

  // Адрес Supabase и открытый ключ — из скрипта сайта (сайт обновится — найдём заново)
  async function config() {
    if (cfg) return cfg;
    const html = await (await fetch(SITE + '/sign-in')).text();
    const src = (html.match(/src="(\/assets\/index-[^"]+\.js)"/) || [])[1];
    if (!src) throw new Error('не нашёл скрипт сайта L7');
    const js = await (await fetch(SITE + src)).text();
    const url = (js.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
    const key = (js.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g) || []).find(k => {
      try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { return false; }
    });
    if (!url || !key) throw new Error('не нашёл адрес базы L7 на сайте');
    return (cfg = { url, key });
  }
  async function auth(force) {
    const { url, key } = await config();
    if (sess && !force && Date.now() < sess.until) return sess;
    const body = sess?.refresh && !force ? { refresh_token: sess.refresh } : { phone, password };
    const grant = body.refresh_token ? 'refresh_token' : 'password';
    let r = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok && grant === 'refresh_token') r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ phone, password }) });
    if (!r.ok) throw new Error(r.status === 400 ? 'L7 не пускает: проверьте L7_PHONE и L7_PASSWORD' : 'вход в L7: ' + r.status);
    const j = await r.json();
    return (sess = { token: j.access_token, refresh: j.refresh_token, uid: j.user?.id, until: Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000 });
  }
  async function api(path, opt = {}, retry = true) {
    const { url, key } = await config(), s = await auth();
    const r = await fetch(`${url}/rest/v1/${path}`, { ...opt, headers: { apikey: key, Authorization: 'Bearer ' + s.token, 'content-type': 'application/json', ...(opt.headers || {}) } });
    if (r.status === 401 && retry) { sess = null; return api(path, opt, false); }
    if (!r.ok) throw new Error('L7 ' + r.status + ' ' + (await r.text()).slice(0, 120));
    return r.status === 204 ? null : r.json();
  }

  async function sync() {
    const h = new Date(Date.now() + 5 * 3600e3).getUTCHours();
    if (h < 8 || h >= 22) return;
    try {
      const s = await auth();
      const l7 = await api(`parcels?select=id,created_at,track_number,description,weight,sum,info,status_history(status,date)&user_id=eq.${s.uid}&is_hidden=eq.false&order=created_at.desc&limit=500`);
      const crm = await fs.query('kaspi_orders', { where: { fieldFilter: { field: { fieldPath: 'kind' }, op: 'EQUAL', value: { stringValue: 'parcel' } } } });
      const byTrack = new Map(crm.filter(p => p.track).map(p => [normTrack(p.track), p]));
      const today = kzDay();
      let upd = 0, made = 0, sent = 0;
      for (const x of l7) {
        const tr = normTrack(x.track_number);
        if (!tr) continue;
        const dates = {};
        for (const h of x.status_history || []) { const st = ST[h.status]; if (st && h.date) dates[st] = String(h.date).slice(0, 10); }
        const top = ['ready', 'customs', 'left'].find(st => dates[st]) || 'sent';
        const weight = x.weight != null ? +x.weight : null, cargo = x.sum != null ? Math.round(+x.sum) : null;
        const p = byTrack.get(tr);
        if (p) {
          const patch = {};
          const cur = ORD.indexOf(p.stage);
          if (ORD.indexOf(top) > cur && p.stage !== 'got') patch.stage = top; // назад этап не откатываем, «Забрали» не трогаем
          const nd = { ...(p.dates || {}) };
          let dch = false;
          for (const [k, v] of Object.entries(dates)) if (nd[k] !== v) { nd[k] = v; dch = true; }
          if (dch) patch.dates = nd;
          if (weight != null && +p.weight !== weight) patch.weight = weight;
          if (cargo != null && +p.cargo !== cargo) { patch.cargo = cargo; patch.cargoManual = true; }
          if (p.l7Id !== x.id) patch.l7Id = x.id;
          if (Object.keys(patch).length) {
            const np = { ...p, ...patch };
            patch.eta = etaOf(np, crm);
            patch.l7At = Date.now();
            patch.updatedAt = Date.now();
            patch.updatedBy = 'L7 Cargo';
            await fs.patch('kaspi_orders/' + p.id, patch);
            Object.assign(p, patch);
            upd++;
          }
        } else {
          // В учёте такой посылки нет: заводим. Выданную больше недели назад считаем забранной (для статистики карго и сроков)
          const old = top === 'ready' && dates.ready && diff(dates.ready, today) > 7;
          const created = String(x.created_at || '').slice(0, 10) || today;
          const np = {
            kind: 'parcel', title: String(x.description || 'Посылка').trim().slice(0, 120), platform: 'other', track: tr, qty: null, product: '',
            stage: old ? 'got' : top, dates: { sent: created, ...dates, ...(old ? { got: dates.ready } : {}) },
            goodsCny: null, goods: null, weight, rate: weight && cargo ? Math.round(cargo / weight) : null, cargo, cargoManual: cargo != null, extra: null,
            notes: x.info ? 'L7: ' + x.info : '', supplyId: '', l7Id: x.id, l7At: Date.now(), src: 'l7',
            createdAt: Date.parse(x.created_at) || Date.now(), createdBy: 'L7 Cargo', updatedAt: Date.now(), updatedBy: 'L7 Cargo',
          };
          np.eta = etaOf(np, crm);
          if (old) np.tgStage = 'got';
          await fs.set('kaspi_orders/cn-l7-' + x.id, np);
          crm.push({ id: 'cn-l7-' + x.id, ...np });
          made++;
        }
      }
      // Трек есть только в учёте — добавляем в кабинет L7, как кнопка «Добавить посылку» на сайте
      const inL7 = new Set(l7.map(x => normTrack(x.track_number)));
      for (const p of crm) {
        const tr = normTrack(p.track);
        if (!tr || inL7.has(tr) || p.stage === 'got' || p.l7Added) continue;
        await api('parcels?on_conflict=track_number', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ track_number: tr, description: String(p.title || '').slice(0, 120), user_id: s.uid, is_hidden: false }) });
        await fs.patch('kaspi_orders/' + p.id, { l7Added: Date.now() });
        sent++;
      }
      await fs.patch('kaspi_orders/_meta', { l7SyncAt: Date.now(), l7Err: '', l7Count: l7.length });
      if (upd || made || sent) log(`L7 Cargo: обновлено ${upd}, новых из L7 ${made}, добавлено в L7 ${sent}`);
      lastErr = '';
    } catch (e) {
      const why = String(e?.message || e);
      if (why !== lastErr) { log('L7 Cargo: ошибка', why); fs.patch('kaspi_orders/_meta', { l7Err: why.slice(0, 200), l7ErrAt: Date.now() }).catch(() => {}); }
      lastErr = why;
      if (/не нашёл/.test(why)) cfg = null;
    }
  }
  setTimeout(sync, 20e3);
  setInterval(sync, EVERY);
  return { sync };
}
