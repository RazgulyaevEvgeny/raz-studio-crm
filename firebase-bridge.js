/* Связка страницы учёта с Firebase: база (Firestore), файлы (Storage) и вход сотрудников.
   Страница обращается к данным через window.claude.use('db' | 'assets' | 'user'),
   здесь эти обращения переводятся на Firebase. */
(function () {
  const cfg = window.FIREBASE_CONFIG || {};
  /* Роли сотрудников. Ключ — часть почты до @. Все остальные считаются руководителями.
     Такой же список должен быть в правилах firestore.rules (функция isManager). */
  const MANAGERS = { 'raz.brandstudio': { name: 'Милана', title: 'менеджер' } };
  /* Руководители с полными правами: точная почта → имя и подпись. */
  const ADMINS = { 'design.onegin@gmail.com': { name: 'Евгений', title: 'руководитель' } };
  const configured = cfg.apiKey && !String(cfg.apiKey).includes('ВСТАВЬТЕ');

  let resolveReady;
  const ready = new Promise(r => (resolveReady = r));
  let api = { db: null, assets: null, user: null };

  window.claude = { use: async name => { await ready; return api[name] || null; } };

  /* ---------- экран входа ---------- */
  const css = `
  .auth{position:fixed;inset:0;z-index:100;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px 16px}
  .auth[hidden]{display:none!important}
  .auth-card{width:min(400px,100%);display:flex;flex-direction:column;gap:14px}
  .auth-card h1{margin:8px 0 0;font:800 34px/1.05 "Inter Tight",Inter,system-ui,sans-serif;letter-spacing:-.045em;color:#0a0b14}
  .auth-card p{margin:0;color:#5b5f7b;font:400 15px/1.5 Inter,system-ui,sans-serif}
  .auth-card label{font:600 13px "Inter Tight",Inter,system-ui,sans-serif;color:#5b5f7b;display:flex;flex-direction:column;gap:6px}
  .auth-card input{border:0;background:#f2f3f9;border-radius:14px;min-height:50px;padding:0 16px;font:400 16px Inter,system-ui,sans-serif;color:#0a0b14}
  .auth-card input:focus-visible{outline:3px solid #4358ef;outline-offset:2px}
  .auth-card button{min-height:52px;border:0;border-radius:999px;background:#4358ef;color:#fff;font:600 16px "Inter Tight",Inter,system-ui,sans-serif;cursor:pointer}
  .auth-card button:hover{background:#3346d8}
  .auth-card button:disabled{opacity:.6;cursor:default}
  .auth-err{color:#e5484d;font:500 14px Inter,system-ui,sans-serif;min-height:1em}
  .auth-logo{color:#4358ef;line-height:0}.auth-logo svg{height:56px;width:auto}
  .pill.logout{background:transparent;box-shadow:inset 0 0 0 2px #e3e5f1;color:#5b5f7b}
  .pill.logout:hover{color:#e5484d;box-shadow:inset 0 0 0 2px #e5484d;background:transparent}`;

  function mountAuth() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const logo = document.querySelector('.logo svg');
    const el = document.createElement('div');
    el.className = 'auth'; el.id = 'auth'; el.hidden = true;
    el.innerHTML = `<form class="auth-card" id="auth-form" novalidate>
      <div class="auth-logo">${logo ? logo.outerHTML : ''}</div>
      <h1>Вход в учёт студии</h1>
      <p id="auth-text">Войдите под почтой и паролем, которые выдал владелец студии.</p>
      <label>Почта<input id="auth-email" type="email" autocomplete="username" required></label>
      <label>Пароль<input id="auth-pass" type="password" autocomplete="current-password" required></label>
      <div class="auth-err" id="auth-err" role="alert"></div>
      <button type="submit" id="auth-btn">Войти</button>
    </form>`;
    document.body.appendChild(el);
    return el;
  }

  function authErr(code) {
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(code))
      return 'Почта или пароль не подходят. Проверьте раскладку и попробуйте ещё раз.';
    if (code === 'auth/too-many-requests') return 'Слишком много попыток. Подождите пару минут и попробуйте снова.';
    if (code === 'auth/network-request-failed') return 'Нет связи с интернетом. Проверьте подключение.';
    return 'Не удалось войти. Попробуйте ещё раз.';
  }

  function addLogout(auth, user) {
    const pills = document.querySelector('.pills');
    if (!pills || document.getElementById('logout-btn')) return;
    const r = window.APP_ROLE || {};
    if (r.name) { const w = document.createElement('span'); w.className = 'pill who-pill'; w.textContent = r.name; if (r.title) { const t = document.createElement('span'); t.className = 'wt'; t.textContent = ', ' + r.title; w.appendChild(t); } w.title = r.name + (r.title ? ', ' + r.title : ''); pills.appendChild(w); }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pill logout'; b.id = 'logout-btn';
    b.textContent = 'Выйти'; b.title = user.email || '';
    b.addEventListener('click', () => auth.signOut().then(() => location.reload()));
    pills.appendChild(b);
  }

  /* ---------- база ---------- */
  const mapErr = e => ({
    code: e && e.code === 'permission-denied' ? 'invalid_argument'
        : e && e.code === 'resource-exhausted' ? 'quota_exceeded' : 'unavailable',
    message: (e && e.message) || ''
  });
  /* ---------- экономная загрузка: копия на устройстве + только изменения ----------
     Коллекции SYNCED хранятся в IndexedDB этого устройства. При открытии учёт сразу показывает копию,
     а из базы берёт только документы, изменённые после последней загрузки (поле _ts — серверное время записи).
     Свёрнутая вкладка отключается от базы и ничего не тратит; при возврате докачивает изменения.
     Удаление в этих коллекциях — заглушка {_del:true}, чтобы другие устройства узнали об удалении.
     Раз в 3 дня (и на новом устройстве) — полная загрузка: на случай, если что-то записали в обход. */
  const SYNCED = new Set(['orders', 'tasks', 'prices', 'projects', 'requests', 'office', 'supplies', 'kaspi_orders']);
  const FULL_EVERY = 3 * 864e5, OVERLAP = 10 * 60e3, HIDE_AFTER = 60e3;
  const TS = () => firebase.firestore.FieldValue.serverTimestamp();
  const colName = d => String(d.path || '').split('/')[0];
  const isSynced = d => SYNCED.has(colName(d));
  const msOf = v => v && typeof v.toMillis === 'function' ? v.toMillis() : (typeof v === 'number' ? v : 0);
  const clean = (data, ts) => { const o = { ...data }; o._ts = ts; return o; };
  const copy = d => { try { return structuredClone(d); } catch (_) { return JSON.parse(JSON.stringify(d)); } }; // учёт может менять объект — копия с устройства не портится
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((ok, no) => {
      if (!window.indexedDB) return no(new Error('no idb'));
      const r = indexedDB.open('raz-sync', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('cols');
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    }));
    const tx = (mode, fn) => open().then(db => new Promise((ok, no) => {
      const t = db.transaction('cols', mode), st = t.objectStore('cols'); const req = fn(st);
      t.oncomplete = () => ok(req && req.result); t.onerror = () => no(t.error);
    }));
    return { get: k => tx('readonly', st => st.get(k)).catch(() => null), put: (k, v) => tx('readwrite', st => st.put(v, k)).catch(() => {}) };
  })();
  window.RAZ_SYNC = { reads: 0, mode: {} }; // для проверки: сколько документов прочитали из базы за этот сеанс

  function deltaListen(c, next, err) {
    const name = c.path, uid = (firebase.auth().currentUser || {}).uid || 'anon', key = uid + ':' + name;
    let docs = new Map(), maxTs = 0, fullAt = 0, unsub = null, hideT = null, saveT = null, stopped = false, ready = false;
    const emit = () => {
      const list = [];
      for (const [id, d] of docs) if (!d._del) list.push({ id, exists: true, data: () => copy(d) });
      next({ docs: list, size: list.length, empty: !list.length });
    };
    const save = () => { clearTimeout(saveT); saveT = setTimeout(() => idb.put(key, { docs: Object.fromEntries(docs), maxTs, fullAt, v: 1 }), 1500); };
    const take = (snap, full) => {
      if (full) { const keep = new Map(); snap.docs.forEach(x => keep.set(x.id, true)); for (const id of [...docs.keys()]) if (!keep.has(id)) docs.delete(id); }
      const ch = snap.docChanges();
      if (!snap.metadata.fromCache) window.RAZ_SYNC.reads += ch.length;
      for (const x of ch) {
        if (x.type === 'removed') { if (!full) docs.delete(x.doc.id); continue; }
        const raw = x.doc.data({ serverTimestamps: 'estimate' });
        const ts = msOf(raw._ts);
        if (!x.doc.metadata.hasPendingWrites && ts > maxTs) maxTs = ts;
        if (raw._del) docs.delete(x.doc.id); else docs.set(x.doc.id, clean(raw, ts));
      }
      if (full && !snap.metadata.fromCache) { fullAt = Date.now(); backfill(snap); }
      save(); emit();
    };
    /* один раз проставить _ts старым записям (делает руководитель), чтобы они тоже участвовали в догрузке */
    const backfill = snap => {
      if ((window.APP_ROLE || {}).role !== 'admin') return;
      const old = snap.docs.filter(x => !x.data()._ts && !x.metadata.hasPendingWrites).map(x => x.ref);
      for (let i = 0; i < old.length; i += 400) { const b = c.firestore.batch(); old.slice(i, i + 400).forEach(r => b.update(r, { _ts: TS() })); b.commit().catch(() => {}); }
    };
    const attach = () => {
      if (stopped || unsub) return;
      const full = !fullAt || Date.now() - fullAt > FULL_EVERY || !maxTs;
      window.RAZ_SYNC.mode[name] = full ? 'полная' : 'изменения';
      const q = full ? c : c.where('_ts', '>', firebase.firestore.Timestamp.fromMillis(Math.max(0, maxTs - OVERLAP)));
      let first = true;
      unsub = q.onSnapshot({ includeMetadataChanges: false }, s => { take(s, full && first && !s.metadata.fromCache); if (!s.metadata.fromCache) first = false; },
        e => {
          unsub = null;
          /* нет индекса или старая база — откатываемся на обычную загрузку */
          if (!full && e && e.code === 'failed-precondition') { fullAt = 0; attach(); return; }
          err && err(mapErr(e));
        });
    };
    const detach = () => { if (unsub) { unsub(); unsub = null; } };
    const onVis = () => {
      clearTimeout(hideT);
      if (document.hidden) hideT = setTimeout(detach, HIDE_AFTER); else attach();
    };
    document.addEventListener('visibilitychange', onVis);
    idb.get(key).then(saved => {
      if (stopped) return;
      if (saved && saved.v === 1 && saved.docs) {
        docs = new Map(Object.entries(saved.docs)); maxTs = saved.maxTs || 0; fullAt = saved.fullAt || 0;
        emit(); // сразу показываем копию с устройства
      }
      ready = true;
      if (!document.hidden) attach(); else onVis();
    });
    return () => { stopped = true; detach(); document.removeEventListener('visibilitychange', onVis); };
  }

  const wrapDoc = d => ({
    id: d.id, path: d.path,
    set: (data, opt) => (opt ? d.set(isSynced(d) ? { ...data, _ts: TS() } : data, opt) : d.set(isSynced(d) ? { ...data, _ts: TS() } : data)).catch(e => { throw mapErr(e); }),
    update: data => d.update(isSynced(d) ? { ...data, _ts: TS() } : data).catch(e => { throw mapErr(e); }),
    delete: () => (isSynced(d) ? d.set({ _del: true, _ts: TS() }) : d.delete()).catch(e => { throw mapErr(e); }),
    get: () => d.get().then(x => { const v = x.exists ? x.data() : null; const live = !!v && !v._del; return { id: x.id, exists: live, data: () => (live ? v : undefined) }; })
  });
  const wrapCol = c => ({
    path: c.path,
    doc: id => wrapDoc(id ? c.doc(id) : c.doc()),
    onSnapshot: (next, err) => SYNCED.has(c.path) ? deltaListen(c, next, err) : c.onSnapshot(
      s => next({ docs: s.docs.map(x => ({ id: x.id, exists: true, data: () => x.data() })), size: s.size, empty: s.empty }),
      e => err && err(mapErr(e)))
  });

  /* ---------- файлы в базе Firestore (без Storage) ----------
     Фото сжимаются в браузере до JPEG ~300 КБ, PDF хранится как есть, если меньше ~700 КБ.
     В записях заказа хранится ссылка вида fsblob:<id>, а картинка подгружается при показе. */
  const MAX_CHARS = 940000; // предел документа Firestore 1 МБ, с запасом
  const fileToDataURL = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
  async function compressImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
      let side = 1600, q = 0.82, out = '';
      for (let step = 0; step < 8; step++) {
        const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL('image/jpeg', q);
        if (out.length <= 420000) break;           // ~300 КБ — цель
        if (q > 0.6) q -= 0.1; else side = Math.round(side * 0.8);
      }
      return out;
    } finally { URL.revokeObjectURL(url); }
  }
  const cache = new Map();
  function dataUrlToObjectUrl(d) {
    const [head, b64] = d.split(','); const type = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type }));
  }
  /* 3D-файлы (STL, 3MF) хранятся частями: документ Firestore вмещает меньше 1 МБ */
  const CHUNK = 900 * 1024;
  const is3d = f => /\.(stl|3mf)$/i.test(String((f && f.name) || ''));
  const toU8 = p => p && p.toUint8Array ? p.toUint8Array() : p && p._b ? Uint8Array.from(atob(p._b), c => c.charCodeAt(0)) : new Uint8Array(0);
  const fromU8 = u => (window.firebase && firebase.firestore && firebase.firestore.Blob) ? firebase.firestore.Blob.fromUint8Array(u) : u;
  async function gz(u8, dir) {
    const S = dir === 'c' ? window.CompressionStream : window.DecompressionStream; if (!S) return null;
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new S('gzip'))).arrayBuffer());
  }
  function makeBlobStore(fs) {
    const col = fs.collection('blobs');
    const big = new Map();
    const resolve = id => {
      if (!cache.has(id)) cache.set(id, col.doc(id).get().then(s => {
        if (!s.exists) return '';
        const d = s.data();
        if (d.chunks) { big.set(id, d); return { lazy: true, meta: d }; }
        return dataUrlToObjectUrl(d.data);
      }).catch(() => ''));
      return cache.get(id);
    };
    async function loadBig(id, meta) {
      const parts = await Promise.all([...Array(meta.chunks)].map((_, i) => col.doc(id + '_' + i).get().then(s => toU8(s.data().part))));
      let len = 0; parts.forEach(p => len += p.length);
      let all = new Uint8Array(len), o = 0; parts.forEach(p => { all.set(p, o); o += p.length; });
      if (meta.gz) all = await gz(all, 'd');
      return URL.createObjectURL(new Blob([all], { type: 'application/octet-stream' }));
    }
    const fix = async (el, attr, mk) => {
      const v = el.getAttribute(attr) || ''; const m = v.match(/fsblob:([\w-]+)/); if (!m) return;
      el.setAttribute('data-fsblob', m[1]);
      const u = await resolve(m[1]);
      if (u && typeof u === 'object') {
        if (attr !== 'href') { if (attr === 'src') el.removeAttribute('src'); return; }
        el.setAttribute('href', '#'); if (el._big) return; el._big = 1;
        el.removeAttribute('target');
        el.addEventListener('click', async e => {
          if (el._ready) return; e.preventDefault(); if (el._busy) return; el._busy = 1;
          const label = el.textContent; el.textContent = 'Скачиваем…';
          try { const url = await loadBig(m[1], u.meta); el.href = url; el.setAttribute('download', u.meta.name || 'model'); el._ready = 1; el.textContent = label; el.click(); }
          catch (_) { el.textContent = 'Не удалось скачать'; setTimeout(() => (el.textContent = label), 2500); }
          finally { el._busy = 0; }
        });
        return;
      }
      if (u) el.setAttribute(attr, mk ? mk(v, m[0], u) : u); else if (attr === 'src') el.removeAttribute('src');
    };
    const scan = root => {
      (root.querySelectorAll ? root : document).querySelectorAll('img[src^="fsblob:"],video[src^="fsblob:"]').forEach(el => fix(el, 'src'));
      (root.querySelectorAll ? root : document).querySelectorAll('a[href^="fsblob:"]').forEach(el => fix(el, 'href'));
      (root.querySelectorAll ? root : document).querySelectorAll('[style*="fsblob:"]').forEach(el => fix(el, 'style', (v, tok, u) => v.replace(tok, u)));
    };
    new MutationObserver(ms => { for (const m of ms) { if (m.type === 'childList') m.addedNodes.forEach(n => n.nodeType === 1 && scan(n.parentNode || n)); else if (m.target.nodeType === 1) scan(m.target.parentNode || m.target); } })
      .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href', 'style'] });
    return {
      upload: async file => {
        if (is3d(file)) {
          if (file.size > 50 * 1024 * 1024) throw { code: 'too_large', message: '3d' };
          let u8 = new Uint8Array(await file.arrayBuffer()), packed = false;
          if (/\.stl$/i.test(file.name)) { try { const z = await gz(u8, 'c'); if (z && z.length < u8.length * 0.9) { u8 = z; packed = true; } } catch (_) {} }
          const ref = col.doc(), n = Math.max(1, Math.ceil(u8.length / CHUNK)), ext = file.name.split('.').pop().toLowerCase();
          try {
            for (let i = 0; i < n; i += 4) await Promise.all([...Array(Math.min(4, n - i))].map((_, k) => col.doc(ref.id + '_' + (i + k)).set({ part: fromU8(u8.slice((i + k) * CHUNK, (i + k + 1) * CHUNK)), i: i + k, of: ref.id })));
            await ref.set({ type: 'model/' + ext, name: String(file.name || '').slice(0, 120), size: file.size, chunks: n, gz: packed, createdAt: Date.now() });
          } catch (e) { throw { code: e && e.code === 'permission-denied' ? 'not_granted' : 'upstream_error', message: (e && e.message) || '' }; }
          const id = 'fsblob:' + ref.id;
          return { id, url: id, durableUrl: id, sizeBytes: file.size, contentType: 'model/' + ext };
        }
        let data;
        const t = file.type || '';
        if (t.startsWith('image/')) data = await compressImage(file);
        else if (t === 'application/pdf') { data = await fileToDataURL(file); if (data.length > MAX_CHARS) throw { code: 'too_large', message: 'pdf' }; }
        else throw { code: 'unsupported_type', message: t };
        if (data.length > MAX_CHARS) throw { code: 'too_large', message: 'image' };
        const ref = col.doc();
        try { await ref.set({ data, type: t.startsWith('image/') ? 'image/jpeg' : t, name: String(file.name || '').slice(0, 120), createdAt: Date.now() }); }
        catch (e) { throw { code: e && e.code === 'permission-denied' ? 'not_granted' : 'upstream_error', message: (e && e.message) || '' }; }
        const id = 'fsblob:' + ref.id;
        return { id, url: id, durableUrl: id, sizeBytes: Math.round(data.length * 0.75), contentType: t.startsWith('image/') ? 'image/jpeg' : t };
      },
      delete: async id => {
        const k = String(id).replace('fsblob:', '');
        try {
          const s = await col.doc(k).get(); const n = s.exists ? (s.data().chunks || 0) : 0;
          for (let i = 0; i < n; i++) await col.doc(k + '_' + i).delete().catch(() => {});
          await col.doc(k).delete(); return { deleted: true };
        } catch (_) { return { deleted: false }; }
      }
    };
  }

  function start() {
    const authEl = mountAuth();
    if (!configured) {
      authEl.hidden = false;
      document.getElementById('auth-text').textContent = 'Сайт ещё не подключён к базе. Откройте файл firebase-config.js и вставьте настройки проекта Firebase (инструкция в README).';
      document.getElementById('auth-form').querySelectorAll('input,button').forEach(x => (x.disabled = true));
      return;
    }
    firebase.initializeApp(cfg);
    const auth = firebase.auth();
    const fs = firebase.firestore();
    try { fs.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (_) {}
    /* Данные запоминаются на устройстве: повторное открытие показывает учёт сразу (даже без интернета),
       а из базы докачивается только изменившееся. Несколько вкладок делят один кэш. */
    try { fs.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (_) {}

    api.db = { collection: p => wrapCol(fs.collection(p)), doc: p => wrapDoc(fs.doc(p)) };
    api.user = { can: async () => true, canEdit: async () => true, isOwner: async () => true };
    api.assets = makeBlobStore(fs);

    const form = document.getElementById('auth-form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.getElementById('auth-btn'), er = document.getElementById('auth-err');
      er.textContent = ''; btn.disabled = true; btn.textContent = 'Входим…';
      try { await auth.signInWithEmailAndPassword(document.getElementById('auth-email').value.trim(), document.getElementById('auth-pass').value); }
      catch (x) { er.textContent = authErr(x && x.code); }
      finally { btn.disabled = false; btn.textContent = 'Войти'; }
    });

    let started = false;
    auth.onAuthStateChanged(u => {
      if (u) {
        const local = String(u.email || '').toLowerCase().split('@')[0];
        const m = MANAGERS[local];
        const a = ADMINS[String(u.email || '').toLowerCase()];
        window.APP_ROLE = m ? { role: 'manager', name: m.name, title: m.title, email: u.email }
          : a ? { role: 'admin', name: a.name, title: a.title, email: u.email }
          : { role: 'admin', name: u.displayName || 'Руководитель', title: '', email: u.email };
        authEl.hidden = true; addLogout(auth, u);
        checkAccess(fs, u).then(ok => {
          if (!ok) { showNoAccess(auth, u); return; }
          if (!started) { started = true; resolveReady(); }
        });
      } else {
        authEl.hidden = false;
        setTimeout(() => document.getElementById('auth-email').focus(), 50);
      }
    });
  }

  /* Доступ сотрудника. Каждый вход оставляет «просьбу о доступе» (почта и имя) — руководитель видит её
     в учёте (кнопка «Сотрудники») и отмечает, кому можно. Пока правила базы не опубликованы, пускает всех. */
  async function checkAccess(fs, u) {
    const r = window.APP_ROLE || {};
    try { await fs.doc('staff_req/' + u.uid).set({ email: String(u.email || '').toLowerCase(), name: r.name || '', at: Date.now() }); } catch (_) {}
    if (String(u.email || '').toLowerCase() === 'design.onegin@gmail.com') return true;
    try { await fs.doc('wa_anna/requisites').get(); return true; }
    catch (e) { return !(e && e.code === 'permission-denied'); }
  }
  function showNoAccess(auth, u) {
    const el = document.getElementById('auth');
    el.hidden = false;
    el.querySelector('.auth-card').innerHTML = `<div class="auth-logo">${(document.querySelector('.logo svg') || {}).outerHTML || ''}</div>
      <h1>Ждём доступ</h1>
      <p>Вы вошли как <b>${String(u.email || '').replace(/[<>&]/g, '')}</b>. Руководитель ещё не открыл вам доступ к учёту.
      Попросите его нажать в учёте «Сотрудники» и отметить вашу почту, потом обновите страницу.</p>
      <button type="button" id="auth-retry">Обновить</button>
      <button type="button" id="auth-out" style="background:transparent;color:#5b5f7b;box-shadow:inset 0 0 0 2px #e3e5f1">Выйти</button>`;
    document.getElementById('auth-retry').onclick = () => location.reload();
    document.getElementById('auth-out').onclick = () => auth.signOut().then(() => location.reload());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
