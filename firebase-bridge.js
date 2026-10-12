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
  const wrapDoc = d => ({
    id: d.id, path: d.path,
    set: data => d.set(data).catch(e => { throw mapErr(e); }),
    update: data => d.update(data).catch(e => { throw mapErr(e); }),
    delete: () => d.delete().catch(e => { throw mapErr(e); }),
    get: () => d.get().then(x => ({ id: x.id, exists: x.exists, data: () => x.data() }))
  });
  const wrapCol = c => ({
    path: c.path,
    doc: id => wrapDoc(id ? c.doc(id) : c.doc()),
    onSnapshot: (next, err) => c.onSnapshot(
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
        if (!started) { started = true; resolveReady(); }
      } else {
        authEl.hidden = false;
        setTimeout(() => document.getElementById('auth-email').focus(), 50);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
