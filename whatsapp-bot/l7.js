// Карго L7 Cargo Pavlodar (l7cargopvl.kz) ↔ вкладка учёта «Kaspi → Из Китая».
// С 26.10.2026 кабинет L7 работает на своём сервере api.l7cargopvl.kz (раньше был Supabase).
// Бот входит туда по телефону и паролю (L7_PHONE, L7_PASSWORD в .env) и раз в 15 минут (с 8 до 22 по Павлодару):
//   - забирает этапы «Выехал из Китая», «Прошел таможню», «Готов к выдаче», «Забрали», вес и сумму карго
//     в посылки учёта (по трек-номеру);
//   - посылки, которые есть только в L7, заводит в учёт (старые выданные — сразу как «Забрали», для статистики карго);
//   - трек-номера, которые вписали только в учёт, добавляет в кабинет L7 (как кнопка «Добавить посылку»).
// Сообщения в Telegram о смене этапа шлёт notify.js — он видит, что этап в учёте изменился.
// Если L7 снова сменит адрес сервера, бот попробует найти его в скрипте сайта сам.

const SITE = 'https://l7cargopvl.kz';
const DEF_API = 'https://api.l7cargopvl.kz';
const EVERY = 15 * 60e3;
const DAY = 864e5;
const ST = { left_china: 'left', cleared_customs: 'customs', ready_for_pickup: 'ready', picked_up: 'got' };
const ORD = ['ordered', 'sent', 'left', 'customs', 'ready', 'got'];
const LEG = [3, 5, 8, 3]; // обычные дни этапов, как в учёте
const kzDay = (t = Date.now()) => new Date(t + 5 * 3600e3).toISOString().slice(0, 10);
const normTrack = s => String(s || '').replace(/\s+/g, '').toUpperCase();
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + Math.round(n))).toISOString().slice(0, 10); };
const diff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const med = v => v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
// Дата этапа по Павлодару (сервер отдаёт время в UTC или просто дату)
const dayOf = s => { const t = String(s || ''); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; const ms = Date.parse(t); return isNaN(ms) ? '' : kzDay(ms); };
// Телефон в виде +77001234567, как его отправляет сайт
function e164(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return '+' + d;
}

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

