// Realtime Database (вторая база того же проекта Firebase) для «сигналов» между учётом и ботами.
// Почему отдельно от Firestore: в Realtime Database бесплатный лимит считается по трафику (10 ГБ в месяц),
// а не по числу чтений. Сигналы читаются постоянно, поэтому их место здесь, и квоту Firestore они больше не тратят.
//
// Что лежит в /sig (всё маленькое):
//   sig/anna/digest, request, insights, done, watches — сводка Ани, просьбы «обновить», отмеченные дела, оповещения
//   sig/annaQ/<id>   — вопросы сотрудников Ане {q, at, by, status:'new'|'done', a, answeredAt}
//   sig/outbox/<id>  — задания боту на уведомление клиенту {orderId, event, at, by}
//   sig/daulet, sig/dauletReq — сводка Даулета и кнопка «Обновить данные»
// А в /pub/<ключ> — страницы заказов для клиентов (order.html читает их без входа, только зная ключ).
//
// Бот держит у себя копию всего /sig: один постоянный поток (Server-Sent Events) присылает изменения сам,
// поэтому «есть что новое?» бот спрашивает у своей памяти — бесплатно и мгновенно.

export const RTDB_URL = 'https://raz-studio-5a486-default-rtdb.europe-west1.firebasedatabase.app';

const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
const parts = p => String(p || '').split('/').filter(Boolean);

export function startRtdb({ url = RTDB_URL, token, log: log0 = () => {} }) {
  let log = log0;
  let tree = null, ready = false, resolveReady;
  const readyP = new Promise(r => (resolveReady = r));
  const subs = new Set();
  let lastErr = '';

  const getAt = (obj, path) => { let o = obj; for (const k of parts(path)) { if (o == null || typeof o !== 'object') return null; o = o[k]; } return o ?? null; };
  function setAt(path, val) {
    const ps = parts(path);
    if (!ps.length) { tree = val; return; }
    if (tree == null || typeof tree !== 'object') tree = {};
    let o = tree;
    for (const k of ps.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    const last = ps[ps.length - 1];
    if (val == null) delete o[last]; else o[last] = val;
  }
  const fire = path => { for (const f of subs) { try { f(path); } catch (_) {} } };

  // ---------- поток изменений /sig ----------
  async function stream() {
    for (;;) {
      try {
        const tok = await token();
        const r = await fetch(`${url}/sig.json?auth=${encodeURIComponent(tok)}`, { headers: { Accept: 'text/event-stream' } });
        if (!r.ok) throw new Error('поток ' + r.status + (r.status === 401 ? ' (правила Realtime Database не опубликованы?)' : ''));
        if (lastErr) log('Realtime Database: связь восстановлена');
        lastErr = '';
        const reader = r.body.getReader(), dec = new TextDecoder();
        let buf = '', again = false;
        while (!again) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = (chunk.match(/^event: ?(.*)$/m) || [])[1] || '';
            const data = (chunk.match(/^data: ?(.*)$/m) || [])[1] || 'null';
            if (ev === 'put' || ev === 'patch') {
              const d = JSON.parse(data);
              if (ev === 'put') setAt(d.path, d.data);
              else for (const [k, v] of Object.entries(d.data || {})) setAt(d.path.replace(/\/$/, '') + '/' + k, v);
              if (!ready) { ready = true; resolveReady(); }
              fire(d.path);
            } else if (ev === 'auth_revoked' || ev === 'cancel') { again = true; break; }
          }
        }
        try { reader.cancel(); } catch (_) {}
      } catch (e) {
        const why = String(e?.message || e);
        if (why !== lastErr) log('Realtime Database:', why, '— переподключаюсь');
        lastErr = why;
        if (!ready) { ready = true; resolveReady(); } // не держим бота: работаем с пустой копией, пока связи нет
        await new Promise(f => setTimeout(f, 15e3));
      }
    }
  }
  stream();

  async function rest(method, path, body) {
    const tok = await token();
    const r = await fetch(`${url}/${parts(path).join('/')}.json?auth=${encodeURIComponent(tok)}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error('rtdb ' + method + ' ' + r.status + ' ' + (await r.text()).slice(0, 120));
    return r.json();
  }
  // RTDB не хранит undefined и пустые значения — чистим заранее, чтобы запись не падала
  const plain = v => JSON.parse(JSON.stringify(v ?? null));
  const inSig = p => parts(p)[0] === 'sig';

  return {
    ready: () => readyP,
    // чтение из копии (только /sig)
    get: path => clone(getAt(tree, parts(path).slice(1).join('/'))),
    async set(path, val) { const v = plain(val); await rest('PUT', path, v); if (inSig(path)) setAt(parts(path).slice(1).join('/'), v); },
    async update(path, obj) { const v = plain(obj); await rest('PATCH', path, v); if (inSig(path)) for (const [k, x] of Object.entries(v || {})) setAt(parts(path).slice(1).concat(parts(k)).join('/'), x); },
    async remove(path) { await rest('DELETE', path); if (inSig(path)) setAt(parts(path).slice(1).join('/'), null); },
    async push(path, val) { const v = plain(val); const { name } = await rest('POST', path, v); if (inSig(path)) setAt(parts(path).slice(1).concat(name).join('/'), v); return name; },
    // подписка на любые изменения в /sig (путь относительно /sig)
    on: fn => { subs.add(fn); return () => subs.delete(fn); },
    setLog: fn => { log = fn; },
  };
}

// Какие документы Firestore теперь живут в Realtime Database. Остальной код бота пишет их по-старому
// (fs.get('wa_anna/digest') и т.п.), а обёртка firestore() в brain.js отправляет их сюда.
export function movedPath(path) {
  const p = parts(path);
  if (p[0] === 'wa_anna' && ['digest', 'request', 'insights', 'done', 'watches'].includes(p[1])) return 'sig/anna/' + p[1];
  if (p[0] === 'wa_anna_q') return 'sig/annaQ' + (p[1] ? '/' + p[1] : '');
  if (p[0] === 'wa_outbox') return 'sig/outbox' + (p[1] ? '/' + p[1] : '');
  if (p[0] === 'order_pub' && p[1]) return 'pub/' + p[1];
  return null;
}
