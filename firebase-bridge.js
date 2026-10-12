/* Связка страницы учёта с Firebase: база (Firestore), файлы (Storage) и вход сотрудников.
   Страница обращается к данным через window.claude.use('db' | 'assets' | 'user'),
   здесь эти обращения переводятся на Firebase. */
(function () {
  const cfg = window.FIREBASE_CONFIG || {};
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
    let storage = null;
    try { storage = firebase.storage(); } catch (_) { storage = null; }

    api.db = { collection: p => wrapCol(fs.collection(p)), doc: p => wrapDoc(fs.doc(p)) };
    api.user = { can: async () => true, canEdit: async () => true, isOwner: async () => true };
    api.assets = storage ? {
      upload: async (file, opts) => {
        const safe = String(file.name || 'file').replace(/[^\wа-яА-ЯёЁ.\-]+/g, '_').slice(-80);
        const path = 'files/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + safe;
        const ref = storage.ref(path);
        try {
          await ref.put(file, { contentType: (opts && opts.type) || file.type || 'application/octet-stream' });
          const url = await ref.getDownloadURL();
          return { id: path, url, durableUrl: url, sizeBytes: file.size, contentType: file.type };
        } catch (e) {
          throw { code: e && e.code === 'storage/unauthorized' ? 'not_granted' : e && e.code === 'storage/quota-exceeded' ? 'quota_or_state' : 'upstream_error', message: (e && e.message) || '' };
        }
      },
      delete: async id => { try { await storage.ref(id).delete(); return { deleted: true }; } catch (_) { return { deleted: false }; } }
    } : null;

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
