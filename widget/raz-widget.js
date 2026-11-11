/* RAZ_WIDGET — виджеты учёта студии для iPhone (приложение Scriptable, бесплатно).
   Этот файл скачивает маленький скрипт-«загрузчик» из учёта (кнопка «Виджеты на iPhone»), поэтому
   новый вид виджетов приходит на телефон сам, переустанавливать ничего не нужно.
   Данные — короткая сводка, которую бот на рабочем ПК кладёт в Realtime Database /pub/<ключ>.

   Какой виджет показать, задаётся в «Параметре» виджета (зажать виджет → «Изменить виджет»):
     kaspi — заказы Kaspi, tasks — задачи, orders — ведомость, equip — оборудование, пусто — всё сразу. */
async function RAZ_WIDGET(KEY, opts) {
  opts = opts || {};
  const RTDB = 'https://raz-studio-5a486-default-rtdb.europe-west1.firebasedatabase.app';
  const CRM = 'https://razgulyaevevgeny.github.io/raz-studio-crm/';
  const fam = opts.family || config.widgetFamily || 'large';
  const kind = String(opts.kind != null ? opts.kind : (args.widgetParameter || '')).trim().toLowerCase();
  const K = /kas|кас/.test(kind) ? 'kaspi' : /task|зад/.test(kind) ? 'tasks' : /ord|вед|зак/.test(kind) ? 'orders' : /eq|обор|прин|print/.test(kind) ? 'equip' : 'all';

  /* ---------- цвета как в iOS (светлая и тёмная тема) ---------- */
  // Всегда светлые (просьба Евгения 08.11): тёмный вариант не используем, даже если на iPhone тёмная тема
  const C = (l) => new Color(l);
  const T = {
    bg: C('#FFFFFF', '#1C1C1E'), text: C('#000000', '#FFFFFF'), sub: C('#8E8E93', '#98989F'), line: C('#E5E5EA', '#38383A'),
    blue: C('#007AFF', '#0A84FF'), red: C('#FF3B30', '#FF453A'), orange: C('#FF9500', '#FF9F0A'), green: C('#34C759', '#30D158'),
    purple: C('#AF52DE', '#BF5AF2'), indigo: C('#5856D6', '#5E5CE6'), teal: C('#30B0C7', '#40C8E0'), kaspi: C('#F14635', '#FF5A4A'),
    chipBg: C('#F2F2F7', '#2C2C2E'), alarm: C('#FFE5E3', '#3A1A18'),
  };
  const META = {
    kaspi: { title: 'Kaspi', icon: 'shippingbox.fill', c: T.kaspi, url: CRM + '#kaspi' },
    tasks: { title: 'Задачи', icon: 'checkmark.circle.fill', c: T.orange, url: CRM + '#tasks' },
    orders: { title: 'Ведомость', icon: 'doc.text.fill', c: T.blue, url: CRM + '#orders' },
    equip: { title: 'Оборудование', icon: 'printer.fill', c: T.green, url: CRM + '#equip' },
    all: { title: 'Студия', icon: 'square.grid.2x2.fill', c: T.indigo, url: CRM },
  };
  const ST = { new: ['Новый', T.blue], agree: ['Согласование', T.teal], design: ['Разработка', T.purple], prod: ['Производство', T.orange], ready: ['Готов', T.green] };

  /* ---------- данные (последнюю удачную сводку храним на телефоне — без интернета покажем её) ---------- */
  let D = opts.data || null, offline = false;
  const fm = FileManager.local(), cache = fm.joinPath(fm.cacheDirectory(), 'raz-widget-data.json');
  if (!D) {
    try {
      const r = new Request(RTDB + '/pub/' + encodeURIComponent(KEY) + '.json'); r.timeoutInterval = 15;
      D = await r.loadJSON();
      if (D && D.v) fm.writeString(cache, JSON.stringify(D)); else D = null;
    } catch (e) { D = null; }
    if (!D) { offline = true; try { if (fm.fileExists(cache)) D = JSON.parse(fm.readString(cache)); } catch (e) {} }
  }
  const now = opts.now || Date.now();

  /* ---------- помощники ---------- */
  const pad = n => String(n).padStart(2, '0');
  const dayStr = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const today = dayStr(now), tomorrow = dayStr(now + 864e5);
  const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const dShort = s => { if (!s) return ''; if (s === today) return 'сегодня'; if (s === tomorrow) return 'завтра'; const [, m, d] = s.split('-').map(Number); return d + ' ' + MON[m - 1]; };
  const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
  const small = fam === 'small', large = fam === 'large' || fam === 'extraLarge';

  const w = new ListWidget();
  w.backgroundColor = T.bg;
  w.url = META[K].url;
  w.refreshAfterDate = new Date(now + 10 * 60e3);
  const pd = small ? 14 : 15; w.setPadding(pd, pd, pd, pd);

  const txt = (st, s, size, color, weight, lines) => {
    const t = st.addText(String(s)); t.font = weight === 'b' ? Font.boldSystemFont(size) : weight === 's' ? Font.semiboldSystemFont(size) : weight === 'm' ? Font.mediumSystemFont(size) : Font.systemFont(size);
    t.textColor = color || T.text; t.lineLimit = lines || 1; return t;
  };
  const sym = (st, name, size, color) => { const s = SFSymbol.named(name); if (!s) return null; s.applyFont(Font.semiboldSystemFont(size)); const i = st.addImage(s.image); i.imageSize = new Size(size, size); i.tintColor = color; return i; };
  const dot = (st, color, size) => { const d = st.addStack(); d.size = new Size(size, size); d.cornerRadius = size / 2; d.backgroundColor = color; return d; };

  const gap = (st, n) => st.addSpacer(n);
  function header(st, k, right, rightColor) {
    const h = st.addStack(); h.centerAlignContent();
    sym(h, META[k].icon, small ? 13 : 14, META[k].c); h.addSpacer(5);
    txt(h, META[k].title, small ? 13 : 14, META[k].c, 'b');
    h.addSpacer();
    if (right) txt(h, right, 11, rightColor || T.sub, 's');
    return h;
  }
  // строка списка: цветная точка, текст, справа срок; на большом виджете — вторая строка серым
  function row(st, x, withUnder) {
    const r = st.addStack(); r.centerAlignContent();
    dot(r, x.color, 7); r.addSpacer(7);
    const m = r.addStack(); m.layoutVertically();
    txt(m, x.title, small ? 12 : 13, T.text, 'm');
    if (withUnder && x.under) txt(m, x.under, 11, T.sub);
    r.addSpacer();
    if (x.right && !small) { r.addSpacer(4); txt(r, x.right, small ? 11 : 12, x.rc || T.sub, 's'); }
    return r;
  }
  function footer(st) {
    st.addSpacer();
    const f = st.addStack(); f.centerAlignContent();
    const stale = !D || now - (D.at || 0) > 20 * 60e3;
    txt(f, !D ? 'нет данных' : (stale ? '⚠︎ ПК студии не на связи · ' : offline ? 'без интернета · ' : 'обновлено ') + (D ? hm(D.at) : ''), 10, stale || offline ? T.orange : T.sub, 'm');
  }

  /* ---------- что показывает каждый виджет ---------- */
  const late = d => d && d < today, isToday = d => d === today;
  const dueC = d => late(d) ? T.red : isToday(d) ? T.orange : T.sub;
  const PS = { print: ['печатает', T.green], prep: ['готовится', T.teal], pause: ['пауза', T.orange], err: ['ошибка', T.red], done: ['готово', T.blue], idle: ['свободен', T.sub], off: ['не в сети', T.sub] };
  const busyOf = e => (e.list || []).filter(p => ['print', 'prep', 'pause'].includes(p.st)).length;
  function model(k) {
    if (k === 'kaspi') {
      const x = D.kaspi || {};
      if (x.todo == null) return { n: '—', label: 'Kaspi пока не ответил', sub: [], rows: [] };
      return { n: x.todo, label: plural(x.todo, 'заказ', 'заказа', 'заказов') + ' к отправке', hr: x.today ? 'сегодня ' + x.today : '', hc: T.kaspi,
        sub: [x.assemble ? ['собрать ' + x.assemble, T.kaspi] : null, x.hand ? ['передать ' + x.hand, T.green] : null, x.onWay ? ['в пути ' + x.onWay, T.sub] : null].filter(Boolean),
        empty: ['Всё отправлено 👍', T.green],
        rows: (x.list || []).map(o => { const d = o.p ? dayStr(o.p) : ''; return { color: o.s === 'h' ? T.green : T.kaspi, title: o.w, right: d ? dShort(d) : '', rc: dueC(d),
          under: (o.s === 'h' ? 'собран, передать курьеру' : 'собрать') + (o.c ? ' · № ' + o.c : '') }; }) };
    }
    if (k === 'tasks') {
      const x = D.tasks || {};
      return { n: x.open || 0, label: x.open ? plural(x.open, 'задача открыта', 'задачи открыты', 'задач открыто') : 'открытых нет', hr: x.late ? 'просрочено ' + x.late : '', hc: T.red,
        sub: [x.late ? ['просрочено ' + x.late, T.red] : null, x.today ? ['дел сегодня ' + x.today, T.orange] : null].filter(Boolean),
        empty: ['Все задачи закрыты 👍', T.green],
        rows: (x.list || []).map(t => ({ color: late(t.d) ? T.red : isToday(t.d) ? T.orange : T.line, title: t.t, right: t.d ? dShort(t.d) + (t.tm && !small ? ' ' + t.tm : '') : '', rc: dueC(t.d), under: t.who || '' })) };
    }
    if (k === 'orders') {
      const x = D.orders || {}, by = x.by || {};
      return { n: x.open || 0, label: plural(x.open || 0, 'заказ', 'заказа', 'заказов') + ' в работе', hr: x.late ? 'просрочено ' + x.late : x.today ? 'сдать сегодня ' + x.today : '', hc: x.late ? T.red : T.orange,
        sub: x.late || x.today ? [x.late ? ['просрочено ' + x.late, T.red] : null, x.today ? ['сдать сегодня ' + x.today, T.orange] : null].filter(Boolean) : [],
        legend: Object.keys(ST).filter(s => by[s]).map(s => [ST[s][0] + ' ' + by[s], ST[s][1]]),
        empty: ['Открытых заказов нет', T.sub],
        rows: (x.list || []).map(o => { const lt = late(o.d) && o.s !== 'ready'; return { color: (ST[o.s] || ST.new)[1], title: o.c + (o.w && !small ? ' · ' + o.w : ''), right: o.d ? dShort(o.d) : '', rc: lt ? T.red : isToday(o.d) ? T.orange : T.sub, under: (ST[o.s] || ST.new)[0] }; }) };
    }
    const e = D.equip || {}, L = e.list || [], busy = busyOf(e);
    const extra = [];
    if (e.cam) extra.push(['Камера ' + (e.cam === 'on' ? 'в сети' : e.cam === 'off' ? 'не в сети' : '—'), e.cam === 'on' ? T.green : e.cam === 'off' ? T.red : T.line]);
    if (e.sens) extra.push([e.smoke ? 'ДЫМ!' : 'Датчик дыма ' + (e.sOn ? 'в норме' : 'не в сети'), e.smoke ? T.red : e.sOn ? T.green : T.line]);
    return { n: busy, label: busy ? plural(busy, 'принтер печатает', 'принтера печатают', 'принтеров печатают') : 'никто не печатает',
      hr: e.smoke ? 'ДЫМ!' : L.length ? L.filter(p => p.st !== 'off').length + ' из ' + L.length + ' в сети' : '', hc: e.smoke ? T.red : T.sub,
      alarm: e.smoke ? '🔥 Сработал датчик дыма' : '', sub: [], legend: extra, empty: ['Нет данных о принтерах', T.sub],
      rows: L.map(p => { const s = PS[p.st] || PS.idle, end = p.end && p.end > now ? 'до ' + hm(p.end) : '';
        return { color: s[1], title: p.n + (small ? (p.pc != null ? ' · ' + p.pc + '%' : '') : ' · ' + s[0]), right: p.pc != null ? p.pc + '%' : small ? s[0] : '', rc: s[1],
          under: p.st === 'err' && p.e ? p.e : [end, p.b].filter(Boolean).join(' · ') }; }) };
  }
  const legend = (st, L) => { const s = st.addStack(); s.centerAlignContent(); L.forEach(([t, c], i) => { if (i) s.addSpacer(8); dot(s, c, 6); s.addSpacer(3); txt(s, t, 11, T.sub, 'm'); }); };
  const alarmBox = (st, t) => { const a = st.addStack(); a.backgroundColor = T.alarm; a.cornerRadius = 8; a.setPadding(5, 8, 5, 8); txt(a, t, 12, T.red, 'b'); a.addSpacer(); };

  function oneKind(st, k) {
    const m = model(k), rows = m.rows || [];
    const list = (box, n, under) => {
      if (!rows.length) { txt(box, m.empty[0], 12, m.empty[1], 's'); return; }
      rows.slice(0, n).forEach((x, i) => { if (i) gap(box, under ? 6 : 5); row(box, x, under); });
      if (rows.length > n) { gap(box, 3); txt(box, '+ ещё ' + (rows.length - n), 11, T.sub, 's'); }
    };
    if (small) {
      header(st, k, ''); gap(st, 4);
      const b = st.addStack(); b.bottomAlignContent(); txt(b, m.n, 30, T.text, 'b'); b.addSpacer(5);
      const sb = b.addStack(); sb.layoutVertically(); txt(sb, (m.sub[0] || [m.label.replace(/^\S+ /, ''), T.sub])[0], 11, (m.sub[0] || [0, T.sub])[1], 's', 2); sb.addSpacer(4);
      if (m.alarm) { gap(st, 4); alarmBox(st, 'ДЫМ!'); return; }
      gap(st, 6); list(st, 3, false);
      return;
    }
    if (fam === 'medium') {
      const h = st.addStack();
      const l = h.addStack(); l.layoutVertically(); l.size = new Size(104, 0);
      header(l, k, ''); gap(l, 4);
      txt(l, m.n, 34, T.text, 'b'); txt(l, m.label, 11, T.sub, 'm', 2); gap(l, 3);
      if (m.alarm) txt(l, 'ДЫМ!', 12, T.red, 'b');
      m.sub.slice(0, 2).forEach(([t, c]) => txt(l, t, 11, c, 's'));
      if (!m.sub.length && m.legend) m.legend.slice(0, 2).forEach(([t, c]) => txt(l, t, 11, c, 's'));
      l.addSpacer();
      h.addSpacer(10);
      const r = h.addStack(); r.layoutVertically(); gap(r, 2);
      list(r, 4, false);
      r.addSpacer();
      return;
    }
    header(st, k, m.hr, m.hc); gap(st, 8);
    const b = st.addStack(); b.bottomAlignContent(); txt(b, m.n, 36, T.text, 'b'); b.addSpacer(8);
    const bl = b.addStack(); bl.layoutVertically(); txt(bl, m.label, 13, T.sub, 'm'); bl.addSpacer(5);
    if (m.alarm) { gap(st, 6); alarmBox(st, m.alarm); }
    if (m.sub.length) { gap(st, 4); legend(st, m.sub); }
    if (m.legend && m.legend.length) { gap(st, 4); legend(st, m.legend); }
    gap(st, 10);
    list(st, m.sub.length && m.legend && m.legend.length ? 6 : 7, true);
  }

  /* ---------- «всё сразу» ---------- */
  function tileVals(k) {
    const m = model(k);
    const note = k === 'kaspi' ? (D.kaspi && D.kaspi.today ? ['сегодня ' + D.kaspi.today, T.kaspi] : ['к отправке', T.sub])
      : k === 'tasks' ? (D.tasks && D.tasks.late ? ['просрочено ' + D.tasks.late, T.red] : ['открыто', T.sub])
      : k === 'orders' ? (D.orders && D.orders.late ? ['просрочено ' + D.orders.late, T.red] : D.orders && D.orders.today ? ['сегодня ' + D.orders.today, T.orange] : ['в работе', T.sub])
      : m.alarm ? ['ДЫМ!', T.red] : ['печатают', T.sub];
    return [m.n, note];
  }
  function tile(st, k, wdt, hgt) {
    const t = st.addStack(); t.layoutVertically(); t.backgroundColor = T.chipBg; t.cornerRadius = 12; t.setPadding(7, 10, 7, 10); t.url = META[k].url; t.size = new Size(wdt, hgt);
    const [n, note] = tileVals(k);
    const h = t.addStack(); h.centerAlignContent(); sym(h, META[k].icon, 12, META[k].c); h.addSpacer(4); txt(h, META[k].title, 12, META[k].c, 'b'); h.addSpacer();
    t.addSpacer();
    const b = t.addStack(); b.bottomAlignContent(); txt(b, n, 22, T.text, 'b'); b.addSpacer(6);
    const nb = b.addStack(); nb.layoutVertically(); txt(nb, note[0], 10, note[1], 's'); nb.addSpacer(4);
    b.addSpacer();
  }
  function allBlock(st) {
    const ks = ['kaspi', 'tasks', 'orders', 'equip'];
    if (small) {
      ks.forEach((k, i) => {
        if (i) gap(st, 7);
        const r = st.addStack(); r.centerAlignContent(); r.url = META[k].url;
        const [n, note] = tileVals(k);
        sym(r, META[k].icon, 13, META[k].c); r.addSpacer(6);
        const m = r.addStack(); m.layoutVertically(); txt(m, META[k].title, 12, T.text, 's'); txt(m, note[0], 10, note[1], 'm');
        r.addSpacer(); txt(r, n, 18, T.text, 'b');
      });
      return;
    }
    const W = 151, H = fam === 'medium' ? 56 : 62;
    [ks.slice(0, 2), ks.slice(2)].forEach((p, j) => { if (j) gap(st, 6); const r = st.addStack(); p.forEach((k, i) => { if (i) r.addSpacer(6); tile(r, k, W, H); }); });
    if (!large) return;
    const mini = (title, k) => {
      const m = model(k); gap(st, 12); txt(st, title, 11, T.sub, 's'); gap(st, 5);
      if (!m.rows.length) { txt(st, m.empty[0], 12, m.empty[1], 's'); return; }
      m.rows.slice(0, 3).forEach((x, i) => { if (i) gap(st, 5); row(st, x, false); });
    };
    mini('ЗАДАЧИ', 'tasks'); mini('KASPI К ОТПРАВКЕ', 'kaspi');
  }

  /* ---------- экран блокировки ---------- */
  function lock() {
    const k2 = (D && D.kaspi) || {}, ta = (D && D.tasks) || {}, o = (D && D.orders) || {}, e = (D && D.equip) || {};
    const busy = (e.list || []).filter(p => ['print', 'prep', 'pause'].includes(p.st)).length;
    const n = { kaspi: k2.todo || 0, tasks: ta.open || 0, orders: o.open || 0, equip: busy, all: (k2.todo || 0) + (ta.open || 0) }[K];
    const line = { kaspi: `Kaspi: ${k2.todo || 0} к отправке${k2.today ? ', сегодня ' + k2.today : ''}`,
      tasks: `Задачи: ${ta.open || 0}${ta.late ? ', просрочено ' + ta.late : ''}`,
      orders: `Ведомость: ${o.open || 0} в работе${o.late ? ', просрочено ' + o.late : ''}`,
      equip: e.smoke ? 'ДЫМ в студии!' : `Печатают: ${busy} из ${(e.list || []).length}`,
      all: `Kaspi ${k2.todo || 0} · задачи ${ta.open || 0} · заказы ${o.open || 0}` }[K];
    w.setPadding(0, 0, 0, 0);
    if (fam === 'accessoryInline') { txt(w, line, 12, Color.white()); return; }
    if (fam === 'accessoryCircular') {
      w.addAccessoryWidgetBackground = true;
      const s = w.addStack(); s.layoutVertically(); s.centerAlignContent();
      const a = s.addStack(); a.addSpacer(); sym(a, META[K].icon, 12, Color.white()); a.addSpacer();
      const b = s.addStack(); b.addSpacer(); txt(b, n, 20, Color.white(), 'b'); b.addSpacer();
      return;
    }
    const h = w.addStack(); h.centerAlignContent(); sym(h, META[K].icon, 12, Color.white()); h.addSpacer(4); txt(h, META[K].title, 13, Color.white(), 'b');
    const first = K === 'kaspi' ? ((k2.list || [])[0] || {}).w : K === 'tasks' ? ((ta.list || [])[0] || {}).t : K === 'orders' ? ((o.list || [])[0] || {}).c : '';
    txt(w, line.replace(/^[^:]+: /, ''), 12, Color.white(), 'm');
    if (first) txt(w, first, 12, new Color('#FFFFFF', 0.75));
  }

  if (/^accessory/.test(fam)) lock();
  else {
    const st = w.addStack(); st.layoutVertically();
    if (!D) { header(st, K, ''); gap(st, 8); txt(st, 'Нет связи со сводкой. Проверьте интернет; если долго так — включён ли ПК студии.', 12, T.sub, 'm', 4); }
    else if (K === 'all') allBlock(st);
    else oneKind(st, K);
    footer(w);
  }

  if (opts.noPresent) return w;
  if (config.runsInWidget) Script.setWidget(w);
  else if (fam === 'small') await w.presentSmall(); else if (fam === 'medium') await w.presentMedium(); else await w.presentLarge();
  Script.complete();
  return w;
}
