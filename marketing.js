/* Маркетинговый отдел: три ИИ-специалиста (маркетолог, SMM-менеджер, аналитик) и планёрка всей команды.
   Ответы приходят через сервер marketing-worker (Cloudflare), разговоры хранятся в Firestore, коллекция marketing. */
/* читает переменные страницы учёта (orders, prices…) — они объявлены в основном скрипте */
function GLOBAL(name) { try { return (0, eval)(name); } catch (_) { return undefined; } }
(function () {
  /* адрес сервера-посредника; после публикации воркера вставьте сюда его адрес */
  const MKT_API = 'https://raz-marketing.design-onegin.workers.dev';

  const ROLES = {
    marketer: { name: 'Маркетолог', sub: 'стратегия, офферы, цены, КП', c: '--blue', ini: 'М',
      quick: ['Стратегия продаж на 3 месяца для трёх главных услуг', 'Проверь наш прайс: где наценка низкая и что поднять', 'Собери пакеты 3D-табличек для кофейни', 'Напиши КП для барбершопа', 'План поиска клиентов на винил без бюджета', 'Холодное сообщение заведению в WhatsApp'] },
    smm: { name: 'SMM-менеджер', sub: 'Instagram, Reels, посты, сторис', c: '--st-design', ini: 'S',
      quick: ['Контент-план на неделю для @raz.brandstudio', '5 сценариев Reels из процесса в мастерской', 'Пост-кейс про оклейку авто', 'Сторис с опросом, чтобы собрать заявки', 'Перепиши шапку профиля и Highlights'] },
    analyst: { name: 'Аналитик', sub: 'конкуренты, цены рынка, ЦА', c: '--st-prod', ini: 'А',
      quick: ['Найди конкурентов по оклейке авто в нашем городе и их цены', 'Цены на DTF-печать футболок у конкурентов', 'Кто делает таблички и вывески для кафе и почём', 'Портреты клиентов по трём услугам', 'Почему просели продажи — разбери цифры учёта'] },
    team: { name: 'Планёрка', sub: 'вся команда по очереди', c: '--ok', ini: '★', team: true,
      quick: ['Как поднять продажи винила на авто за месяц', 'Запускаем 3D-таблички для заведений — план', 'Маркетинговый план на ноябрь', 'Разберите наши цены против рынка и дайте контент под это'] }
  };
  const TEAM_ORDER = ['analyst', 'marketer', 'smm'];

  /* ---------- стили ---------- */
  const st = document.createElement('style');
  st.textContent = `
  .mk-team{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
  .mk-role{display:flex;align-items:center;gap:12px;text-align:left;padding:14px;border-radius:22px;background:var(--tile);cursor:pointer;min-width:0}
  .mk-role:hover{background:var(--tile-2)}
  .mk-role.on{background:var(--ink);color:#fff}.mk-role.on small{color:#c9cbe0}
  .mk-ava{flex:none;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font:800 16px var(--f);color:#fff;background:var(--rc)}
  .mk-role b{display:block;font:700 15px/1.2 var(--f)}.mk-role small{display:block;color:var(--muted);font-size:12.5px;line-height:1.3;margin-top:2px}
  .mk-role div{min-width:0}
  .mk-brief textarea,.mk-form textarea{width:100%;border:0;background:var(--paper);border-radius:16px;padding:12px 14px;resize:vertical;line-height:1.45}
  .mk-brief textarea:focus-visible,.mk-form textarea:focus-visible{outline:3px solid var(--blue);outline-offset:1px}
  .mk-row{display:flex;justify-content:space-between;align-items:center;gap:10px}.mk-row small{color:var(--muted)}
  .mk-wrap{display:grid;grid-template-columns:260px minmax(0,1fr);gap:12px;align-items:start}
  .mk-hist{gap:6px;max-height:calc(100vh - 260px);overflow:auto;position:sticky;top:12px}
  .mk-hist h3{margin:2px 4px 6px;font:700 13px var(--f);color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .mk-th{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:10px 12px;border-radius:14px;background:transparent;cursor:pointer}
  .mk-th:hover{background:var(--tile-2)}.mk-th.on{background:var(--paper)}
  .mk-th .d{flex:none;width:9px;height:9px;border-radius:50%;background:var(--rc)}
  .mk-th span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 13.5px var(--f)}
  .mk-th em{font-style:normal;color:var(--muted);font-size:12px}
  .mk-th .x{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:var(--muted);visibility:hidden}
  .mk-th:hover .x,.mk-th.on .x{visibility:visible}.mk-th .x:hover{color:var(--danger);background:var(--tile)}
  .mk-chat{min-height:60vh}
  .mk-msgs{display:flex;flex-direction:column;gap:14px}
  .mk-m{display:flex;gap:10px;align-items:flex-start;min-width:0}
  .mk-m .mk-ava{width:34px;height:34px;font-size:13px}
  .mk-b{flex:1;min-width:0;background:var(--paper);border-radius:18px;padding:12px 16px}
  .mk-m.me{justify-content:flex-end}.mk-m.me .mk-b{flex:0 1 auto;max-width:85%;background:var(--blue);color:#fff;white-space:pre-wrap}
  .mk-who{display:flex;align-items:center;gap:8px;font:700 13px var(--f);margin-bottom:4px}
  .mk-who em{font-style:normal;color:var(--muted);font-weight:500}
  .mk-who button{margin-left:auto;font:600 12.5px var(--f);color:var(--blue);padding:4px 8px;border-radius:8px}.mk-who button:hover{background:var(--tile)}
  .mk-md{font-size:14.5px;line-height:1.55;overflow-wrap:anywhere}
  .mk-md h1,.mk-md h2,.mk-md h3,.mk-md h4{font-family:var(--f);letter-spacing:-.02em;margin:14px 0 6px;line-height:1.2}
  .mk-md h1{font-size:20px}.mk-md h2{font-size:18px}.mk-md h3{font-size:16px}.mk-md h4{font-size:15px}
  .mk-md>:first-child{margin-top:0}.mk-md p{margin:6px 0}.mk-md ul,.mk-md ol{margin:6px 0;padding-left:22px}.mk-md li{margin:3px 0}
  .mk-md a{color:var(--blue)}.mk-md code{background:var(--tile);padding:1px 5px;border-radius:6px;font-size:13px}
  .mk-md hr{border:0;border-top:1px solid var(--line);margin:12px 0}
  .mk-md blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid var(--line);color:var(--muted)}
  .mk-tw{overflow-x:auto;margin:8px 0}.mk-md table{border-collapse:collapse;font-size:13.5px;min-width:100%}
  .mk-md th,.mk-md td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}.mk-md th{background:var(--tile);font-family:var(--f)}
  .mk-src{margin-top:10px;padding-top:8px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}
  .mk-src a{color:var(--blue);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mk-wait{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:14px}
  .mk-dots{display:inline-flex;gap:4px}.mk-dots i{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:mkb 1.2s infinite}
  .mk-dots i:nth-child(2){animation-delay:.2s}.mk-dots i:nth-child(3){animation-delay:.4s}
  @keyframes mkb{0%,80%,100%{opacity:.25}40%{opacity:1}}
  @media (prefers-reduced-motion:reduce){.mk-dots i{animation:none;opacity:.6}}
  .mk-err{color:var(--danger);font-size:14px}
  .mk-intro{background:var(--paper);border-radius:18px;padding:18px;color:var(--muted);font-size:14.5px}
  .mk-intro b{color:var(--ink)}
  #p-marketing .ph .btns,#p-marketing .ph .btns .btn.primary{display:flex}
  .mk-quick .chip{background:var(--paper);white-space:normal;text-align:left;height:auto;min-height:0;padding-block:8px;line-height:1.3;flex:0 1 auto}.mk-quick .chip:hover{background:var(--tile-2)}
  .mk-form{display:flex;gap:10px;align-items:flex-end}.mk-form textarea{flex:1;min-height:52px;max-height:40vh}
  .mk-foot{color:var(--muted);font-size:12px}
  @media(max-width:860px){.mk-wrap{grid-template-columns:minmax(0,1fr)}.mk-hist{position:static;max-height:none;flex-direction:row;overflow-x:auto;padding:10px}.mk-hist h3{display:none}.mk-th{flex:none;width:auto;max-width:220px;background:var(--paper)}.mk-th.on{box-shadow:inset 0 0 0 2px var(--blue)}}
  @media(max-width:700px){.mk-hist.empty{display:none}#p-marketing .ph .btns{width:100%}#p-marketing .ph .btns .btn{flex:1}.mk-team{grid-template-columns:repeat(2,minmax(0,1fr))}.mk-role{padding:10px;gap:8px}.mk-ava{width:34px;height:34px;font-size:14px}.mk-role small{display:none}
    .mk-form{flex-direction:column;align-items:stretch}.mk-m .mk-ava{display:none}.mk-m.me .mk-b{max-width:92%}.mk-b{padding:10px 12px}}`;
  document.head.appendChild(st);

  /* ---------- состояние ---------- */
  let col = null, threads = [], loaded = false, brief = '', briefAt = 0;
  let role = 'marketer', cur = null, busy = null, err = '';
  try { role = localStorage.getItem('mk-role') || role; if (!ROLES[role]) role = 'marketer'; } catch (_) {}
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $$ = id => document.getElementById(id);
  const fmtT = t => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); };

  /* ---------- мини-markdown ---------- */
  function inline(s) {
    s = E(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    return s;
  }
  function md(src) {
    const L = String(src || '').replace(/\r/g, '').split('\n'), out = [];
    let i = 0;
    const isRow = l => /^\s*\|.*\|\s*$/.test(l);
    const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    while (i < L.length) {
      const l = L[i];
      if (!l.trim()) { i++; continue; }
      if (/^```/.test(l)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; out.push('<pre><code>' + E(b.join('\n')) + '</code></pre>'); continue; }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (isRow(l) && i + 1 < L.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(L[i + 1]) && L[i + 1].includes('-')) {
        const h = cells(l); i += 2; const rows = [];
        while (i < L.length && isRow(L[i])) rows.push(cells(L[i++]));
        out.push('<div class="mk-tw"><table><thead><tr>' + h.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      if (/^\s*>/.test(l)) { const b = []; while (i < L.length && /^\s*>/.test(L[i])) b.push(L[i++].replace(/^\s*>\s?/, '')); out.push('<blockquote>' + inline(b.join(' ')) + '</blockquote>'); continue; }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
        const ol = /^\s*\d/.test(l), items = [];
        while (i < L.length && (/^\s*([-*+]|\d+[.)])\s+/.test(L[i]) || (/^\s{2,}\S/.test(L[i]) && items.length))) {
          if (/^\s*([-*+]|\d+[.)])\s+/.test(L[i]) && !(/^\s{2,}/.test(L[i]) && items.length)) items.push(L[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
          else items[items.length - 1] += '<br>' + L[i].trim().replace(/^([-*+]|\d+[.)])\s+/, '— ');
          i++;
        }
        out.push((ol ? '<ol>' : '<ul>') + items.map(x => '<li>' + inline(x).replace(/&lt;br&gt;/g, '<br>') + '</li>').join('') + (ol ? '</ol>' : '</ul>'));
        continue;
      }
      const p = [];
      while (i < L.length && L[i].trim() && !/^(#{1,4}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(L[i]) && !isRow(L[i])) p.push(L[i++]);
      if (!p.length) { out.push('<p>' + inline(L[i++]) + '</p>'); continue; }
      out.push('<p>' + p.map(inline).join('<br>') + '</p>');
    }
    return out.join('');
  }

  /* ---------- данные из учёта для специалистов (без имён и телефонов клиентов) ---------- */
  function context() {
    const G = name => GLOBAL(name);
    const orders = G('orders') || [], prices = G('prices') || [], ledger = G('ledger') || { office: [], supplies: [] };
    const svcLabel = G('svcLabel') || (x => x), profitOf = G('profitOf') || (o => 0), receivedOf = G('receivedOf') || (o => ''), unitCostOf = G('unitCostOf'), calcMin = G('calcMin');
    const money = n => Math.round(n || 0).toLocaleString('ru-RU') + ' ₸';
    const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const out = [];
    // прайс
    const pr = prices.filter(x => !x.hidden).slice(0, 150).map(x => {
      let p = x.calc && calcMin ? 'от ' + money(calcMin(x.calc)) : (x.from ? 'от ' : '') + money(x.price);
      const c = unitCostOf ? unitCostOf(x) : 0;
      const mk = c > 0 && +x.price ? Math.round((+x.price - c) / c * 100) + '%' : '—';
      const tiers = (x.tiers || []).filter(t => t.qty && t.price).map(t => 'от ' + t.qty + ' шт — ' + money(t.price)).join('; ');
      return `| ${svcLabel(x.svc)} | ${x.name || ''} | ${x.unit || 'шт'} | ${p}${tiers ? ' (' + tiers + ')' : ''} | ${c ? money(c) : '—'} | ${mk} |`;
    });
    out.push('### Прайс студии (видимые клиентам позиции)\n' + (pr.length ? '| Услуга | Позиция | За что | Цена | Себестоимость | Наценка |\n|---|---|---|---|---|---|\n' + pr.join('\n') : 'Прайс пустой.'));
    // заказы по услугам: последние 90 дней против предыдущих 90
    const live = orders.filter(o => o.status !== 'cancel');
    const per = (from, to) => { const m = new Map(); live.filter(o => { const d = receivedOf(o); return d && d >= from && d <= to; }).forEach(o => { const k = svcLabel(o.service, o), e = m.get(k) || { n: 0, r: 0, p: 0 }; e.n++; e.r += +o.price || 0; e.p += profitOf(o); m.set(k, e); }); return m; };
    const now = per(day(90), day(0)), prev = per(day(180), day(91));
    const keys = [...new Set([...now.keys(), ...prev.keys()])];
    out.push('### Заказы по услугам: последние 90 дней и предыдущие 90 дней\n' + (keys.length ? '| Услуга | Заказов (90 дн) | Выручка | Прибыль | Средний чек | Заказов (пред. 90) | Выручка (пред.) |\n|---|---|---|---|---|---|---|\n' +
      keys.map(k => { const a = now.get(k) || { n: 0, r: 0, p: 0 }, b = prev.get(k) || { n: 0, r: 0 }; return `| ${k} | ${a.n} | ${money(a.r)} | ${money(a.p)} | ${a.n ? money(a.r / a.n) : '—'} | ${b.n} | ${money(b.r)} |`; }).join('\n') : 'Заказов за полгода нет.'));
    // по месяцам
    const months = new Map();
    live.forEach(o => { const ym = (receivedOf(o) || '').slice(0, 7); if (ym && ym >= day(365).slice(0, 7)) { const e = months.get(ym) || { n: 0, r: 0 }; e.n++; e.r += +o.price || 0; months.set(ym, e); } });
    out.push('### Выручка по месяцам (12 мес.)\n' + ([...months].sort().map(([ym, e]) => `${ym}: ${money(e.r)}, заказов ${e.n}`).join('\n') || 'нет данных'));
    // источники и позиции
    const src = new Map(), itm = new Map();
    live.filter(o => (receivedOf(o) || '') >= day(90)).forEach(o => {
      const s = o.source === 'toppers' ? 'Сайт топперов' : (o.kaspi || []).length || o.service === 'kaspi' ? 'Kaspi' : 'Студия (Instagram, WhatsApp, офлайн)';
      src.set(s, (src.get(s) || 0) + 1);
      (o.items || []).forEach(i => { const k = (i.name || '').trim(); if (k) itm.set(k, (itm.get(k) || 0) + (+i.price || 0) * (+i.qty || 0)); });
    });
    out.push('### Откуда заказы (90 дней)\n' + ([...src].map(([k, v]) => `${k}: ${v}`).join('\n') || 'нет данных'));
    out.push('### Топ позиций по выручке (90 дней)\n' + ([...itm].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}: ${money(v)}`).join('\n') || 'нет данных'));
    const ads = (ledger.office || []).filter(x => x.cat === 'ads' && (x.date || '') >= day(90)).reduce((s, x) => s + (+x.amount || 0), 0);
    out.push('### Расходы на рекламу за 90 дней: ' + money(ads));
    return out.join('\n\n');
  }

  /* ---------- сервер ---------- */
  async function ask(r, messages) {
    const u = window.firebase && firebase.auth && firebase.auth().currentUser;
    if (!u) throw new Error('Войдите на сайт заново.');
    const token = await u.getIdToken();
    const res = await fetch(MKT_API + '/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ role: r, messages, context: context(), brief }) })
      .catch(() => { throw new Error('Нет связи с сервером маркетингового отдела. Проверьте интернет или адрес MKT_API в marketing.js.'); });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Сервер ответил ' + res.status);
    return j;
  }

  /* ---------- база ---------- */
  async function init() {
    const db = await window.claude.use('db');
    if (!db) return;
    col = db.collection('marketing');
    col.onSnapshot(s => {
      threads = []; s.docs.forEach(d => { const x = { id: d.id, ...d.data() }; if (d.id === 'brief') { brief = x.text || ''; briefAt = x.updatedAt || 0; } else threads.push(x); });
      threads.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      loaded = true; if (cur && !threads.find(t => t.id === cur) && !busy) cur = null;
      if (isOpen()) draw();
    }, () => { err = 'Нет доступа к разговорам в базе. Обновите правила firestore.rules (раздел marketing).'; loaded = true; if (isOpen()) draw(); });
  }
  const isOpen = () => { const p = $$('p-marketing'); return p && !p.hidden; };

  async function saveThread(t) {
    const data = { role: t.role, title: t.title, messages: t.messages.slice(-60), updatedAt: Date.now(), createdAt: t.createdAt || Date.now(), by: (window.APP_ROLE || {}).name || '' };
    if (!t.id) { const ref = col.doc(); t.id = ref.id; await ref.set(data); } else await col.doc(t.id).set(data);
    return t.id;
  }

  /* ---------- отправка ---------- */
  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy || !col) return;
    err = '';
    let t = threads.find(x => x.id === cur);
    if (!t || t.role !== role) t = { role, title: text.slice(0, 70), messages: [], createdAt: Date.now() };
    else t = { ...t, messages: [...t.messages] };
    const me = (window.APP_ROLE || {}).name || '';
    t.messages.push({ role: 'user', text, at: Date.now(), by: me });
    $$('mk-in').value = '';
    const R = ROLES[role];
    const steps = R.team ? TEAM_ORDER : [role];
    busy = { thread: t, step: steps[0] };
    try {
      cur = await saveThread(t);
      const done = [];
      for (const s of steps) {
        busy = { thread: t, step: s }; draw();
        let msgs;
        if (R.team) {
          const prior = t.messages.filter(m => m.role === 'user').slice(-3, -1).map(m => '- ' + m.text).join('\n');
          const notes = done.map(d => `### ${ROLES[d.role].name}\n${d.text}`).join('\n\n');
          msgs = [{ role: 'user', text: `Планёрка маркетингового отдела. Задача от владельца:\n${text}` + (prior ? `\n\nРанее на планёрке обсуждали:\n${prior}` : '') +
            (notes ? `\n\nКоллеги уже выступили — опирайся на их материалы, не повторяй их, дополни своей частью:\n\n${notes}` : '\n\nТы выступаешь первым.') +
            (s === 'smm' ? '\n\nТы выступаешь последним: переведи стратегию в контент и в конце дай общий итог планёрки — 5 пунктов, кто что делает на этой неделе.' : '') }];
        } else msgs = t.messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text }));
        const r = await ask(s, msgs);
        const msg = { role: 'assistant', agent: s, text: r.text || '(пустой ответ)', sources: r.sources || [], at: Date.now(), searches: (r.usage || {}).searches || 0 };
        t.messages.push(msg); done.push({ role: s, text: msg.text });
        await saveThread(t);
      }
    } catch (e) {
      err = e.message || String(e);
      if (!t.id) { try { await saveThread(t); cur = t.id; } catch (_) {} }
    } finally { busy = null; draw(); }
  }

  /* ---------- отрисовка ---------- */
  function msgHtml(m) {
    if (m.role === 'user') return `<div class="mk-m me"><div class="mk-b">${E(m.text)}</div></div>`;
    const R = ROLES[m.agent] || ROLES.marketer;
    const src = (m.sources || []).length ? `<div class="mk-src"><b>Источники</b>${m.sources.map(s => `<a href="${E(s.url)}" target="_blank" rel="noopener">${E(s.title || s.url)}</a>`).join('')}</div>` : '';
    return `<div class="mk-m" style="--rc:var(${R.c})"><div class="mk-ava" aria-hidden="true">${R.ini}</div><div class="mk-b">
      <div class="mk-who">${E(R.name)} <em>${m.at ? fmtT(m.at) : ''}${m.searches ? ' · поисков: ' + m.searches : ''}</em><button type="button" data-mkcopy="${m.at}">Копировать</button></div>
      <div class="mk-md">${md(m.text)}</div>${src}</div></div>`;
  }
  function draw() {
    const fab = document.querySelector('.fab'); if (fab) fab.hidden = true;
    $$('mk-team').innerHTML = Object.entries(ROLES).map(([k, r]) => `<button type="button" role="tab" aria-selected="${k === role}" class="mk-role${k === role ? ' on' : ''}" data-mkrole="${k}" style="--rc:var(${r.c})"><span class="mk-ava" aria-hidden="true">${r.ini}</span><div><b>${E(r.name)}</b><small>${E(r.sub)}</small></div></button>`).join('');
    // история
    const mine = threads.filter(t => t.role === role);
    $$('mk-hist').classList.toggle('empty', !mine.length);
    $$('mk-hist').innerHTML = `<h3>${E(ROLES[role].name)}: разговоры</h3>` + (mine.length ? mine.map(t => `<div class="mk-th${t.id === cur ? ' on' : ''}" data-mkopen="${E(t.id)}" role="button" tabindex="0" style="--rc:var(${ROLES[t.role].c})"><i class="d"></i><span>${E(t.title)}</span><em>${fmtT(t.updatedAt)}</em><button type="button" class="x" data-mkdel="${E(t.id)}" aria-label="Удалить разговор">×</button></div>`).join('')
      : `<div class="w-empty">${loaded ? 'Разговоров пока нет' : 'Загружаем…'}</div>`);
    // переписка
    const t = busy ? busy.thread : threads.find(x => x.id === cur && x.role === role);
    const R = ROLES[role];
    let h = '';
    if (!t || !t.messages.length) h = `<div class="mk-intro"><b>${E(R.name)}</b> — ${E(R.sub)}. ${R.team ? 'На планёрке задачу разбирают по очереди: аналитик ищет данные о рынке и конкурентах, маркетолог строит стратегию, SMM-менеджер превращает её в контент и подводит итог.' : role === 'analyst' ? 'Ищет информацию в интернете и даёт ссылки на источники.' : 'Видит ваш прайс, себестоимость и продажи из учёта.'}${brief ? '' : ' Заполните «Бриф студии»: город, клиенты и конкуренты — так ответы будут точнее.'}<br><br>Выберите готовую задачу ниже или напишите свою.</div>`;
    else h = t.messages.map(msgHtml).join('');
    if (busy) h += `<div class="mk-m" style="--rc:var(${ROLES[busy.step].c})"><div class="mk-ava" aria-hidden="true">${ROLES[busy.step].ini}</div><div class="mk-b mk-wait"><span class="mk-dots"><i></i><i></i><i></i></span>${E(ROLES[busy.step].name)} ${busy.step === 'analyst' ? 'ищет в интернете и пишет разбор…' : 'готовит ответ…'} Это займёт до минуты.</div></div>`;
    if (err) h += `<div class="mk-err" role="alert">${E(err)}</div>`;
    const box = $$('mk-msgs'), wasBottom = box.innerHTML === '' || window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
    box.innerHTML = h;
    $$('mk-quick').innerHTML = R.quick.map(q => `<button type="button" class="chip" data-mkq="${E(q)}">${E(q)}</button>`).join('');
    $$('mk-quick').hidden = !!(t && t.messages.length);
    $$('mk-send').disabled = !!busy; $$('mk-in').placeholder = R.team ? 'Задача для всей команды…' : 'Задача для: ' + R.name.toLowerCase() + '…';
    $$('mk-foot').textContent = (t && t.messages.length ? 'Продолжайте разговор — специалист помнит его. ' : '') + 'Ответы ИИ: проверяйте цены и факты перед отправкой клиентам.';
    if (busy && wasBottom) setTimeout(() => box.lastElementChild && box.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
    if (document.activeElement !== $$('mk-brief-t')) $$('mk-brief-t').value = brief;
    $$('mk-brief-s').textContent = briefAt ? 'Обновлён ' + fmtT(briefAt) : 'Ещё не заполнен';
  }
  window.renderMarketing = draw;

  /* ---------- события ---------- */
  document.addEventListener('click', async e => {
    const t = e.target;
    if (!t.closest || !t.closest('#p-marketing')) return;
    const r = t.closest('[data-mkrole]'); if (r) { role = r.dataset.mkrole; try { localStorage.setItem('mk-role', role); } catch (_) {} const last = threads.find(x => x.role === role); cur = last ? last.id : null; err = ''; draw(); return; }
    const d = t.closest('[data-mkdel]'); if (d) { e.stopPropagation(); if (!confirm('Удалить этот разговор?')) return; try { await col.doc(d.dataset.mkdel).delete(); if (cur === d.dataset.mkdel) cur = null; } catch (_) { err = 'Не удалось удалить.'; draw(); } return; }
    const o = t.closest('[data-mkopen]'); if (o) { cur = o.dataset.mkopen; err = ''; draw(); return; }
    const q = t.closest('[data-mkq]'); if (q) { send(q.dataset.mkq); return; }
    const c = t.closest('[data-mkcopy]'); if (c) { const th = threads.find(x => x.id === cur); const m = th && th.messages.find(x => String(x.at) === c.dataset.mkcopy); if (m) { try { await navigator.clipboard.writeText(m.text); c.textContent = 'Скопировано'; setTimeout(() => (c.textContent = 'Копировать'), 1500); } catch (_) {} } return; }
    if (t.closest('#mk-new')) { cur = null; err = ''; draw(); $$('mk-in').focus(); return; }
    if (t.closest('#mk-brief-btn')) { $$('mk-brief').hidden = !$$('mk-brief').hidden; if (!$$('mk-brief').hidden) $$('mk-brief-t').focus(); return; }
    if (t.closest('#mk-brief-save')) {
      const b = t.closest('#mk-brief-save'); b.disabled = true;
      try { await col.doc('brief').set({ text: $$('mk-brief-t').value.trim(), updatedAt: Date.now() }); $$('mk-brief').hidden = true; } catch (_) { err = 'Бриф не сохранился. Проверьте правила базы.'; }
      finally { b.disabled = false; draw(); }
    }
  });
  document.addEventListener('keydown', e => {
    if (e.target && e.target.matches && e.target.matches('[data-mkopen]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.target.click(); }
    if (e.target && e.target.id === 'mk-in' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(e.target.value); }
  });
  document.addEventListener('submit', e => { if (e.target.id === 'mk-form') { e.preventDefault(); send($$('mk-in').value); } });

  init();
})();