export function startL7({ fs, env, log, notify }) {
  const phone = e164(env.L7_PHONE), password = String(env.L7_PASSWORD || '').trim();
  if (phone.length < 8 || !password) { log('L7 Cargo: не заполнены L7_PHONE и L7_PASSWORD в .env, посылки из карго не подтягиваются'); return null; }
  let base = null, cookie = '', lastErr = '', lastHash = '', lastCrmAt = 0, lastMetaAt = Date.now();

  // Адрес сервера L7: обычный, а если сайт переедет — ищем в скрипте сайта
  async function apiBase() {
    if (base) return base;
    try {
      const html = await (await fetch(SITE + '/sign-in')).text();
      const src = (html.match(/src="(\/assets\/index-[^"]+\.js)"/) || [])[1];
      if (src) {
        const js = await (await fetch(SITE + src)).text();
        const m = js.match(/baseURL:"(https:\/\/[^"]+)",basePath:"\/auth"/);
        if (m) return (base = m[1].replace(/\/$/, ''));
      }
    } catch {}
    return (base = DEF_API);
  }
  const H = extra => ({ Accept: 'application/json', Origin: SITE, Referer: SITE + '/', ...(cookie ? { Cookie: cookie } : {}), ...extra });

  async function signIn() {
    const b = await apiBase();
    const r = await fetch(`${b}/auth/sign-in/phone-number`, {
      method: 'POST', headers: H({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phoneNumber: phone, password, rememberMe: true }),
    });
    if (!r.ok) {
      // Подскажем, если в кабинете вход только по SMS-коду (пароль не задан)
      let how = '';
      try { how = (await (await fetch(`${b}/auth/get-sign-in-method?phoneNumber=${encodeURIComponent(phone)}`, { headers: H() })).json())?.method || ''; } catch {}
      if (how === 'otp') throw new Error('в кабинете L7 вход только по SMS-коду: войдите на l7cargopvl.kz и задайте пароль, его же впишите в L7_PASSWORD');
      throw new Error(r.status === 401 || r.status === 400 ? 'L7 не пускает: проверьте L7_PHONE и L7_PASSWORD' : 'вход в L7: ' + r.status);
    }
    const set = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
    cookie = set.map(c => c.split(';')[0].trim()).filter(c => c && !/=$/.test(c)).join('; ');
    if (!cookie) throw new Error('L7 не выдал сессию после входа');
  }

  async function api(path, opt = {}, retry = true) {
    const b = await apiBase();
    if (!cookie) await signIn();
    const r = await fetch(b + path, { ...opt, headers: H(opt.body ? { 'Content-Type': 'application/json' } : {}) });
    if ((r.status === 401 || r.status === 403) && retry) { cookie = ''; return api(path, opt, false); }
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) { const e = new Error('L7 ' + r.status + ' ' + text.slice(0, 120)); e.status = r.status; e.data = data; throw e; }
    return data;
  }

  async function allParcels() {
    const out = [];
    for (let off = 0; off < 1000; off += 100) {
      const page = await api(`/parcels?limit=100&offset=${off}`);
      if (!Array.isArray(page)) throw new Error('L7 прислал непонятный список посылок');
      out.push(...page);
      if (page.length < 100) break;
    }
    return out;
  }

  async function datesOf(id) {
    const h = await api(`/parcels/${encodeURIComponent(id)}/status-history`);
    const dates = {};
    for (const x of Array.isArray(h) ? h : []) { const st = ST[x.status], d = dayOf(x.achievedAt); if (st && d) dates[st] = d; }
    return dates;
  }

  async function sync() {
    const h = new Date(Date.now() + 5 * 3600e3).getUTCHours();
    if (h < 8 || h >= 22) return;
    try {
      const l7 = (await allParcels()).filter(x => !x.isHiddenByClient);
      // Учёт читаем, только если в L7 что-то поменялось (или раз в 6 часов — на случай новых треков, вписанных в учёт):
      // кабинет L7 спрашивать бесплатно, а каждое чтение посылок учёта тратит квоту Firestore
      const hash = JSON.stringify(l7.map(x => [x.id, x.status, x.weightKg, x.deliveryFee, x.trackingNumber]));
      if (hash === lastHash && Date.now() - lastCrmAt < 6 * 3600e3) {
        // отметку «последняя сверка» на вкладке обновляем не чаще раза в час
        if (Date.now() - lastMetaAt > 3600e3) { lastMetaAt = Date.now(); await fs.patch('kaspi_orders/_meta', { l7SyncAt: Date.now(), l7Err: '' }); }
        lastErr = '';
        return;
      }
      const crm = await fs.query('kaspi_orders', { where: { fieldFilter: { field: { fieldPath: 'kind' }, op: 'EQUAL', value: { stringValue: 'parcel' } } } });
      const byTrack = new Map(crm.filter(p => p.track).map(p => [normTrack(p.track), p]));
      const today = kzDay();
      let upd = 0, made = 0, sent = 0;
      for (const x of l7) {
        const tr = normTrack(x.trackingNumber);
        if (!tr) continue;
        const p = byTrack.get(tr);
        const listTop = ST[x.status] || 'sent';
        // История этапов — отдельный запрос, поэтому берём её, только когда в учёте чего-то не хватает
        const need = !p || ORD.indexOf(listTop) > ORD.indexOf(p.stage) || (listTop !== 'sent' && !p.dates?.[listTop]);
        const dates = need ? await datesOf(x.id) : {};
        const top = ['got', 'ready', 'customs', 'left'].find(st => dates[st]) || listTop;
        const weight = x.weightKg != null && x.weightKg !== '' ? +x.weightKg : null;
        const cargo = x.deliveryFee != null && x.deliveryFee !== '' ? Math.round(+x.deliveryFee) : null;
        if (p) {
          const patch = {};
          if (ORD.indexOf(top) > ORD.indexOf(p.stage)) patch.stage = top; // назад этап не откатываем
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
          const old = top === 'got' || (top === 'ready' && dates.ready && diff(dates.ready, today) > 7);
          const created = dayOf(x.createdAt) || today;
          const np = {
            kind: 'parcel', title: String(x.description || 'Посылка').trim().slice(0, 120), platform: 'other', track: tr, qty: null, product: '',
            stage: old ? 'got' : top, dates: { sent: created, ...dates, ...(old && !dates.got ? { got: dates.ready || today } : {}) },
            goodsCny: null, goods: null, weight, rate: weight && cargo ? Math.round(cargo / weight) : null, cargo, cargoManual: cargo != null, extra: null,
            notes: x.comments ? 'L7: ' + x.comments : '', supplyId: '', l7Id: x.id, l7At: Date.now(), src: 'l7',
            createdAt: Date.parse(x.createdAt) || Date.now(), createdBy: 'L7 Cargo', updatedAt: Date.now(), updatedBy: 'L7 Cargo',
          };
          np.eta = etaOf(np, crm);
          if (old) np.tgStage = 'got';
          const id = 'cn-l7-' + String(x.id).replace(/[^\w-]/g, '');
          await fs.set('kaspi_orders/' + id, np);
          crm.push({ id, ...np });
          byTrack.set(tr, crm[crm.length - 1]);
          made++;
        }
      }
      // Трек есть только в учёте — добавляем в кабинет L7, как кнопка «Добавить посылку» на сайте
      const inL7 = new Set(l7.map(x => normTrack(x.trackingNumber)));
      for (const p of crm) {
        const tr = normTrack(p.track);
        if (!tr || inL7.has(tr) || p.stage === 'got' || p.l7Added) continue;
        try {
          await api('/parcels', { method: 'POST', body: JSON.stringify({ trackingNumber: tr, ...(p.title ? { description: String(p.title).slice(0, 120) } : {}) }) });
        } catch (e) {
          if (e.status !== 409) throw e; // 409 — трек уже есть в L7 (у вас или ещё без владельца), повторять не нужно
          log('L7 Cargo: трек', tr, 'уже есть в L7:', e.data?.message || '');
        }
        await fs.patch('kaspi_orders/' + p.id, { l7Added: Date.now() });
        sent++;
      }
      lastHash = hash; lastCrmAt = lastMetaAt = Date.now();
      if (upd || made) notify?.parcelsChanged?.();
      await fs.patch('kaspi_orders/_meta', { l7SyncAt: Date.now(), l7Err: '', l7Count: l7.length });
      if (upd || made || sent || lastErr) log(`L7 Cargo: обновлено ${upd}, новых из L7 ${made}, добавлено в L7 ${sent}`);
      lastErr = '';
    } catch (e) {
      const why = String(e?.message || e);
      if (why !== lastErr) { log('L7 Cargo: ошибка', why); fs.patch('kaspi_orders/_meta', { l7Err: why.slice(0, 200), l7ErrAt: Date.now() }).catch(() => {}); }
      lastErr = why;
      if (/fetch failed|ENOTFOUND|404/.test(why)) base = null;
    }
  }
  setTimeout(sync, 20e3);
  setInterval(sync, EVERY);
  return { sync };
}
