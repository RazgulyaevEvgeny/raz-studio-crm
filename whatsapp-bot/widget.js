// Виджеты на экран iPhone (приложение Scriptable): Kaspi, задачи, ведомость и оборудование.
// Бот раз в пару минут собирает короткую сводку и кладёт её в Realtime Database /pub/<ключ>.
// Читать её можно без входа, только зная длинный секретный ключ (как страницы заказов order.html).
// Ключ создаёт учёт (кнопка «Виджеты на iPhone») и кладёт в sig/widget/key — бот берёт его оттуда.
// В сводке нет денег, телефонов и сумм: только что сделать, сроки и состояние техники.
//
// Чтобы не тратить лимит Firestore (50 000 чтений в сутки): задачи и заказы читаем целиком раз в час,
// а между этим раз в 2 минуты спрашиваем только «что изменилось» (по отметке _ts) — пустой ответ стоит 1 чтение.
// Kaspi берём из воркера kaspi-orders (живые данные, базу не тратит), принтеры — из bambu-watch и своей копии сигналов.

import { SERVICE_NAMES } from './brain.js';

const KASPI_API = 'https://kaspi-orders.design-onegin.workers.dev';
const PRINT_API = 'https://bambu-watch.design-onegin.workers.dev/api/status';
const TICK = 2 * 60e3;          // как часто пересобираем сводку
const KASPI_EVERY = 5 * 60e3;   // Kaspi — раз в 5 минут, как уведомления в Telegram
const FULL_EVERY = 60 * 60e3;   // задачи и заказы целиком — раз в час
const BEAT = 10 * 60e3;         // даже без изменений обновляем время, чтобы виджет видел, что ПК на связи
const OPEN = ['new', 'agree', 'design', 'prod', 'ready'];
const KASPI_ACTIVE = ['NEW', 'SIGN_REQUIRED', 'PICKUP', 'DELIVERY', 'KASPI_DELIVERY'];

const kzDay = (t = Date.now()) => new Date(+t + 5 * 3600e3).toISOString().slice(0, 10);
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function startWidget({ fs, env, idToken, log }) {
  const rt = fs.rt;
  const say = (() => { const last = {}; return (k, ...a) => { const t = a.join(' '); if (last[k] !== t) { last[k] = t; log(...a); } }; })();

  // ---------- задачи и заказы: копия в памяти + догрузка изменений ----------
  const mk = (col, fullQ, keep) => ({ col, fullQ, keep, map: new Map(), maxTs: 0, fullAt: 0 });
  const tasks = mk('tasks', { where: { fieldFilter: { field: { fieldPath: 'done' }, op: 'EQUAL', value: { booleanValue: false } } } }, t => !t.done);
  const orders = mk('orders', { where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'IN', value: { arrayValue: { values: OPEN.map(stringValue => ({ stringValue })) } } } } },
    o => OPEN.includes(o.status) && !o.deletedAt);
  async function sync(s) {
    const put = d => { if (+d._ts > s.maxTs) s.maxTs = +d._ts; if (s.keep(d)) s.map.set(d.id, d); else s.map.delete(d.id); };
    if (Date.now() - s.fullAt > FULL_EVERY) {
      const list = await fs.query(s.col, s.fullQ);
      s.map.clear(); s.maxTs = 0; list.forEach(put); s.fullAt = Date.now();
      return true;
    }
    if (!s.maxTs) return false;
    const ch = await fs.query(s.col, { where: { fieldFilter: { field: { fieldPath: '_ts' }, op: 'GREATER_THAN', value: { timestampValue: new Date(s.maxTs + 1).toISOString() } } } });
    ch.forEach(put);
    return ch.length > 0;
  }

  // ---------- Kaspi ----------
  let kaspi = null, kaspiAt = 0;
  async function loadKaspi() {
    const r = await fetch(KASPI_API + '/?mode=active', { headers: { Authorization: 'Bearer ' + await idToken() } });
    if (!r.ok) throw new Error('Kaspi ' + r.status + (r.status === 403 ? ' (почты бота нет в ALLOWED_EMAILS воркера)' : ''));
    const { orders: list = [] } = await r.json();
    const today = kzDay();
    const act = list.filter(k => KASPI_ACTIVE.includes(k.state) && !k.returned && !['CANCELLED', 'CANCELLING', 'COMPLETED'].includes(k.status));
    const shipped = k => k.transmitted || ((k.assembled || k.waybill) && k.state !== 'KASPI_DELIVERY');
    const todo = act.filter(k => !shipped(k)).sort((a, b) => (+a.transmitPlan || +a.created || 0) - (+b.transmitPlan || +b.created || 0));
    const what = k => (k.items || []).map(i => cut(i.name || 'товар', 60) + (i.qty > 1 ? ' × ' + i.qty : '')).join(', ') || 'заказ ' + k.code;
    kaspi = {
      todo: todo.length,
      assemble: todo.filter(k => !(k.assembled || k.waybill)).length,
      hand: todo.filter(k => k.assembled || k.waybill).length,
      today: todo.filter(k => k.transmitPlan && kzDay(k.transmitPlan) <= today).length,
      onWay: act.filter(shipped).length,
      list: todo.slice(0, 12).map(k => ({ c: String(k.code || ''), w: cut(what(k), 90), s: k.assembled || k.waybill ? 'h' : 'a', p: +k.transmitPlan || 0 })),
    };
    kaspiAt = Date.now();
  }

  // ---------- оборудование ----------
  async function loadEquip() {
    const out = [];
    let bambu = null;
    try { bambu = (await (await fetch(PRINT_API, { cache: 'no-store' })).json()).printers || []; } catch (_) {}
    const one = (p, brand) => {
      const s = String(p.state || '').toUpperCase(), on = p.online !== false && p.online != null;
      const st = !on ? 'off' : (p.errorText || p.error) && !['IDLE', 'FINISH'].includes(s) ? 'err'
        : ['RUNNING', 'PRINTING'].includes(s) ? 'print' : ['PAUSE', 'PAUSED'].includes(s) ? 'pause'
        : ['PREPARE', 'SLICING'].includes(s) ? 'prep' : s === 'FAILED' ? 'err' : s === 'FINISH' ? 'done' : 'idle';
      const busy = ['print', 'pause', 'prep'].includes(st);
      const rem = busy && p.remain != null && p.remain !== '' ? +p.remain : null;
      return { n: cut(String(p.name || 'Принтер').replace(/^Anycubic\s*/i, ''), 24), b: brand, st,
        pc: busy && p.progress != null && p.progress !== '' ? Math.max(0, Math.min(100, Math.round(+p.progress))) : null,
        end: rem != null ? Math.round(((+p.updated || Date.now()) + rem * 60e3) / 60e3) * 60e3 : null, e: st === 'err' ? cut(p.errorText || 'ошибка', 60) : '' };
    };
    if (bambu) bambu.forEach(p => out.push(one(p, 'Bambu')));
    await rt.ready();
    const ac = rt.get('sig/printers/anycubic');
    if (ac && Date.now() - (+ac.at || 0) < 15 * 60e3) out.push(one(ac, 'Anycubic'));
    else if (ac) out.push({ n: cut(String(ac.name || 'Kobra X').replace(/^Anycubic\s*/i, ''), 24), b: 'Anycubic', st: 'off', pc: null, end: null, e: '' });
    const studio = rt.get('sig/studio') || {};
    const cam = studio.camera, fresh = t => t && Date.now() - t < 15 * 60e3;
    const devs = ((studio.tuya || {}).devices || {});
    const sens = (devs.list || []).filter(d => !/^(sp|dghsxj)$/.test(d.category));
    let smoke = 0, sOn = 0;
    if (fresh(devs.at)) for (const d of sens) {
      const s = d.status || {}, v = ['smoke_sensor_status', 'smoke_sensor_state'].map(k => s[k]).find(x => x != null);
      if (v === 'alarm' || v === '1' || v === true) smoke++;
      if (d.online) sOn++;
    }
    return { list: out, cam: cam ? (fresh(cam.at) ? (cam.online ? 'on' : 'off') : 'unk') : '', sens: sens.length, sOn, smoke, bambuErr: !bambu };
  }

  // ---------- сборка и публикация ----------
  let last = '', sentAt = 0, sentKey = '', busy = false;
  async function tick(force) {
    if (busy) return; busy = true;
    try {
      await rt.ready();
      const key = String((rt.get('sig/widget') || {}).key || '');
      if (key.length < 24) return; // ключ ещё не создали в учёте
      if (sentKey && sentKey !== key) { try { await rt.remove('pub/' + sentKey); } catch (_) {} last = ''; }
      try { await sync(tasks); await sync(orders); say('db', ''); } catch (e) { say('db', 'Виджеты: задачи/заказы не обновились:', e?.message || e); }
      let kErr = '';
      if (force || Date.now() - kaspiAt > KASPI_EVERY) {
        try { await loadKaspi(); say('k', ''); } catch (e) { kErr = String(e?.message || e); say('k', 'Виджеты:', kErr); kaspiAt = Date.now(); }
      }
      const equip = await loadEquip();
      const today = kzDay();
      const later = t => t.showFrom && t.showFrom > today;
      const tl = [...tasks.map.values()].filter(t => (t.kind === 'boss' || t.kind === 'mgr') && !later(t))
        .sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9')) || String(a.time || '').localeCompare(String(b.time || '')));
      const todayOther = [...tasks.map.values()].filter(t => !(t.kind === 'boss' || t.kind === 'mgr') && t.date && t.date <= today).length;
      const ol = [...orders.map.values()].sort((a, b) => String(a.deadline || '9').localeCompare(String(b.deadline || '9')));
      const by = {}; for (const o of ol) by[o.status] = (by[o.status] || 0) + 1;
      const data = {
        v: 1,
        kaspi: kaspi ? { ...kaspi, at: kaspiAt, err: kErr ? 1 : 0 } : { err: 1 },
        tasks: { open: tl.length, late: tl.filter(t => t.date && t.date < today).length, today: todayOther,
          list: tl.slice(0, 12).map(t => ({ t: cut(t.title, 80), d: t.date || '', tm: t.time || '', who: cut(t.who, 20) })) },
        orders: { open: ol.length, late: ol.filter(o => o.deadline && o.deadline < today && o.status !== 'ready').length,
          today: ol.filter(o => o.deadline === today).length, by,
          list: ol.slice(0, 12).map(o => ({ c: cut(o.client || 'Без имени', 30), w: cut(SERVICE_NAMES[o.service] || o.customService || o.service || '', 30), s: o.status, d: o.deadline || '' })) },
        equip,
      };
      const json = JSON.stringify(data);
      if (json === last && Date.now() - sentAt < BEAT && sentKey === key) return;
      await rt.set('pub/' + key, { ...data, at: Date.now() });
      if (!sentKey) log('Виджеты на iPhone: сводка опубликована');
      last = json; sentAt = Date.now(); sentKey = key;
    } catch (e) {
      say('w', 'Виджеты: ошибка', e?.message || e);
    } finally { busy = false; }
  }

  tick(true);
  setInterval(() => tick(false), TICK);
  // ключ создали или сменили в учёте — публикуем сразу
  let t = null;
  fs.onSignal(path => { if (path === '/' || path.startsWith('/widget')) { clearTimeout(t); t = setTimeout(() => tick(true), 1500); } });
  return { tick };
}
