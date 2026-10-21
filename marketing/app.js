/* Отдел маркетинга RAZ Brand Studio — отдельный сайт.
   Данные: Firestore, коллекция marketing (та же, что раньше была в учёте), прайс и заказы — из учёта (только чтение).
   ИИ: сервер raz-marketing (Cloudflare) → /api/gen. Все инструкции агентов живут здесь и правятся во вкладке «Справочник → Агенты». */
(function () {
  'use strict';
  const API = 'https://raz-marketing.design-onegin.workers.dev';
  const DEPT_NEED = 6; // версия отдела в marketing-worker/worker.js (DEPT_VER)

  /* ================= справочники ================= */
  const TYPES = {
    content: { l: 'Съёмка и контент', c: '--violet' },
    sales: { l: 'Продажи', c: '--ok' },
    offer: { l: 'Акция и оффер', c: '--danger' },
    idea: { l: 'Идея', c: '--warn' },
    strategy: { l: 'Стратегия и цифры', c: '--blue' }
  };
  const FORMATS = { reels: 'Reels', post: 'Пост', carousel: 'Карусель', stories: 'Сторис', live: 'Эфир', none: 'Без публикации' };
  const ST_CONTENT = { plan: 'Запланировано', shot: 'Снято', edited: 'Смонтировано', done: 'Опубликовано' };
  const ST_OTHER = { plan: 'Запланировано', work: 'В работе', done: 'Сделано' };
  const stOf = e => e.type === 'content' ? ST_CONTENT : ST_OTHER;
  const SVCS = { vinyl: 'Винил на авто', dtf: 'DTF-печать', sign3d: '3D-таблички и вывески', print3d: '3D-печать', toppers: 'Топперы', other: 'Другое' };
  const SVC_RX = { vinyl: /винил|наклейк|оклейк|авто|машин|стекл|плот/i, dtf: /dtf|дтф|футболк|худи|свитшот|принт|мерч|одежд/i, sign3d: /табличк|вывеск|навигац|qr|кофейн|кафе|барбер/i, print3d: /3d|3д|принтер|напечата|пластик/i, toppers: /топпер|торт/i };
  const CRM_SVC = { vinyl: 'Винил на авто', dtf: 'DTF-печать', print3d: '3D-печать', sign3d: '3D-вывеска', embroidery: 'Вышивка', printing: 'Распечатка', kaspi: 'Kaspi', other: 'Другое' };
  const ABOUT = [
    ['city', 'Город и адрес', 'Город, район, ориентир, парковка'],
    ['contacts', 'Контакты', 'WhatsApp, телефон, Instagram, 2ГИС, Kaspi'],
    ['hours', 'График работы', 'Пн–Сб 10:00–19:00'],
    ['usp', 'Чем мы лучше других', 'Своё производство, срок 1 день, бесплатный макет…'],
    ['services', 'Услуги и условия', 'Что делаем, сроки, гарантии, минимальный заказ, доставка'],
    ['audience', 'Наши клиенты', 'Кто заказывает чаще всего и зачем'],
    ['tone', 'Как мы общаемся', 'На «ты» или «вы», дерзко или спокойно, языки'],
    ['brand', 'Фирменный стиль', 'Цвета, шрифты, что можно и нельзя'],
    ['shooting', 'Чем и где снимаем', 'Телефон, штатив, свет, где в мастерской удобно снимать, кто бывает в кадре'],
    ['cases', 'Кейсы и известные клиенты', 'С кем работали, лучшие работы'],
    ['goals', 'Цели на 3 месяца', 'Сколько заказов и выручки хотим, что запускаем'],
    ['tried', 'Что пробовали и не сработало', ''],
    ['notes', 'Дополнительно', 'Всё остальное, что важно знать']
  ];
  const ROLES = {
    marketer: { name: 'Маркетолог', sub: 'стратегия, офферы, цены, КП', c: '--blue', ini: 'М',
      quick: ['Стратегия продаж на месяц для трёх главных услуг', 'Проверь наш прайс: где наценка низкая и что поднять', 'Собери пакеты 3D-табличек для кофейни', 'Напиши КП для барбершопа', 'Холодное сообщение заведению в WhatsApp'] },
    smm: { name: 'SMM-менеджер', sub: 'Instagram, Reels, посты, сторис', c: '--violet', ini: 'S',
      quick: ['Что у нас уже есть в Instagram и чего не хватает', 'Контент-план на 2 недели', '5 идей Reels из процесса в мастерской', 'Перепиши шапку профиля и Highlights'] },
    analyst: { name: 'Аналитик', sub: 'конкуренты, продажи, клиенты', c: '--warn', ini: 'А',
      quick: ['Сравни нас с конкурентами из справочника', 'Какие услуги растут, а какие падают', 'Портреты клиентов по трём услугам', 'Скрипт «тайного покупателя» для обзвона конкурентов'] },
    team: { name: 'Планёрка', sub: 'все трое по очереди', c: '--ok', ini: '★', team: true,
      quick: ['Как поднять продажи винила на авто за месяц', 'Запускаем 3D-таблички для заведений — план', 'Маркетинговый план на следующий месяц'] }
  };

  /* инструкции агентов по умолчанию — их можно переписать во вкладке «Справочник → Агенты» */
  const PROMPTS = {
    base: `Ты работаешь в маркетинговом отделе студии брендирования RAZ Brand Studio (Казахстан, Instagram @raz.brandstudio).
Владелец — Евгений. Команда — 2 человека, времени мало: всё, что предлагаешь, должно выполняться силами 1–2 человек, снимается на телефон.
Рекламного бюджета нет: таргет, платных блогеров и платные площадки не предлагай, пока не попросят. Каналы: Instagram, WhatsApp, Telegram-чаты города, 2ГИС, Kaspi, сарафан, партнёрства, офлайн-визиты.
Оборудование: 3D-принтер Bambu Lab A1, DTF-печать, плоттер для винила, вышивка.
Главные услуги (по ним просадка): 1) виниловые наклейки на авто — логотипы, инстаграмы, надписи; 2) DTF-печать на футболках — мерч для компаний, команд, мероприятий; 3) 3D-таблички и вывески для заведений (кафе, кофейни, барбершопы, салоны) — только запускается. Ещё: 3D-топперы, распечатка, Kaspi.
Правила: пиши по-русски, просто и конкретно, без воды. Не выдумывай цифры, цены конкурентов и факты — если данных нет, скажи и подскажи, где взять. Цены студии бери только из прайса и офферов ниже. Не обещай результат в цифрах.`,
    marketer: `Твоя роль — МАРКЕТОЛОГ-СТРАТЕГ. Стратегия и план на месяц, офферы и пакеты, цены (сравнивай прайс с себестоимостью и наценкой), КП, скрипты продаж, поиск клиентов без бюджета, партнёрства. Формат стратегии: цель → сегменты → оффер → каналы → план по неделям с датами → что считать. Заканчивай блоком «Что сделать сегодня» (до 3 действий). Оформляй markdown: ## заголовки, списки, таблицы.`,
    smm: `Твоя роль — SMM-МЕНЕДЖЕР, ведёшь Instagram @raz.brandstudio. Контент-план таблицей «дата — формат — тема — цель», идеи Reels, сценарии покадрово, подписи, сторис с опросами, шапка профиля, хештеги. Главный ресурс — процесс в мастерской: 3D-печать, нарезка и поклейка винила, перенос DTF, «до/после», кейсы, «сколько стоит». Не больше 3–5 публикаций в неделю. Опирайся на данные Instagram ниже: что уже было и чего не хватает. Оформляй markdown.`,
    analyst: `Твоя роль — АНАЛИТИК. Разбор конкурентов из справочника, сравнение цен и подачи, анализ продаж по цифрам учёта (что растёт, что просело), сезонность, портреты клиентов. Поиска в интернете нет — работай с данными ниже и с тем, что владелец вставит в чат; чего нет — пиши «нет данных» и где взять (2ГИС, Instagram конкурента, звонок тайного покупателя со скриптом). Отделяй факты от выводов. Оформляй markdown.`,
    planner: `Ты — планировщик маркетингового календаря. Составь СПИСОК событий. Подробности каждого события потом отдельно распишет продюсер, поэтому здесь только суть.
Для каждого события:
- date — ГГГГ-ММ-ДД, строго внутри периода;
- title — конкретно, до 70 символов: «Reels: поклейка логотипа на заднее стекло», «10 сообщений кофейням про таблички»;
- type — content (съёмка и публикации), sales (продажи: сообщения, звонки, визиты, КП), offer (запуск акции или оффера), idea (проверить идею), strategy (итоги недели, замер цифр);
- format — reels, post, carousel, stories, live или none (если без публикации);
- idea — 2–4 предложения: что конкретно делаем, для кого, чем цепляем;
- src — если дан исходный план или переписка: ДОСЛОВНО скопируй оттуда всё, что относится к этому событию (сценарий, тексты, скрипты, цены). Иначе пусто.
Распределяй равномерно, не ставь больше 2 событий на день, оставляй выходной. Не дублируй события, которые уже есть в календаре.`,
    producer: `Ты — продюсер контента и маркетолог студии. Тебе дают ОДНО событие из календаря. Распиши его так, чтобы человек утром открыл карточку и сразу сделал — ничего не придумывая и не возвращаясь к переписке.
Поля ответа:
- goal — зачем и какой результат ждём (1–2 предложения);
- idea — суть и хук: чем зацепим в первые 2 секунды;
- time — сколько займёт и лучшее время публикации («≈1,5 ч: съёмка 30 мин, монтаж 40 мин. Публикация в 19:00»);
- prep — что подготовить до начала: реквизит, заготовки, образцы работ, локация, свет, кто в кадре, во что одет, чистый объектив и заряд телефона. Каждый пункт отдельно;
- shots — раскадровка, 4–10 кадров. frame — что в кадре и что происходит; angle — план и ракурс (крупно / средний / общий, сверху, с рук, штатив, POV); sec — секунды; onscreen — текст на экране дословно; voice — что говорим в кадре или за кадром дословно;
- voice — весь текст закадра или слова целиком, одним текстом;
- music — настроение, темп, жанр; что вбить в поиск аудиотеки Instagram; громкость относительно голоса. Названия треков — только если уверен, с пометкой «проверь в аудиотеке»;
- edit — монтаж: длина ролика, где ускорить, переходы, субтитры, обложка (какой кадр и текст на обложке);
- caption — готовая подпись к публикации: 3–6 коротких абзацев, призыв написать в Direct или WhatsApp. Без хештегов;
- hashtags — 6–10 хештегов одной строкой;
- steps — пошаговый план по порядку, 5–10 пунктов, каждый — одно действие;
- notes — всё остальное, что нужно (markdown можно). Для продаж: кому писать и сколько, готовые тексты сообщений, скрипт, ответы на возражения. Для акций: условия, цена, срок, тексты для сторис и WhatsApp. Для стратегии и цифр: что посчитать, где взять данные, критерий успеха.
Если событие не про съёмку — оставь shots, voice, music, edit, caption, hashtags пустыми.
Если дан материал из исходного плана — перенеси его в нужные поля дословно, ничего не сокращай, и допиши недостающее.`,
    designer: `Ты — дизайнер креативов студии для Instagram. Придумай тексты для картинок-креативов, сайт соберёт их по шаблону.
Сделай 3 варианта с разными шаблонами и углами подачи (выгода, процесс или результат, цена или оффер).
Шаблоны: bold — крупный заголовок на цветном фоне; photo — фото на весь экран, текст снизу; price — фото сверху и круглый ценник; list — заголовок и список преимуществ.
headline — до 45 символов, цепляющий и конкретный; sub — до 100 символов или пусто; bullets — до 4 пунктов по 40 символов (только для list); price — только из прайса или офферов, иначе пусто; cta — до 24 символов; badge — до 16 символов или пусто; bg_prompt — английский промпт для фонового фото без текста и логотипов.
caption — готовая подпись к посту с призывом и 5–8 хештегами.`
  };

  /* схемы ответов для Gemini — так он не ломает JSON */
  const STR = { type: 'STRING' }, ARR = it => ({ type: 'ARRAY', items: it });
  const SCHEMA_PLAN = { type: 'OBJECT', properties: { events: ARR({ type: 'OBJECT', properties: { date: STR, title: STR, type: STR, format: STR, idea: STR, src: STR }, required: ['date', 'title', 'type'] }) }, required: ['events'] };
  const SCHEMA_EVENT = { type: 'OBJECT', properties: {
    goal: STR, idea: STR, time: STR, prep: ARR(STR),
    shots: ARR({ type: 'OBJECT', properties: { frame: STR, angle: STR, sec: STR, onscreen: STR, voice: STR }, required: ['frame'] }),
    voice: STR, music: STR, edit: STR, caption: STR, hashtags: STR, steps: ARR(STR), notes: STR
  }, required: ['goal', 'steps'] };
  const SCHEMA_CRT = { type: 'OBJECT', properties: { caption: STR, variants: ARR({ type: 'OBJECT', properties: { template: STR, theme: STR, headline: STR, sub: STR, bullets: ARR(STR), price: STR, cta: STR, badge: STR, bg_prompt: STR }, required: ['headline'] }) }, required: ['variants'] };

  /* ================= помощники ================= */
  const $ = id => document.getElementById(id);
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const ds = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ds(new Date());
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ds(new Date(y, m - 1, d + n)); };
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MGEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const WDS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const dobj = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtD = s => s ? (+s.slice(8)) + ' ' + MGEN[+s.slice(5, 7) - 1] : '';
  const fmtDW = s => s ? fmtD(s) + ', ' + WD[dobj(s).getDay()] : '';
  const fmtT = t => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); };
  const money = n => Math.round(n || 0).toLocaleString('ru-RU') + ' ₸';
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
  const daysAgo = d => d ? Math.round((dobj(today()) - dobj(d)) / 864e5) : null;
  function toast(m, ms) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms || 2600); }
  const me = () => (state.user && (state.user.displayName || state.user.email || '').split('@')[0]) || '';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function parseJSON(t) {
    t = String(t || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (_) {}
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
    throw new Error('ИИ ответил в непонятном виде. Нажмите ещё раз.');
  }
  async function copy(text, el) { try { await navigator.clipboard.writeText(text); if (el) { const l = el.textContent; el.textContent = 'Скопировано'; setTimeout(() => (el.textContent = l), 1400); } else toast('Скопировано'); } catch (_) { toast('Не удалось скопировать'); } }
  const autoH = el => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };

  /* мини-markdown */
  function inline(s) {
    s = E(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  }
  function md(src) {
    const L = String(src || '').replace(/\r/g, '').split('\n'), out = [];
    const isRow = l => /^\s*\|.*\|\s*$/.test(l), cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const isLi = l => /^\s*([-*+•]|\d+[.)])\s+/.test(l);
    let i = 0;
    while (i < L.length) {
      const l = L[i]; let m;
      if (!l.trim()) { i++; continue; }
      if (/^```/.test(l)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; out.push('<pre>' + E(b.join('\n')) + '</pre>'); continue; }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (isRow(l) && i + 1 < L.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(L[i + 1]) && L[i + 1].includes('-')) {
        const h = cells(l); i += 2; const rows = [];
        while (i < L.length && isRow(L[i])) rows.push(cells(L[i++]));
        out.push('<div class="tw"><table><thead><tr>' + h.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      if (isLi(l)) {
        const ol = /^\s*\d/.test(l), lis = [];
        while (i < L.length && isLi(L[i])) lis.push(inline(L[i++].replace(/^\s*([-*+•]|\d+[.)])\s+/, '')));
        out.push((ol ? '<ol>' : '<ul>') + lis.map(x => '<li>' + x + '</li>').join('') + (ol ? '</ol>' : '</ul>'));
        continue;
      }
      const p = [];
      while (i < L.length && L[i].trim() && !/^(#{1,4}\s|```)/.test(L[i]) && !isLi(L[i]) && !isRow(L[i])) p.push(L[i++]);
      if (!p.length) { out.push('<p>' + inline(L[i++]) + '</p>'); continue; }
      out.push('<p>' + p.map(inline).join('<br>') + '</p>');
    }
    return out.join('');
  }

  /* ================= состояние ================= */
  const state = {
    user: null, loaded: false, items: [], threads: [], about: {}, ig: null, agents: {}, prices: [], orders: [], status: null,
    view: 'cal', calMode: 'month', calYM: today().slice(0, 7), weekStart: '', typeOff: new Set(),
    baseTab: 'about', role: 'marketer', thread: null, chatBusy: null, chatErr: '',
    igSyncing: false, crt: { topic: '', svc: 'vinyl', format: 'post', photo: null, photoUrl: '', useAI: true, busy: '', caption: '', variants: [], previews: [], bg: null, err: '' }
  };
  try { const v = localStorage.getItem('mkt-view'); if (v) state.view = v; const c = localStorage.getItem('mkt-cal'); if (c) state.calMode = c; const r = localStorage.getItem('mkt-role'); if (ROLES[r]) state.role = r; } catch (_) {}
  // ссылки из виджета Саши в CRM: ?view=dept — вкладка «Отдел», ?open=<id> — карточка ролика
  const deep = new URLSearchParams(location.search);
  if (['cal', 'dept'].includes(deep.get('view'))) state.view = deep.get('view');
  let deepOpen = deep.get('open') || '';
  if (deep.has('view') || deepOpen) history.replaceState(null, '', location.pathname);
  const remember = () => { try { localStorage.setItem('mkt-view', state.view); localStorage.setItem('mkt-cal', state.calMode); localStorage.setItem('mkt-role', state.role); } catch (_) {} };
  const of = k => state.items.filter(x => x.kind === k);
  const prompt = k => (state.agents[k] && String(state.agents[k]).trim()) || PROMPTS[k];

  /* ================= Firebase ================= */
  if (!window.firebase || !window.FIREBASE_CONFIG) { document.body.innerHTML = '<p style="padding:24px">Не загрузились настройки Firebase.</p>'; return; }
  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth(), fs = firebase.firestore();
  const col = fs.collection('marketing');

  $('login-form').addEventListener('submit', async e => {
    e.preventDefault(); const b = $('l-btn'); b.disabled = true; $('l-err').textContent = '';
    try { await auth.signInWithEmailAndPassword($('l-email').value.trim(), $('l-pass').value); }
    catch (x) { $('l-err').textContent = x && x.code === 'auth/network-request-failed' ? 'Нет интернета.' : 'Почта или пароль не подходят.'; }
    finally { b.disabled = false; }
  });
  let unsub = [];
  auth.onAuthStateChanged(u => {
    unsub.forEach(f => f()); unsub = [];
    state.user = u;
    $('login').hidden = !!u;
    if (!u) return;
    $('who').innerHTML = `<span>${E(me())}</span><button type="button" id="logout">Выйти</button>`;
    unsub.push(col.onSnapshot(s => {
      const items = [], threads = [];
      s.docs.forEach(d => {
        const x = { id: d.id, ...d.data() };
        if (d.id === 'about') state.about = x; else if (d.id === 'ig') state.ig = x; else if (d.id === 'agents') state.agents = x;
        else if (d.id === 'brief') { if (!state.about.notes && x.text) state.aboutBrief = x.text; }
        else if (Array.isArray(x.messages)) threads.push(x); else if (x.kind) items.push(x);
      });
      threads.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      state.items = items; state.threads = threads; state.loaded = true;
      onData();
    }, e => { state.loaded = true; state.dbErr = 'Нет доступа к базе: ' + (e.message || e.code); render(); }));
    fs.collection('prices').get().then(s => { state.prices = s.docs.map(d => ({ id: d.id, ...d.data() })); }).catch(() => {});
    fs.collection('orders').get().then(s => { state.orders = s.docs.map(d => ({ id: d.id, ...d.data() })); if (state.view === 'cal') render(); }).catch(() => {});
    fetch(API + '/api/status').then(r => r.json()).then(j => { state.status = j; if (state.view === 'ig' || state.view === 'crt' || state.view === 'dept') render(); }).catch(() => (state.status = {}));
    render();
  });

  /* ================= ИИ ================= */
  async function gen(o) {
    const u = auth.currentUser; if (!u) throw new Error('Войдите заново.');
    const tok = await u.getIdToken();
    let res;
    try { res = await fetch(API + '/api/gen', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(o) }); }
    catch (_) { throw new Error('Нет связи с сервером ИИ. Проверьте интернет.'); }
    const j = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error('Сервер ИИ старой версии: обновите код воркера в Cloudflare (файл marketing-worker/worker.js).');
    if (!res.ok) throw new Error(j.error || 'Сервер ответил ' + res.status);
    return j;
  }
  async function genJSON(o, tries = 2) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { const r = await gen({ ...o, json: true }); return parseJSON(r.text); }
      catch (e) { last = e; if (/старой версии|Войдите/.test(e.message)) throw e; await sleep(1500); }
    }
    throw last;
  }

  /* ---------- контекст для агентов (без имён и телефонов клиентов) ---------- */
  function aboutText() {
    const a = state.about || {};
    const p = ABOUT.filter(([k]) => String(a[k] || '').trim()).map(([k, l]) => `- **${l}:** ${String(a[k]).trim()}`);
    if (!a.notes && state.aboutBrief) p.push('- **Заметки:** ' + state.aboutBrief);
    return p.join('\n') || 'Раздел «О студии» пока не заполнен.';
  }
  const recvOf = o => o.receivedAt || (o.createdAt ? ds(new Date(o.createdAt)) : '');
  function salesBy(from, to) { const L = state.orders.filter(o => o.status !== 'cancel').map(o => [recvOf(o), o]).filter(([d]) => d && d >= from && d <= to); return { n: L.length, rev: L.reduce((s, [, o]) => s + (+o.price || 0), 0), list: L }; }
  function igAll() {
    const auto = ((state.ig && state.ig.posts) || []).map(p => ({ ...p, src: 'ig', date: (p.ts || '').slice(0, 10) }));
    const man = of('igpost').map(p => ({ id: p.id, src: 'manual', date: p.date, type: p.type || 'photo', caption: p.caption || '', link: p.link || '', likes: p.likes ?? null, comments: p.comments ?? null, thumb: p.photo && !String(p.photo).startsWith('fsblob:') ? p.photo : '' }));
    return [...auto, ...man].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  const coverage = posts => Object.entries(SVC_RX).map(([k, rx]) => { const L = posts.filter(p => rx.test(p.caption || '')); return { k, l: SVCS[k], n: L.length, last: L[0] ? L[0].date : '' }; });
  function context(opts = {}) {
    const out = [], t = today();
    const unitCost = x => x.cost != null && x.cost !== '' ? +x.cost : (+x.mat || 0) + (+x.work || 0) + (+x.extra || 0);
    const pr = state.prices.filter(x => !x.hidden).slice(0, 90).map(x => {
      const c = x.calc ? 0 : unitCost(x), mk = c > 0 && +x.price ? Math.round((+x.price - c) / c * 100) + '%' : '—';
      return `| ${CRM_SVC[x.svc] || x.svc || ''} | ${x.name || ''} | ${x.unit || 'шт'} | ${x.calc ? 'по расчёту' : (x.from ? 'от ' : '') + money(x.price)} | ${c ? money(c) : '—'} | ${mk} |`;
    });
    out.push('### Прайс студии\n' + (pr.length ? '| Услуга | Позиция | За что | Цена | Себестоимость | Наценка |\n|---|---|---|---|---|---|\n' + pr.join('\n') : 'нет данных'));
    if (!opts.short) {
      const per = (a, b) => { const m = new Map(); salesBy(a, b).list.forEach(([, o]) => { const k = CRM_SVC[o.service] || o.customService || 'Другое', e = m.get(k) || { n: 0, r: 0 }; e.n++; e.r += +o.price || 0; m.set(k, e); }); return m; };
      const now = per(addDays(t, -90), t), prev = per(addDays(t, -180), addDays(t, -91)), keys = [...new Set([...now.keys(), ...prev.keys()])];
      out.push('### Продажи по услугам: 90 дней и предыдущие 90\n' + (keys.length ? keys.map(k => { const a = now.get(k) || { n: 0, r: 0 }, b = prev.get(k) || { n: 0, r: 0 }; return `- ${k}: ${a.n} заказов на ${money(a.r)} (до этого ${b.n} на ${money(b.r)})`; }).join('\n') : 'нет данных'));
    }
    const offs = of('offer').filter(o => o.status !== 'archive');
    out.push('### Офферы\n' + (offs.length ? offs.map(o => `- ${o.title}${o.price ? ' — ' + o.price : ''}${o.audience ? ', для: ' + o.audience : ''}${o.includes ? '. Входит: ' + String(o.includes).replace(/\s+/g, ' ').slice(0, 300) : ''}${o.until ? ', до ' + o.until : ''}`).join('\n') : 'нет'));
    const comp = of('competitor');
    if (!opts.short) out.push('### Конкуренты\n' + (comp.length ? comp.slice(0, 20).map(c => `- ${c.name}${c.services ? ' — ' + c.services : ''}${c.prices ? '. Цены: ' + String(c.prices).replace(/\s+/g, ' ') : ''}${c.strong ? '. Сильные: ' + String(c.strong).replace(/\s+/g, ' ') : ''}${c.weak ? '. Слабые: ' + String(c.weak).replace(/\s+/g, ' ') : ''}`).join('\n') : 'не внесены'));
    const all = igAll();
    out.push('### Instagram @raz.brandstudio\n' + (all.length ? `Публикаций за 30 дней: ${all.filter(x => daysAgo(x.date) <= 30).length}. По услугам: ${coverage(all).map(c => `${c.l} — ${c.n}${c.last ? ' (последний ' + c.last + ')' : ''}`).join('; ')}\nПоследние публикации:\n` + all.slice(0, opts.short ? 8 : 20).map(x => `- ${x.date} ${x.type}${x.likes != null ? ' ❤' + x.likes : ''}: ${String(x.caption || '').replace(/\s+/g, ' ').slice(0, 140)}`).join('\n') : 'данных нет'));
    const evs = of('event').filter(e => e.date >= addDays(t, -7) && e.date <= addDays(t, 45)).sort((a, b) => a.date.localeCompare(b.date));
    out.push('### Календарь маркетинга (−7…+45 дней)\n' + (evs.length ? evs.slice(0, 60).map(e => `- ${e.date} [${(TYPES[e.type] || TYPES.strategy).l}] ${e.title}`).join('\n') : 'пусто'));
    if (!opts.short) { const ids = of('idea').filter(x => x.status === 'new' || x.status === 'work'); if (ids.length) out.push('### Идеи\n' + ids.slice(0, 20).map(x => '- ' + x.title).join('\n')); }
    return out.join('\n\n');
  }
  const system = (role, opts) => prompt('base') + '\n\n' + prompt(role) + '\n\n## О студии\n' + aboutText() + '\n\n## Данные\n' + context(opts) + '\n\nСегодня: ' + today() + ' (' + WD[new Date().getDay()] + ').';

  /* ================= события ================= */
  const FIELDS = ['title', 'date', 'time', 'type', 'format', 'status', 'goal', 'idea', 'prep', 'shots', 'voice', 'music', 'edit', 'caption', 'hashtags', 'steps', 'notes', 'aiState', 'aiErr', 'src'];
  function norm(x) {
    const e = { ...x };
    e.type = TYPES[e.type] ? e.type : 'strategy';
    if (!FORMATS[e.format]) e.format = e.type === 'content' ? 'reels' : 'none';
    if (!e.status || !stOf(e)[e.status]) e.status = x.done ? 'done' : 'plan';
    const list = (a, doneIdx) => (Array.isArray(a) ? a : []).map((s, i) => typeof s === 'string' ? { t: s, done: (doneIdx || []).includes(i) } : { t: String(s.t || ''), done: !!s.done }).filter(s => s.t);
    e.steps = list(x.steps, x.stepsDone); e.prep = list(x.prep);
    e.shots = (Array.isArray(x.shots) ? x.shots : []).map(s => ({ frame: s.frame || '', angle: s.angle || '', sec: String(s.sec || ''), onscreen: s.onscreen || '', voice: s.voice || '' }));
    const old = [x.details, x.notes].filter(Boolean); if (x.details && x.notes === x.details) old.pop();
    e.notes = old.join('\n\n');
    if (x.goal == null && x.notes && !x.details) { e.goal = ''; }
    ['goal', 'idea', 'time', 'voice', 'music', 'edit', 'caption', 'hashtags', 'aiState', 'aiErr', 'src'].forEach(k => e[k] = e[k] || '');
    return e;
  }
  function packEv(e) { const o = { kind: 'event' }; FIELDS.forEach(k => o[k] = e[k] ?? ''); o.done = e.status === 'done'; o.createdAt = e.createdAt || Date.now(); o.updatedAt = Date.now(); o.by = e.by || me(); return o; }
  const evs = () => of('event').map(norm);
  const evById = id => { const x = state.items.find(i => i.id === id); return x ? norm(x) : null; };
  const filled = e => !!(e.goal || e.steps.length || e.shots.length || e.notes || e.caption);
  const progress = e => { const all = [...e.prep, ...e.steps]; return all.length ? Math.round(all.filter(s => s.done).length / all.length * 100) : null; };
  async function saveEv(e) { await col.doc(e.id).set(packEv(e)); }
  async function createEv(data) {
    const ref = col.doc(); const e = norm({ ...data, id: ref.id, createdAt: Date.now(), by: me() });
    await ref.set(packEv(e)); return ref.id;
  }

  /* очередь «расписать» — работает в фоне, по одному событию */
  const queue = { list: [], running: false, done: 0, total: 0, fails: 0 };
  function enqueue(ids) { ids.forEach(id => { if (!queue.list.includes(id)) queue.list.push(id); }); queue.total += ids.length; runQueue(); }
  async function runQueue() {
    if (queue.running) return; queue.running = true;
    while (queue.list.length) {
      const id = queue.list.shift();
      showQueue();
      try { await detailEvent(id, 'all'); queue.done++; } catch (_) { queue.fails++; queue.done++; }
      showQueue();
      if (queue.list.length) await sleep(1200);
    }
    queue.running = false; showQueue();
    if (queue.total) toast(queue.fails ? `Расписано ${queue.done - queue.fails} из ${queue.total}. Не получилось: ${queue.fails} — нажмите «Расписать» в карточке.` : `Готово: расписано ${queue.total} ${plural(queue.total, 'событие', 'события', 'событий')}`, 5000);
    queue.total = 0; queue.done = 0; queue.fails = 0;
  }
  function showQueue() {
    const el = $('qbar');
    if (queue.running || queue.list.length) {
      const n = Math.min(queue.done + 1, queue.total);
      const html = `<span class="spin"><i></i><i></i><i></i></span> Расписываем ${n} из ${queue.total}…<div class="bar" style="width:100%"><i style="width:${Math.round(queue.done / Math.max(1, queue.total) * 100)}%"></i></div>`;
      if (el) el.innerHTML = html;
      $('toast').hidden = false; $('toast').innerHTML = `Расписываем события: ${n} из ${queue.total}`; clearTimeout(toast.t);
    } else { if (el) el.innerHTML = ''; }
  }

  async function detailEvent(id, mode) {
    let e = evById(id);
    for (let i = 0; !e && i < 30; i++) { await sleep(200); e = evById(id); }   // ждём, пока новое событие придёт из базы
    if (!e) throw new Error('Событие не найдено');
    await col.doc(id).set({ ...packEv(e), aiState: 'pending', aiErr: '' });
    const have = mode === 'fill' ? [
      e.goal && 'Цель: ' + e.goal, e.idea && 'Идея: ' + e.idea, e.prep.length && 'Подготовка: ' + e.prep.map(s => s.t).join('; '),
      e.shots.length && 'Раскадровка уже есть (' + e.shots.length + ' кадров)', e.voice && 'Текст: ' + e.voice, e.caption && 'Подпись: ' + e.caption,
      e.steps.length && 'Шаги: ' + e.steps.map(s => s.t).join('; '), e.notes && 'Заметки: ' + e.notes].filter(Boolean).join('\n') : '';
    const msg = `Событие: ${e.title}\nДата: ${e.date} (${WD[dobj(e.date).getDay()]})\nТип: ${TYPES[e.type].l}\nФормат: ${FORMATS[e.format]}` +
      (e.idea && mode !== 'fill' ? `\nИдея: ${e.idea}` : '') + (e.src ? `\n\n## Материал из исходного плана (перенеси дословно)\n${e.src}` : '') +
      (have ? `\n\n## Уже заполнено владельцем — не меняй, дополни недостающее\n${have}` : '');
    try {
      const j = await genJSON({ system: system('producer', { short: true }), messages: [{ role: 'user', text: msg }], schema: SCHEMA_EVENT, maxTokens: 8192, temperature: 0.7 });
      e = evById(id) || e;
      const take = (k, v) => { if (mode === 'fill' && (Array.isArray(e[k]) ? e[k].length : e[k])) return; if (Array.isArray(v) ? v.length : v) e[k] = v; };
      ['goal', 'idea', 'time', 'voice', 'music', 'edit', 'caption', 'hashtags', 'notes'].forEach(k => take(k, String(j[k] || '').trim()));
      const arr = x => Array.isArray(x) ? x : typeof x === 'string' ? x.split(/\n+|;\s*/).map(t => t.replace(/^\s*(?:[-—•*]|\d+[.)])\s*/, '').trim()) : x && typeof x === 'object' ? Object.values(x) : [];
      take('prep', arr(j.prep).map(t => ({ t: String(t), done: false })).filter(s => s.t));
      take('steps', arr(j.steps).map(t => ({ t: String(t), done: false })).filter(s => s.t));
      take('shots', arr(j.shots).filter(s => s && typeof s === 'object').map(s => ({ frame: String(s.frame || ''), angle: String(s.angle || ''), sec: String(s.sec || ''), onscreen: String(s.onscreen || ''), voice: String(s.voice || '') })).filter(s => s.frame || s.onscreen || s.voice));
      if (e.hashtags) e.hashtags = e.hashtags.replace(/\s*,\s*/g, ' ');
      e.aiState = ''; e.aiErr = '';
      await saveEv(e);
    } catch (err) {
      const cur = evById(id) || e; cur.aiState = 'error'; cur.aiErr = err.message; await saveEv(cur).catch(() => {});
      throw err;
    }
  }

  /* ================= отрисовка ================= */
  const NAV = [['cal', 'Календарь'], ['dept', 'Отдел'], ['agents', 'Агенты'], ['ig', 'Instagram'], ['crt', 'Креативы'], ['base', 'Справочник']];
  function render() {
    if (!state.user) return;
    $('nav').innerHTML = NAV.map(([k, l]) => `<button type="button" data-nav="${k}" ${state.view === k ? 'aria-current="page"' : ''}>${l}</button>`).join('');
    const v = $('view');
    if (!state.loaded) { v.innerHTML = '<div class="empty"><b>Загружаем…</b></div>'; return; }
    if (state.view === 'base' && document.activeElement && document.activeElement.closest && document.activeElement.closest('#about-form')) return;
    let h = state.dbErr ? `<div class="note">${E(state.dbErr)}</div>` : '';
    if (state.status && state.status.ok && !state.status.gen) h += '<div class="note" style="margin-bottom:14px"><b>Нужно обновить сервер ИИ.</b> Откройте Cloudflare → воркер raz-marketing → Edit code, вставьте новый код из файла marketing-worker/worker.js и нажмите Deploy. Без этого агенты не смогут расписывать события.</div>';
    h += state.view === 'cal' ? vCal() : state.view === 'dept' ? vDept() : state.view === 'agents' ? vAgents() : state.view === 'ig' ? vIG() : state.view === 'crt' ? vCrt() : vBase();
    const keep = state.view === 'agents' ? ($('c-in') ? $('c-in').value : '') : null;
    v.innerHTML = h;
    if (keep != null && $('c-in')) $('c-in').value = keep;
    if (state.view === 'crt') paintPreviews();
    if (state.view === 'ig') autoSyncIG();
    if (state.view === 'base' && state.baseTab === 'agents') v.querySelectorAll('textarea').forEach(autoH);
    showQueue();
  }
  function onData() {
    render();
    if (deepOpen && evById(deepOpen)) { const id = deepOpen; deepOpen = ''; openDrawer(id); }
    if (D) { const x = evById(D.id); if (x && (D.e.aiState === 'pending' || x.aiState === 'pending' ? x.aiState !== D.e.aiState || (x.updatedAt || 0) > (D.e.updatedAt || 0) : !D.dirty && !$('drawer').contains(document.activeElement) && (x.updatedAt || 0) > (D.e.updatedAt || 0))) { D.dirty = false; clearTimeout(D.t); D.e = x; drawDrawer(); } }
    if (D && !evById(D.id)) closeDrawer();
  }

  /* ---------- календарь ---------- */
  function evChip(e) {
    const T = TYPES[e.type];
    return `<button type="button" class="ev${e.status === 'done' ? ' done' : ''}" style="--c:var(${T.c})" data-open="${E(e.id)}" draggable="true" data-drag="${E(e.id)}" title="${E(e.title)}"><span>${E(e.title)}</span>${e.aiState === 'pending' ? '<i class="st spin" aria-label="расписывается"><i></i><i></i><i></i></i>' : e.status === 'done' ? '<i class="st">✓</i>' : !filled(e) ? '<i class="st" title="не расписано">○</i>' : ''}</button>`;
  }
  function tCard(e, late) {
    const T = TYPES[e.type], p = progress(e);
    return `<button type="button" class="tc${late ? ' late' : ''}" style="--c:var(${T.c})" data-open="${E(e.id)}">
      <span class="k"><i class="dot"></i>${T.l}${e.format !== 'none' ? ' · ' + FORMATS[e.format] : ''} · ${E(stOf(e)[e.status])}${late ? ' · просрочено с ' + fmtD(e.date) : ''}</span>
      <b>${E(e.title)}</b>${e.goal || e.idea ? `<p>${E(e.goal || e.idea)}</p>` : '<p>Ещё не расписано — откройте и нажмите «Расписать с ИИ».</p>'}
      ${p != null ? `<span class="k">Готово ${p}%${e.time ? ' · ' + E(e.time.split(/[.;]/)[0]) : ''}</span><div class="bar"><i style="width:${p}%"></i></div>` : ''}</button>`;
  }
  function vCal() {
    const all = evs().filter(e => !state.typeOff.has(e.type)), t = today();
    const todayL = all.filter(e => e.date === t), late = all.filter(e => e.date < t && e.date >= addDays(t, -21) && e.status !== 'done'), tom = all.filter(e => e.date === addDays(t, 1));
    let h = `<section class="today"><div class="today-h"><h2>Сегодня, ${fmtDW(t)}</h2><span class="muted">${todayL.length ? todayL.length + ' ' + plural(todayL.length, 'задача', 'задачи', 'задач') : 'задач нет'}${late.length ? ' · ' + late.length + ' не сделано раньше' : ''}${tom.length ? ' · завтра: ' + tom.length : ''}</span><span class="sp"></span><button class="btn pri" type="button" data-plan>Спланировать с агентами</button></div>
      <div id="qbar" class="prog"></div>
      ${todayL.length || late.length ? `<div class="tcards">${todayL.map(e => tCard(e)).join('')}${late.map(e => tCard(e, true)).join('')}</div>` : `<div class="empty"><b>На сегодня ничего не запланировано</b>Нажмите «Спланировать с агентами» — они составят календарь на неделю или месяц и распишут каждое событие: что снимать, слова, музыку, подписи.</div>`}</section>`;
    // панель
    const [y, m] = state.calYM.split('-').map(Number);
    if (!state.weekStart) { const d = dobj(t); state.weekStart = addDays(t, -((d.getDay() + 6) % 7)); }
    const title = state.calMode === 'week' ? `${fmtD(state.weekStart)} — ${fmtD(addDays(state.weekStart, 6))}` : `${MONTHS[m - 1]} ${y}`;
    h += `<div class="ctool"><button class="ib" type="button" data-cal="-1" aria-label="Назад">‹</button><h2>${title}</h2><button class="ib" type="button" data-cal="1" aria-label="Вперёд">›</button><button class="btn soft sm" type="button" data-cal="0">Сегодня</button><span class="sp"></span>
      <div class="seg" role="group" aria-label="Вид">${[['month', 'Месяц'], ['week', 'Неделя'], ['list', 'Список']].map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${state.calMode === k}">${l}</button>`).join('')}</div>
      <button class="btn out sm" type="button" data-new="${t}">+ Событие</button></div>`;
    const inMonth = all.filter(e => e.date.slice(0, 7) === state.calYM);
    h += `<div class="legend">${Object.entries(TYPES).map(([k, x]) => `<button type="button" class="chip" style="--c:var(${x.c})" data-type="${k}" aria-pressed="${!state.typeOff.has(k)}"><i class="dot"></i>${x.l} <em>${evs().filter(e => e.type === k && (state.calMode === 'week' ? e.date >= state.weekStart && e.date <= addDays(state.weekStart, 6) : e.date.slice(0, 7) === state.calYM)).length}</em></button>`).join('')}</div>`;
    if (state.calMode === 'month') {
      const from = state.calYM + '-01', first = dobj(from), shift = (first.getDay() + 6) % 7, start = addDays(from, -shift);
      const dim = new Date(y, m, 0).getDate(), weeks = Math.ceil((shift + dim) / 7);
      h += '<div class="grid">' + WDS.map(w => `<div class="wd">${w}</div>`).join('');
      for (let i = 0; i < weeks * 7; i++) {
        const d = addDays(start, i), L = all.filter(e => e.date === d).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        h += `<div class="day${d.slice(0, 7) !== state.calYM ? ' out' : ''}${d === t ? ' today' : ''}" data-day="${d}" data-drop="${d}"><div class="dn"><b>${+d.slice(8)}</b><button type="button" class="add" data-new="${d}" aria-label="Добавить на ${fmtD(d)}">+</button></div>
          ${L.slice(0, 4).map(evChip).join('')}${L.length > 4 ? `<button type="button" class="more" data-weekof="${d}">ещё ${L.length - 4}</button>` : ''}
          <span class="mdots">${L.slice(0, 4).map(e => `<i class="dot" style="--c:var(${TYPES[e.type].c})"></i>`).join('')}</span></div>`;
      }
      h += '</div>';
      if (!inMonth.length) h += '<p class="muted" style="text-align:center">В этом месяце событий нет.</p>';
    } else if (state.calMode === 'week') {
      h += '<div class="week">';
      for (let i = 0; i < 7; i++) {
        const d = addDays(state.weekStart, i), L = all.filter(e => e.date === d);
        h += `<div class="wcol${d === t ? ' today' : ''}" data-drop="${d}"><h3>${WDS[i]}, ${+d.slice(8)}<small>${MGEN[+d.slice(5, 7) - 1]}</small></h3>
          ${L.map(e => `<button type="button" class="wcard" style="--c:var(${TYPES[e.type].c})" data-open="${E(e.id)}" draggable="true" data-drag="${E(e.id)}"><small>${TYPES[e.type].l}${e.format !== 'none' ? ' · ' + FORMATS[e.format] : ''} · ${E(stOf(e)[e.status])}</small><b>${E(e.title)}</b>${e.goal || e.idea ? `<p>${E(e.goal || e.idea)}</p>` : ''}${e.aiState === 'pending' ? '<small>расписывается…</small>' : !filled(e) ? '<small>не расписано</small>' : progress(e) != null ? `<small>готово ${progress(e)}%</small>` : ''}</button>`).join('')}
          <button type="button" class="lnk" data-new="${d}" style="align-self:flex-start">+ добавить</button></div>`;
      }
      h += '</div>';
    } else {
      const L = all.filter(e => e.date >= t || (e.status !== 'done' && e.date >= addDays(t, -21))).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
      if (!L.length) h += '<div class="empty"><b>Впереди пусто</b>Спланируйте с агентами или добавьте событие.</div>';
      let last = '';
      h += '<div class="list">' + L.map(e => { const T = TYPES[e.type], p = progress(e); const head = e.date !== last ? `<div class="lday">${fmtDW(e.date)}${e.date === t ? ' · сегодня' : ''}</div>` : ''; last = e.date;
        return head + `<button type="button" class="lcard" style="--c:var(${T.c})" data-open="${E(e.id)}"><i class="dot"></i><div><b>${E(e.title)}</b><p>${T.l}${e.format !== 'none' ? ' · ' + FORMATS[e.format] : ''} · ${E(stOf(e)[e.status])}${e.goal ? ' — ' + E(e.goal) : ''}</p></div><span class="muted">${e.aiState === 'pending' ? '<span class="spin"><i></i><i></i><i></i></span>' : !filled(e) ? 'не расписано' : p != null ? p + '%' : ''}</span></button>`; }).join('') + '</div>';
    }
    return h;
  }

  /* ---------- панель события ---------- */
  let D = null;
  function openDrawer(id) {
    const e = evById(id); if (!e) return;
    D = { id, e, dirty: false, t: null };
    $('scrim').hidden = false; $('drawer').hidden = false; document.body.style.overflow = 'hidden';
    drawDrawer();
  }
  function closeDrawer() { if (D && D.dirty) flush(); D = null; $('scrim').hidden = true; $('drawer').hidden = true; document.body.style.overflow = ''; }
  function dirty() { if (!D) return; D.dirty = true; clearTimeout(D.t); const s = $('d-saved'); if (s) s.textContent = 'Сохраняем…'; D.t = setTimeout(flush, 700); }
  async function flush() {
    if (!D || !D.dirty) return; clearTimeout(D.t); D.dirty = false;
    const e = D.e; e.updatedAt = Date.now();
    try { await saveEv(e); const s = $('d-saved'); if (s) s.textContent = 'Сохранено'; } catch (_) { const s = $('d-saved'); if (s) s.textContent = 'Не сохранилось!'; toast('Не сохранилось. Проверьте интернет.'); }
  }
  const ta = (k, val, ph, cls) => `<textarea class="ta${cls ? ' ' + cls : ''}" data-f="${k}" rows="1" placeholder="${E(ph)}">${E(val)}</textarea>`;
  function ckList(k, arr, ph) {
    return `<div class="ck">${arr.map((s, i) => `<div class="ckr${s.done ? ' on' : ''}"><input type="checkbox" data-ck="${k}:${i}" ${s.done ? 'checked' : ''} aria-label="Отметить"><textarea class="ta" data-li="${k}:${i}" rows="1">${E(s.t)}</textarea><button type="button" class="x" data-rm="${k}:${i}" aria-label="Удалить пункт">×</button></div>`).join('')}
      <div class="addrow"><input class="inp" data-addto="${k}" placeholder="${E(ph)}"><button class="btn soft sm" type="button" data-addbtn="${k}">Добавить</button></div></div>`;
  }
  function drawDrawer() {
    if (!D) return;
    const e = D.e, T = TYPES[e.type], ST = stOf(e), content = e.type === 'content', p = progress(e);
    const sec = (title, sub, body, extra) => `<section class="sec"><h3>${title}${sub ? ` <small>${sub}</small>` : ''}<span class="sp"></span>${extra || ''}</h3>${body}</section>`;
    let h = `<div class="dh"><span class="dot" style="--c:var(${T.c})"></span><b style="font:700 14px var(--f)">${T.l}</b><span class="saved" id="d-saved">${e.aiState === 'pending' ? 'ИИ расписывает…' : ''}</span><span class="sp"></span>
      <button class="lnk" type="button" data-dcopy>Копировать всё</button><button class="lnk" type="button" data-ddup>Дублировать</button><button class="lnk del" type="button" data-ddel>Удалить</button><button class="x" type="button" data-dclose aria-label="Закрыть" style="font-size:22px">×</button></div>
      <div class="db">
      <textarea class="ttl" data-f="title" rows="1" aria-label="Название">${E(e.title)}</textarea>
      <div class="meta">
        <label class="field">Дата<input class="inp" type="date" data-f="date" value="${E(e.date)}"></label>
        <label class="field">Тип<select class="inp" data-f="type">${Object.entries(TYPES).map(([k, x]) => `<option value="${k}"${k === e.type ? ' selected' : ''}>${x.l}</option>`).join('')}</select></label>
        <label class="field">Статус<select class="inp" data-f="status">${Object.entries(ST).map(([k, l]) => `<option value="${k}"${k === e.status ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Формат<select class="inp" data-f="format">${Object.entries(FORMATS).map(([k, l]) => `<option value="${k}"${k === e.format ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field" style="grid-column:span 2">Сколько займёт, когда публикуем<input class="inp" data-f="time" value="${E(e.time)}" placeholder="≈1 час, публикация в 19:00"></label>
      </div>`;
    if (e.aiState === 'pending') h += `<div class="ai-box"><b><span class="spin"><i></i><i></i><i></i></span> ИИ расписывает событие…</b><span class="muted">Обычно 15–40 секунд. Можно закрыть — всё сохранится само.</span></div>`;
    else if (!filled(e)) h += `<div class="ai-box"><b>Событие ещё не расписано</b><span class="muted">ИИ заполнит цель, что подготовить${content ? ', раскадровку по кадрам, слова, музыку, монтаж и подпись' : ', шаги и готовые тексты'} — с учётом вашего прайса, Instagram и раздела «О студии».</span><div class="row"><button class="btn pri" type="button" data-dai="all">Расписать с ИИ</button></div>${e.aiState === 'error' ? `<span class="err">Прошлая попытка: ${E(e.aiErr)}</span>` : ''}</div>`;
    else h += `<div class="row"><span class="muted" style="font-size:13px">${p != null ? 'Готово ' + p + '% по чек-листам. ' : ''}${e.aiState === 'error' ? `<span class="err">ИИ: ${E(e.aiErr)}</span>` : ''}</span><span class="sp"></span><button class="lnk" type="button" data-dai="fill">Дописать пустое с ИИ</button><button class="lnk" type="button" data-dai="all">Переписать с ИИ</button>${content ? '<button class="lnk" type="button" data-dcrt>Сделать обложку</button>' : ''}</div>`;
    h += `<div class="secs"${e.aiState === 'pending' ? ' inert style="opacity:.45"' : ''}>`;
    h += sec('Зачем', 'цель и результат', ta('goal', e.goal, 'Что хотим получить: заявки, охват, отзыв…'));
    h += sec('Идея', content ? 'суть и хук первых секунд' : 'суть', ta('idea', e.idea, 'В чём идея, чем цепляем'));
    h += sec('Что подготовить', e.prep.length ? e.prep.filter(s => s.done).length + ' из ' + e.prep.length : '', ckList('prep', e.prep, 'Реквизит, заготовки, свет, кто в кадре…'));
    if (content || e.shots.length) {
      h += sec('Раскадровка', e.shots.length ? e.shots.length + ' ' + plural(e.shots.length, 'кадр', 'кадра', 'кадров') + (e.shots.some(s => +s.sec) ? ', ≈' + e.shots.reduce((s, x) => s + (parseFloat(x.sec) || 0), 0) + ' сек' : '') : '',
        `<div class="shots">${e.shots.map((s, i) => `<div class="shot"><span class="n">${i + 1}</span><div class="f">
          <label class="full">Что в кадре${`<textarea class="ta" rows="1" data-sh="${i}:frame">${E(s.frame)}</textarea>`}</label>
          <label>План и ракурс<textarea class="ta" rows="1" data-sh="${i}:angle">${E(s.angle)}</textarea></label>
          <label>Сек<textarea class="ta" rows="1" data-sh="${i}:sec">${E(s.sec)}</textarea></label>
          <label class="full">Текст на экране<textarea class="ta" rows="1" data-sh="${i}:onscreen">${E(s.onscreen)}</textarea></label>
          <label class="full">Что говорим<textarea class="ta" rows="1" data-sh="${i}:voice">${E(s.voice)}</textarea></label></div>
          <div class="tools"><button class="lnk" type="button" data-shup="${i}" ${i ? '' : 'disabled'} aria-label="Выше">↑</button><button class="lnk" type="button" data-shdn="${i}" aria-label="Ниже">↓</button><button class="lnk del" type="button" data-shrm="${i}">Удалить кадр</button></div></div>`).join('')}
          <button class="btn soft sm" type="button" data-shadd style="align-self:flex-start">+ Кадр</button></div>`);
      h += sec('Слова', 'закадр или что говорим', ta('voice', e.voice, 'Текст целиком'), e.voice ? `<button class="copy" type="button" data-cpf="voice">Копировать</button>` : '');
      h += sec('Музыка', '', ta('music', e.music, 'Настроение, темп, что искать в аудиотеке Instagram'));
      h += sec('Монтаж и обложка', '', ta('edit', e.edit, 'Длина, переходы, субтитры, обложка'));
      h += sec('Подпись к публикации', '', ta('caption', e.caption, 'Готовый текст поста'), e.caption ? `<button class="copy" type="button" data-cpf="caption">Копировать</button>` : '');
      h += sec('Хештеги', '', ta('hashtags', e.hashtags, '#оклейкаавто #винил …'), e.hashtags ? `<button class="copy" type="button" data-cpf="hashtags">Копировать</button>` : '');
    }
    h += sec('Пошагово', e.steps.length ? e.steps.filter(s => s.done).length + ' из ' + e.steps.length : '', ckList('steps', e.steps, 'Следующий шаг…'));
    h += sec('Материалы и заметки', 'тексты, скрипты, ссылки', D.editNotes || !e.notes ? ta('notes', e.notes, 'Тексты сообщений, скрипты, условия акции… Можно markdown') : `<div class="md">${md(e.notes)}</div>`,
      e.notes ? `<button class="copy" type="button" data-cpf="notes">Копировать</button><button class="copy" type="button" data-notes>${D.editNotes ? 'Готово' : 'Изменить'}</button>` : '');
    if (!content && !e.shots.length) h += `<button class="lnk" type="button" data-shadd style="align-self:flex-start">+ Добавить раскадровку</button>`;
    h += '</div>';
    h += `<p class="muted" style="font-size:12px;margin:0">Всё сохраняется само. ${e.by ? 'Создал(а): ' + E(e.by) + '. ' : ''}${e.updatedAt ? 'Изменено ' + fmtT(e.updatedAt) + '.' : ''}</p></div>`;
    const dr = $('drawer'), st = dr.querySelector('.db') ? dr.querySelector('.db').scrollTop : 0;
    dr.innerHTML = h;
    dr.querySelectorAll('textarea').forEach(autoH);
    if (dr.querySelector('.db')) dr.querySelector('.db').scrollTop = st;
  }
  function evText(e) {
    const L = [e.title, `${fmtDW(e.date)} · ${TYPES[e.type].l}${e.format !== 'none' ? ' · ' + FORMATS[e.format] : ''}${e.time ? ' · ' + e.time : ''}`];
    if (e.goal) L.push('Зачем: ' + e.goal); if (e.idea) L.push('Идея: ' + e.idea);
    if (e.prep.length) L.push('Подготовить:\n' + e.prep.map(s => '— ' + s.t).join('\n'));
    if (e.shots.length) L.push('Раскадровка:\n' + e.shots.map((s, i) => `${i + 1}. ${s.frame}${s.angle ? ' (' + s.angle + ')' : ''}${s.sec ? ', ' + s.sec + ' сек' : ''}${s.onscreen ? '\n   Текст: ' + s.onscreen : ''}${s.voice ? '\n   Говорим: ' + s.voice : ''}`).join('\n'));
    if (e.voice) L.push('Слова:\n' + e.voice); if (e.music) L.push('Музыка: ' + e.music); if (e.edit) L.push('Монтаж: ' + e.edit);
    if (e.caption) L.push('Подпись:\n' + e.caption + (e.hashtags ? '\n\n' + e.hashtags : ''));
    if (e.steps.length) L.push('Шаги:\n' + e.steps.map((s, i) => (i + 1) + '. ' + s.t).join('\n'));
    if (e.notes) L.push(e.notes);
    return L.join('\n\n');
  }

  /* ---------- быстрое создание события ---------- */
  function newEventDialog(date, preset) {
    const p = preset || {};
    $('dlg').className = 'dlg';
    $('dlg').innerHTML = `<form id="new-form"><h2>Новое событие</h2>
      <label class="field">Что делаем<input class="inp" name="title" required value="${E(p.title || '')}" placeholder="Reels: поклейка логотипа на заднее стекло"></label>
      <div class="two"><label class="field">Дата<input class="inp" type="date" name="date" value="${E(date || today())}" required></label>
      <label class="field">Тип<select class="inp" name="type">${Object.entries(TYPES).map(([k, x]) => `<option value="${k}"${k === (p.type || 'content') ? ' selected' : ''}>${x.l}</option>`).join('')}</select></label></div>
      <label class="field">Идея или пожелания (по желанию)<textarea class="inp" name="idea" rows="3" placeholder="Что важно учесть — ИИ распишет по этому">${E(p.idea || '')}</textarea></label>
      <label class="row" style="font:600 14px var(--f)"><input type="checkbox" name="ai" checked style="width:20px;height:20px;accent-color:var(--blue)"> Сразу расписать с ИИ</label>
      <div class="ft"><button class="btn soft" type="button" data-dlgx>Отмена</button><button class="btn pri" type="submit">Создать</button></div></form>`;
    $('dlg').showModal(); setTimeout(() => $('dlg').querySelector('[name=title]').focus(), 30);
  }

  /* ---------- планирование с агентами ---------- */
  let W = null;
  function planDialog(source) {
    const t = today(), mon = (() => { const d = dobj(t); const dd = (8 - d.getDay()) % 7 || 7; return addDays(t, dd); })();
    W = { step: 'setup', source: source || '', start: source ? t : mon, days: 7, perWeek: 4, focus: new Set(['vinyl', 'dtf', 'sign3d']), wishes: '', sales: true, rows: [], err: '' };
    drawPlan(); $('dlg').showModal();
  }
  function drawPlan() {
    const d = $('dlg'); d.className = 'dlg wide';
    if (W.step === 'setup') {
      d.innerHTML = `<form id="plan-form"><h2>Спланировать с агентами</h2>
        ${W.source ? `<div class="note">Агенты разложат по дням план из ответа в чате и перенесут из него сценарии и тексты.</div>` : `<p class="muted" style="margin:0">Агенты составят список событий, вы его проверите, а потом каждое событие распишется отдельно: что снимать, раскадровка, слова, музыка, подпись.</p>`}
        <div class="two"><label class="field">С какого числа<input class="inp" type="date" name="start" value="${W.start}"></label>
        <label class="field">На какой срок<select class="inp" name="days">${[[7, 'Неделя'], [14, '2 недели'], [30, 'Месяц']].map(([v, l]) => `<option value="${v}"${v === W.days ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
        ${W.source ? '' : `<div class="two"><label class="field">Публикаций в неделю<select class="inp" name="perWeek">${[2, 3, 4, 5, 6, 7].map(v => `<option${v === W.perWeek ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field">Продажи<span class="row" style="min-height:44px"><label class="row" style="font:600 14px var(--f);color:var(--ink)"><input type="checkbox" name="sales" ${W.sales ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--blue)"> Добавить задачи на поиск клиентов</label></span></label></div>
        <div class="field">На чём фокус<div class="ckl">${Object.entries(SVCS).map(([k, l]) => `<label><input type="checkbox" name="focus" value="${k}" ${W.focus.has(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>`}
        <label class="field">Что ещё учесть<textarea class="inp" name="wishes" rows="3" placeholder="Например: в пятницу запускаем акцию на таблички, снимать можем только по вечерам">${E(W.wishes)}</textarea></label>
        ${W.err ? `<div class="err">${E(W.err)}</div>` : ''}
        <div class="ft"><button class="btn soft" type="button" data-dlgx>Отмена</button><button class="btn pri" type="submit" ${W.busy ? 'disabled' : ''}>${W.busy ? '<span class="spin"><i></i><i></i><i></i></span> Составляем список…' : 'Составить список'}</button></div></form>`;
    } else if (W.step === 'list') {
      const n = W.rows.filter(r => r.on).length;
      d.innerHTML = `<form id="plan-form"><h2>Проверьте список</h2><p class="muted" style="margin:0">Снимите галочки с лишнего, поправьте даты и названия. После «Добавить» каждое событие распишется подробно — это идёт в фоне, сайт можно не закрывать и работать дальше.</p>
        <div class="plist">${W.rows.map((r, i) => `<div class="prow"><input type="checkbox" data-pr="${i}:on" ${r.on ? 'checked' : ''} aria-label="Добавлять"><input class="inp" type="date" data-pr="${i}:date" value="${E(r.date)}"><input class="inp" data-pr="${i}:title" value="${E(r.title)}" title="${E(r.idea)}"><select class="inp tp" data-pr="${i}:type">${Object.entries(TYPES).map(([k, x]) => `<option value="${k}"${k === r.type ? ' selected' : ''}>${x.l}</option>`).join('')}</select><select class="inp fm" data-pr="${i}:format">${Object.entries(FORMATS).map(([k, l]) => `<option value="${k}"${k === r.format ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`).join('')}</div>
        <div class="ft"><button class="btn soft" type="button" data-planback>Назад</button><button class="btn pri" type="submit" ${n ? '' : 'disabled'}>Добавить ${n} и расписать</button></div></form>`;
    }
  }
  async function planList() {
    const f = $('plan-form'), fd = new FormData(f);
    W.start = fd.get('start') || today(); W.days = +fd.get('days') || 7; W.wishes = String(fd.get('wishes') || '').trim();
    if (!W.source) { W.perWeek = +fd.get('perWeek') || 4; W.sales = fd.get('sales') === 'on'; W.focus = new Set(fd.getAll('focus')); }
    const end = addDays(W.start, W.days - 1);
    W.busy = true; W.err = ''; drawPlan();
    const all = igAll(), cov = coverage(all).map(c => `${c.l}: ${c.n} постов${c.last ? ', последний ' + c.last : ', не было'}`).join('; ');
    const msg = `Период: с ${W.start} (${WD[dobj(W.start).getDay()]}) по ${end}.\n` + (W.source
      ? `Разложи по дням этот план. Если в нём нет конкретных дат — распредели внутри периода.\n\n## Исходный план и переписка\n${W.source}`
      : `Публикаций в неделю: ${W.perWeek}. Фокус: ${[...W.focus].map(k => SVCS[k]).join(', ') || 'все услуги'}.\n${W.sales ? 'Добавь задачи на продажи и поиск клиентов (2–3 в неделю) и итоги недели в конце каждой недели.' : 'Только контент.'}\nInstagram сейчас: ${cov}. Делай упор на то, чего не хватает.`) +
      (W.wishes ? `\n\nПожелания владельца: ${W.wishes}` : '');
    try {
      const j = await genJSON({ system: system('planner', { short: true }), messages: [{ role: 'user', text: msg }], schema: SCHEMA_PLAN, maxTokens: W.source ? 16000 : 8192, temperature: 0.6 });
      const rows = (j.events || []).filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.title).slice(0, 40).map(e => ({ on: true, date: e.date, title: String(e.title).slice(0, 140), type: TYPES[e.type] ? e.type : e.type === 'growth' ? 'strategy' : 'content', format: FORMATS[e.format] ? e.format : (e.type === 'content' ? 'reels' : 'none'), idea: String(e.idea || ''), src: String(e.src || '') }));
      if (!rows.length) throw new Error('Агенты не прислали ни одного события. Попробуйте ещё раз.');
      rows.sort((a, b) => a.date.localeCompare(b.date));
      W.rows = rows; W.step = 'list';
    } catch (e) { W.err = e.message; }
    W.busy = false; drawPlan();
  }
  async function planCommit() {
    const rows = W.rows.filter(r => r.on); if (!rows.length) return;
    const b = $('plan-form').querySelector('[type=submit]'); b.disabled = true; b.textContent = 'Добавляем…';
    const ids = [];
    try { for (const r of rows) ids.push(await createEv({ title: r.title, date: r.date, type: r.type, format: r.format, idea: r.idea, src: r.src, aiState: 'pending' })); }
    catch (_) { toast('Не всё сохранилось. Проверьте интернет.'); }
    $('dlg').close(); W = null;
    state.view = 'cal'; state.calYM = rows[0].date.slice(0, 7); remember(); render();
    toast('Добавлено ' + ids.length + '. Расписываем по одному — это займёт пару минут.', 4000);
    enqueue(ids);
  }

  /* ---------- агенты ---------- */
  /* ---------- отдел маркетинга на автопилоте ---------- */
  function vDept() {
    const runs = of('run').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), r = runs.find(x => x.id === state.runId) || runs[0];
    const st = state.status || {}, fresh = r && r.status === 'working' && Date.now() - (r.updatedAt || r.createdAt || 0) < 4 * 60e3, working = state.deptBusy || fresh;
    let h = `<div class="row" style="margin-bottom:14px"><div><h1 class="h1">Отдел маркетинга</h1><p class="sub">${st.deptVer ? `Сервер отдела: версия ${st.deptVer}. ` : ''}Каждый понедельник в 08:00 агенты сами смотрят продажи и тренды, собирают план на неделю и расписывают ролики: 5 хуков и 3 варианта съёмки. Можно запустить и вручную.</p></div><span class="sp"></span><button class="btn pri" type="button" data-runnow ${working ? 'disabled' : ''}>${working ? 'Агенты работают…' : 'Запустить отдел сейчас'}</button></div>`;
    if (st.ok && (st.deptVer || 0) < DEPT_NEED) h += `<div class="note" style="margin-bottom:14px"><b>В Cloudflare старый код отдела</b> (версия ${st.deptVer || 1}, нужна ${DEPT_NEED}). Cloudflare → воркер raz-marketing → Edit code: выделите всё, вставьте код из файла marketing-worker/worker.js и нажмите Deploy, затем обновите эту страницу.</div>`;
    else if (st.dept && !st.deptAuto) h += '<div class="note" style="margin-bottom:14px"><b>Автозапуск по понедельникам пока выключен.</b> Кнопка работает уже сейчас. Чтобы отдел работал сам, в Cloudflare у воркера raz-marketing задайте секреты AGENT_EMAIL и AGENT_PASSWORD и расписание (см. README).</div>';
    if (!r) h += '<div class="empty"><b>Отдел ещё не запускался</b>Нажмите «Запустить отдел сейчас» — через 3–6 минут здесь появятся сводка недели, идеи и ролики в календаре.</div>';
    else {
      if (runs.length > 1) h += '<div class="row" style="margin-bottom:12px">' + runs.slice(0, 8).map(x => `<button type="button" class="chip" data-run="${E(x.id)}" style="${x === r ? 'background:var(--ink);color:#fff' : ''}">${fmtD(x.date)}${x.status === 'error' ? ' · ошибка' : ''}</button>`).join('') + '</div>';
      if (r.status === 'working' && working) h += `<div class="note" style="margin-bottom:14px"><b>Работаем:</b> ${E(r.stage || '')}. Обычно это 3–6 минут. Не закрывайте страницу: если закроете, запуск можно будет продолжить.${r.lastError ? '<br><small>Последний сбой, повторяем: ' + E(r.lastError) + '</small>' : ''}</div>`;
      else if (r.status === 'working') h += `<div class="note" style="margin-bottom:14px"><b>Запуск прервался</b> на шаге «${E(r.stage || '')}».${r.lastError ? ' ' + E(r.lastError) : ''}<div class="row" style="margin-top:8px"><button class="btn pri sm" type="button" data-runresume="${E(r.id)}">Продолжить с этого шага</button><button class="btn soft sm" type="button" data-runabort="${E(r.id)}">Отменить запуск</button></div></div>`;
      if (r.status === 'error') h += `<div class="note" style="margin-bottom:14px"><b>Отдел остановился:</b> ${E(r.error || '')}</div>`;
      const evL = (r.eventIds || []).map(evById).filter(Boolean);
      if (evL.length) h += `<h2 class="h2" style="margin:6px 0 10px">Ролики на неделю</h2><div class="list" style="margin-bottom:18px">${evL.map(e => `<button type="button" class="lcard" style="--c:var(${TYPES[e.type].c})" data-open="${E(e.id)}"><i class="dot"></i><div><b>${E(e.title)}</b><p>${fmtDW(e.date)} · ${FORMATS[e.format] || ''} · ${E(stOf(e)[e.status])} — внутри сценарий, 5 хуков и 3 варианта съёмки</p></div><span class="lnk">Открыть</span></button>`).join('')}</div>`;
      if (r.summary) h += `<h2 class="h2" style="margin:6px 0 10px">Сводка недели</h2><div class="md" style="margin-bottom:18px">${md(r.summary)}</div>`;
      if ((r.ideas || []).length) h += `<h2 class="h2" style="margin:6px 0 10px">Идеи генератора</h2><div class="list" style="margin-bottom:18px">${r.ideas.map(x => `<div class="lcard" style="--c:var(--warn);cursor:default"><i class="dot"></i><div><b>${E(x.title)}</b><p>${E([x.service, x.format].filter(Boolean).join(' · '))}${x.hook ? ' — хук: ' + E(x.hook) : ''}${x.why ? '<br>' + E(x.why) : ''}${x.source && /^https?:/.test(x.source) ? ` <a href="${E(x.source)}" target="_blank" rel="noopener">источник</a>` : ''}</p></div><span></span></div>`).join('')}</div>`;
      if (r.trends) h += `<h2 class="h2" style="margin:6px 0 10px">Тренды, которые нашёл разведчик</h2><div class="md" style="margin-bottom:18px">${md(r.trends)}</div>`;
    }
    const tr = of('trend').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    h += `<h2 class="h2" style="margin:6px 0 4px">Копилка трендов</h2><p class="muted" style="margin:0 0 10px;font-size:14px">Увидели рилс, который зацепил? Вставьте ссылку и пару слов — генератор идей учтёт это в следующий запуск.</p>
      <form class="row" id="trend-form" style="margin-bottom:10px"><input class="inp" name="link" placeholder="Ссылка на рилс или аккаунт" style="flex:1;min-width:200px"><input class="inp" name="note" placeholder="Чем зацепило" style="flex:1;min-width:200px"><button class="btn pri sm" type="submit">Сохранить</button></form>`;
    h += tr.length ? '<div class="list">' + tr.slice(0, 30).map(x => `<div class="lcard" style="--c:var(--violet);cursor:default"><i class="dot"></i><div><b>${x.link && /^https?:/.test(x.link) ? `<a href="${E(x.link)}" target="_blank" rel="noopener">${E(x.link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a>` : E(x.link || 'без ссылки')}</b><p>${E(x.note || '')}${x.by ? ' · ' + E(x.by) : ''} · ${fmtT(x.createdAt)}</p></div><button class="lnk del" type="button" data-trdel="${E(x.id)}">Удалить</button></div>`).join('') + '</div>' : '';
    return h;
  }
  async function deptCall(body) {
    let res;
    try { res = await fetch(API + '/api/department', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await auth.currentUser.getIdToken() }, body: JSON.stringify(body) }); }
    catch (_) { throw new Error('Нет связи с сервером ИИ'); }
    const j = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error('Сервер ИИ старой версии: обновите код воркера в Cloudflare (файл marketing-worker/worker.js).');
    if (!res.ok) throw new Error(j.error || 'Сервер ответил ' + res.status);
    return j;
  }
  // отдел работает по шагам: сайт вызывает следующий шаг, пока запуск не закончится; сбойный шаг повторяется
  async function runDept(resumeId) {
    const runs = of('run').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), last = runs[0];
    if (!resumeId && last && last.status === 'done' && last.date === today() && !confirm('Отдел сегодня уже составил план. Запустить ещё раз? В календарь добавятся новые ролики.')) return;
    state.deptBusy = true; state.runId = resumeId || ''; render();
    try {
      let j = resumeId ? { runId: resumeId, done: false } : await deptCall({});
      const runId = j.runId; let fails = 0;
      while (!j.done) {
        try { j = await deptCall({ runId }); fails = 0; }
        catch (e) {
          if (/старой версии/.test(e.message) || ++fails > 2) { await deptCall({ runId, abort: e.message }).catch(() => {}); throw e; }
          toast('Сбой, повторяем шаг через 20 секунд: ' + e.message, 5000); await sleep(20000);
        }
      }
      if (j.status === 'error') throw new Error(j.error || 'Отдел остановился');
      toast(`Готово: ${j.events} ${plural(j.events, 'ролик', 'ролика', 'роликов')} в календаре и ${j.ideas} идей`, 4000);
    } catch (e) { toast(e.message || 'Не получилось', 6000); }
    finally { state.deptBusy = false; render(); }
  }

  function vAgents() {
    const R = ROLES[state.role], mine = state.threads.filter(t => t.role === state.role), th = state.chatBusy ? state.chatBusy.thread : state.threads.find(t => t.id === state.thread && t.role === state.role);
    let h = `<div class="row" style="margin-bottom:14px"><div><h1 class="h1">Агенты</h1><p class="sub">Спросите совета, а готовый план одной кнопкой разложите в календарь — каждое событие распишется подробно.</p></div></div>
      <div class="ag"><div><div class="roles">${Object.entries(ROLES).map(([k, r]) => `<button type="button" class="role" data-role="${k}" aria-pressed="${k === state.role}" style="--c:var(${r.c})"><span class="ava">${r.ini}</span><span><b>${r.name}</b><small>${r.sub}</small></span></button>`).join('')}</div>
      <div class="threads"><h4>Разговоры</h4><button type="button" class="th" data-thread="" ${!state.thread ? 'aria-current="true"' : ''}><span>+ Новый разговор</span></button>${mine.map(t => `<button type="button" class="th" data-thread="${E(t.id)}" ${t.id === state.thread ? 'aria-current="true"' : ''}><span>${E(t.title)}</span><em>${fmtT(t.updatedAt)}</em></button>`).join('')}</div></div>
      <div class="chat"><div class="msgs">`;
    if (!th || !th.messages.length) h += `<div class="bub" style="background:var(--paper);border-radius:18px;padding:16px;color:var(--muted)"><b style="color:var(--ink)">${R.name}</b> — ${R.sub}. ${R.team ? 'Аналитик, маркетолог и SMM-менеджер отвечают по очереди и дополняют друг друга.' : 'Видит прайс, продажи, Instagram, справочник и календарь.'}</div>`;
    else h += th.messages.map((m, i) => m.role === 'user' ? `<div class="msg me"><div class="bub">${E(m.text)}</div></div>` : (() => { const r = ROLES[m.agent] || ROLES.marketer; return `<div class="msg"><span class="ava" style="--c:var(${r.c})">${r.ini}</span><div class="bub"><div class="who2">${r.name}<em>${m.at ? fmtT(m.at) : ''}</em></div><div class="md">${md(m.text)}</div>${state.chatBusy ? '' : `<div class="acts"><button class="lnk" type="button" data-tocal="${i}">Разложить в календарь</button><button class="lnk" type="button" data-cpm="${i}">Копировать</button></div>`}</div></div>`; })()).join('');
    if (state.chatBusy) { const r = ROLES[state.chatBusy.step]; h += `<div class="msg"><span class="ava" style="--c:var(${r.c})">${r.ini}</span><div class="bub muted"><span class="spin"><i></i><i></i><i></i></span> ${r.name} думает…</div></div>`; }
    if (state.chatErr) h += `<div class="err">${E(state.chatErr)}</div>`;
    h += `</div>${!th || !th.messages.length ? `<div class="quick">${R.quick.map(q => `<button type="button" data-q="${E(q)}">${E(q)}</button>`).join('')}</div>` : ''}
      <form class="compose" id="chat-form"><textarea class="inp" id="c-in" rows="2" placeholder="Задача для: ${E(R.name.toLowerCase())}… (Ctrl+Enter — отправить)"></textarea><button class="btn pri" type="submit" ${state.chatBusy ? 'disabled' : ''}>Отправить</button></form></div></div>`;
    return h;
  }
  async function sendChat(text) {
    text = String(text || '').trim(); if (!text || state.chatBusy) return;
    state.chatErr = '';
    const role = state.role, R = ROLES[role];
    let t = state.threads.find(x => x.id === state.thread && x.role === role);
    t = t ? { ...t, messages: [...t.messages] } : { role, title: text.slice(0, 70), messages: [], createdAt: Date.now() };
    t.messages.push({ role: 'user', text, at: Date.now(), by: me() });
    const steps = R.team ? ['analyst', 'marketer', 'smm'] : [role];
    state.chatBusy = { thread: t, step: steps[0] }; render(); if ($('c-in')) $('c-in').value = '';
    const save = async () => { const d = { role: t.role, title: t.title, messages: t.messages.slice(-60), updatedAt: Date.now(), createdAt: t.createdAt, by: me() }; if (!t.id) { const r = col.doc(); t.id = r.id; } await col.doc(t.id).set(d); state.thread = t.id; };
    try {
      await save();
      const done = [];
      for (const s of steps) {
        state.chatBusy = { thread: t, step: s }; render();
        let msgs;
        if (R.team) msgs = [{ role: 'user', text: `Планёрка. Задача от владельца:\n${text}` + (done.length ? `\n\nКоллеги уже ответили — опирайся на них, не повторяй, дополни своей частью:\n\n${done.map(d => '### ' + ROLES[d.r].name + '\n' + d.t).join('\n\n')}` : '\n\nТы отвечаешь первым.') + (s === 'smm' ? '\n\nТы последний: переведи всё в контент и дай общий план на 2 недели с конкретными датами.' : '') }];
        else msgs = t.messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text }));
        const r = await gen({ system: system(s), messages: msgs, maxTokens: 8192, temperature: 0.8 });
        t.messages.push({ role: 'assistant', agent: s, text: r.text, at: Date.now() }); done.push({ r: s, t: r.text });
        await save();
      }
    } catch (e) { state.chatErr = e.message; }
    state.chatBusy = null; render();
    const m = document.querySelector('.msgs'); if (m && m.lastElementChild) m.lastElementChild.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- Instagram ---------- */
  function autoSyncIG() { if (!state.igAuto && state.status && state.status.instagram && (!state.ig || !state.ig.syncedAt || Date.now() - state.ig.syncedAt > 6 * 36e5)) { state.igAuto = true; syncIG(true); } }
  async function syncIG(quiet) {
    if (state.igSyncing) return; state.igSyncing = true; if (!quiet) render();
    try {
      const res = await fetch(API + '/api/instagram', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await auth.currentUser.getIdToken() }, body: '{}' });
      const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.error || 'Сервер ответил ' + res.status);
      await col.doc('ig').set({ ...(state.ig || {}), profile: j.profile, posts: j.posts.slice(0, 200), syncedAt: Date.now() });
      if (!quiet) toast('Instagram обновлён: ' + j.posts.length + ' публикаций');
    } catch (e) { if (!quiet) toast(e.message, 4000); }
    state.igSyncing = false; if (state.view === 'ig') render();
  }
  function vIG() {
    const all = igAll(), p = state.ig && state.ig.profile, on = state.status && state.status.instagram;
    let h = `<div class="row" style="margin-bottom:14px"><div><h1 class="h1">Instagram</h1><p class="sub">Что уже опубликовано и чего не хватает. Агенты видят это, когда планируют.</p></div><span class="sp"></span><button class="btn soft sm" type="button" data-igadd>Добавить пост вручную</button></div>
      <div class="igp">${p && p.avatar ? `<img class="av" src="${E(p.avatar)}" alt="" referrerpolicy="no-referrer">` : '<span class="av">RAZ</span>'}<div style="flex:1;min-width:160px"><b>@${E((p && p.username) || 'raz.brandstudio')}</b><span class="muted" style="font-size:13px">${p ? [p.followers != null ? p.followers.toLocaleString('ru-RU') + ' подписчиков' : '', p.media != null ? p.media + ' публикаций' : ''].filter(Boolean).join(' · ') : 'Ещё не загружен'}${state.ig && state.ig.syncedAt ? ' · обновлено ' + fmtT(state.ig.syncedAt) : ''}</span></div>
      ${on ? `<button class="btn soft sm" type="button" data-igsync ${state.igSyncing ? 'disabled' : ''}>${state.igSyncing ? 'Обновляем…' : 'Обновить из Instagram'}</button>` : state.status ? '<span class="muted" style="font-size:13px">Автоподключение не настроено</span>' : ''}</div>`;
    if (!all.length) return h + '<div class="empty"><b>Публикаций пока нет</b>Нажмите «Обновить из Instagram» или добавьте посты вручную.</div>';
    const m30 = all.filter(x => daysAgo(x.date) <= 30).length, last = all[0], liked = all.filter(x => x.likes != null).slice(0, 30);
    h += `<div class="kpis"><div class="kpi"><span>За 30 дней</span><b class="${m30 < 8 ? 'down' : ''}">${m30}</b><small>${m30 < 8 ? 'мало: цель 3–4 в неделю' : 'хороший ритм'}</small></div>
      <div class="kpi"><span>Последняя публикация</span><b class="${daysAgo(last.date) > 7 ? 'down' : ''}">${daysAgo(last.date) === 0 ? 'сегодня' : daysAgo(last.date) + ' дн. назад'}</b><small>${fmtD(last.date)}</small></div>
      <div class="kpi"><span>Reels / фото / карусели</span><b>${['reels', 'photo', 'carousel'].map(k => all.filter(x => x.type === k).length).join(' / ')}</b><small>всего ${all.length}</small></div>
      <div class="kpi"><span>Средние лайки</span><b>${liked.length ? Math.round(liked.reduce((s, x) => s + (+x.likes || 0), 0) / liked.length) : '—'}</b><small>по последним ${liked.length}</small></div></div>`;
    h += `<div class="cov"><b style="font:800 17px var(--f)">Что есть и чего нет</b>${coverage(all).map(c => { const d = daysAgo(c.last), s = !c.n ? ['ни одного поста', '--danger'] : d > 30 ? ['давно: ' + d + ' дн.', '--warn'] : ['последний ' + fmtD(c.last), '--ok']; return `<div class="covr"><i class="dot" style="--c:var(${s[1]})"></i><b>${c.l}</b><small>${c.n} ${plural(c.n, 'пост', 'поста', 'постов')} · ${s[0]}</small><button class="lnk" type="button" data-igplan="${c.k}">Запланировать</button></div>`; }).join('')}</div>`;
    h += '<div class="igrid">' + all.slice(0, 120).map(x => `<div class="igc"><div class="igi">${x.thumb ? `<img src="${E(x.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span>${E({ reels: 'Reels', photo: 'Фото', carousel: 'Карусель', story: 'Сторис' }[x.type] || 'Пост')}</span></div><div class="igt"><small>${fmtD(x.date)}${x.likes != null ? ' · ❤ ' + x.likes : ''}${x.comments != null ? ' · 💬 ' + x.comments : ''}${x.src === 'manual' ? ' · вручную' : ''}</small><p>${E((x.caption || 'Без подписи').slice(0, 220))}</p><div class="row">${x.link ? `<a class="lnk" href="${E(x.link)}" target="_blank" rel="noopener">Открыть</a>` : ''}${x.src === 'manual' ? `<button class="lnk" type="button" data-edit="igpost:${E(x.id)}">Изменить</button>` : ''}</div></div></div>`).join('') + '</div>';
    return h;
  }

  /* ---------- справочник ---------- */
  const FORMS = {
    competitor: { h: 'Конкурент', f: [['name', 'Название *'], ['services', 'Что делают'], ['link', 'Instagram, 2ГИС или сайт'], ['prices', 'Цены, которые знаем', 1], ['strong', 'Сильные стороны', 1], ['weak', 'Слабые места', 1], ['notes', 'Заметки', 1]] },
    offer: { h: 'Оффер', f: [['title', 'Название *'], ['status', 'Статус', 0, { active: 'Действует', draft: 'Черновик', archive: 'В архиве' }], ['audience', 'Для кого'], ['includes', 'Что входит', 1], ['price', 'Цена'], ['until', 'Действует до', 'date']] },
    idea: { h: 'Идея', f: [['title', 'Идея *'], ['status', 'Статус', 0, { new: 'Новая', work: 'В работе', done: 'Сделано', drop: 'Отложили' }], ['notes', 'Подробности', 1]] },
    igpost: { h: 'Пост в Instagram', f: [['date', 'Дата *', 'date'], ['type', 'Формат', 0, { reels: 'Reels', photo: 'Фото', carousel: 'Карусель', story: 'Сторис' }], ['caption', 'Тема или подпись *', 1], ['link', 'Ссылка'], ['likes', 'Лайки', 'number'], ['comments', 'Комментарии', 'number']] }
  };
  function editDialog(kind, id, preset) {
    const F = FORMS[kind], x = { ...((id && state.items.find(i => i.id === id)) || {}), ...(preset || {}) };
    $('dlg').className = 'dlg';
    $('dlg').innerHTML = `<form id="edit-form" data-kind="${kind}" data-id="${E(id || '')}"><h2>${id ? '' : 'Новое: '}${F.h.toLowerCase()}</h2>${F.f.map(([k, l, t, opts]) => opts ? `<label class="field">${E(l)}<select class="inp" name="${k}">${Object.entries(opts).map(([o, ol]) => `<option value="${o}"${o === (x[k] || Object.keys(opts)[0]) ? ' selected' : ''}>${ol}</option>`).join('')}</select></label>`
      : t === 1 ? `<label class="field">${E(l)}<textarea class="inp" name="${k}" rows="3">${E(x[k])}</textarea></label>` : `<label class="field">${E(l)}<input class="inp" name="${k}" type="${typeof t === 'string' ? t : 'text'}" value="${E(x[k] ?? '')}"></label>`).join('')}
      <div class="err" id="ef-err"></div><div class="ft">${id ? '<button class="btn ghost" type="button" data-efdel>Удалить</button>' : ''}<button class="btn soft" type="button" data-dlgx>Отмена</button><button class="btn pri" type="submit">Сохранить</button></div></form>`;
    $('dlg').showModal();
  }
  async function saveEdit(f) {
    const kind = f.dataset.kind, id = f.dataset.id, F = FORMS[kind], fd = new FormData(f), d = {};
    F.f.forEach(([k, , t]) => d[k] = t === 'number' ? (+fd.get(k) || 0) : String(fd.get(k) || '').trim());
    const req = F.f.find(([k, l]) => l.endsWith('*') && !d[k]); if (req) { $('ef-err').textContent = 'Заполните «' + req[1].replace(' *', '') + '»'; return; }
    const old = (id && state.items.find(i => i.id === id)) || {};
    const { id: _, ...rest } = old;
    try { await (id ? col.doc(id) : col.doc()).set({ ...rest, ...d, kind, updatedAt: Date.now(), createdAt: old.createdAt || Date.now(), by: old.by || me() }); $('dlg').close(); toast('Сохранено'); }
    catch (_) { $('ef-err').textContent = 'Не сохранилось.'; }
  }
  function vBase() {
    const tabs = [['about', 'О студии'], ['comp', 'Конкуренты'], ['offers', 'Офферы'], ['ideas', 'Идеи'], ['agents', 'Агенты']];
    let h = `<h1 class="h1">Справочник</h1><p class="sub">Всё, что агенты знают о студии. Правьте под себя — они сразу начнут это учитывать.</p>
      <div class="tabs2">${tabs.map(([k, l]) => `<button type="button" class="chip" data-btab="${k}" style="${state.baseTab === k ? 'background:var(--ink);color:#fff' : ''}">${l}</button>`).join('')}</div>`;
    const t = state.baseTab;
    if (t === 'about') {
      const a = state.about || {};
      h += `<form id="about-form" class="about">${ABOUT.map(([k, l, ph]) => `<label class="field">${l}<textarea class="inp" name="${k}" rows="${['services', 'notes', 'shooting'].includes(k) ? 4 : 2}" placeholder="${E(ph)}">${E(a[k] != null ? a[k] : (k === 'notes' ? state.aboutBrief || '' : ''))}</textarea></label>`).join('')}
        <div class="row" style="grid-column:1/-1"><span class="muted" style="font-size:13px">${a.updatedAt ? 'Обновлено ' + fmtT(a.updatedAt) : ''}</span><span class="sp"></span><button class="btn pri" type="submit">Сохранить</button></div></form>`;
    } else if (t === 'comp') {
      const L = of('competitor').sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
      h += `<div class="row" style="margin-bottom:12px"><button class="btn pri sm" type="button" data-add="competitor">+ Конкурент</button>${L.length ? '<button class="btn out sm" type="button" data-ask="analyst" data-q="Сравни нас со всеми конкурентами из справочника: таблица, где мы сильнее, где слабее, и 3 возможности.">Разобрать с аналитиком</button>' : ''}</div>`;
      h += L.length ? '<div class="cards">' + L.map(c => `<div class="icard"><h3>${E(c.name)}</h3><dl>${[['services', 'Что делают'], ['link', 'Где смотреть'], ['prices', 'Цены'], ['strong', 'Сильные стороны'], ['weak', 'Слабые места'], ['notes', 'Заметки']].filter(([k]) => c[k]).map(([k, l]) => `<div><dt>${l}</dt><dd>${k === 'link' && /^https?:/.test(c[k]) ? `<a href="${E(c[k])}" target="_blank" rel="noopener">${E(c[k])}</a>` : E(c[k])}</dd></div>`).join('')}</dl><div class="acts"><button class="lnk" type="button" data-edit="competitor:${E(c.id)}">Изменить</button></div></div>`).join('') + '</div>' : '<div class="empty"><b>Конкурентов пока нет</b>Добавьте 3–5 студий из 2ГИС и Instagram с ценами.</div>';
    } else if (t === 'offers') {
      const L = of('offer').sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1));
      h += `<div class="row" style="margin-bottom:12px"><button class="btn pri sm" type="button" data-add="offer">+ Оффер</button></div>`;
      h += L.length ? '<div class="cards">' + L.map(o => `<div class="icard"><span class="muted" style="font:600 12px var(--f)">${{ active: 'Действует', draft: 'Черновик', archive: 'В архиве' }[o.status] || 'Черновик'}${o.until ? ' · до ' + fmtD(o.until) : ''}</span><h3>${E(o.title)}</h3><dl>${[['audience', 'Для кого'], ['includes', 'Что входит'], ['price', 'Цена']].filter(([k]) => o[k]).map(([k, l]) => `<div><dt>${l}</dt><dd>${E(o[k])}</dd></div>`).join('')}</dl><div class="acts"><button class="lnk" type="button" data-evfrom="offer:${E(o.id)}">В календарь</button><button class="lnk" type="button" data-edit="offer:${E(o.id)}">Изменить</button></div></div>`).join('') + '</div>' : '<div class="empty"><b>Офферов пока нет</b>Оффер — готовое предложение: «набор табличек для кофейни за 25 000 ₸».</div>';
    } else if (t === 'ideas') {
      const L = of('idea').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      h += `<form class="row" id="idea-form" style="margin-bottom:12px"><input class="inp" name="t" placeholder="Новая идея — Enter, чтобы добавить" style="flex:1;min-width:220px"><button class="btn pri sm" type="submit">Добавить</button></form>`;
      h += L.length ? '<div class="list">' + L.map(x => `<div class="lcard" style="--c:var(--warn);cursor:default"><i class="dot"></i><div><b>${E(x.title)}</b><p>${E({ new: 'Новая', work: 'В работе', done: 'Сделано', drop: 'Отложили' }[x.status] || 'Новая')}${x.notes ? ' — ' + E(String(x.notes).slice(0, 200)) : ''}</p></div><span class="row"><button class="lnk" type="button" data-evfrom="idea:${E(x.id)}">В календарь</button><button class="lnk" type="button" data-edit="idea:${E(x.id)}">Изменить</button></span></div>`).join('') + '</div>' : '<div class="empty"><b>Идей пока нет</b>Записывайте всё, что приходит в голову.</div>';
    } else {
      const keys = [['base', 'Общее для всех: кто мы и правила'], ['producer', 'Продюсер: как расписывать события календаря'], ['planner', 'Планировщик: как составлять список событий'], ['marketer', 'Маркетолог'], ['smm', 'SMM-менеджер'], ['analyst', 'Аналитик'], ['designer', 'Дизайнер креативов']];
      h += `<p class="muted">Это инструкции, по которым работают агенты. Меняйте под себя: например, допишите продюсеру «всегда предлагай 2 варианта хука» или «музыку подбирай только трендовую». Изменения действуют сразу.</p>
        <form id="agents-form" style="display:flex;flex-direction:column;gap:14px">${keys.map(([k, l]) => `<label class="field">${l}${state.agents[k] ? ' · <span style="color:var(--blue)">изменено</span>' : ''}<textarea class="inp" name="${k}" rows="6">${E(prompt(k))}</textarea>${state.agents[k] ? `<button class="lnk" type="button" data-reset="${k}" style="align-self:flex-start">Вернуть как было</button>` : ''}</label>`).join('')}
        <div class="row"><span class="sp"></span><button class="btn pri" type="submit">Сохранить инструкции</button></div></form>`;
    }
    return h;
  }

  /* ---------- креативы ---------- */
  const C = () => window.RAZCreative;
  function vCrt() {
    if (!C()) return '<div class="empty">Модуль креативов не загрузился. Обновите страницу.</div>';
    const s = state.crt;
    let h = `<h1 class="h1">Креативы</h1><p class="sub">ИИ пишет 3 варианта текста и подпись, сайт собирает картинки в фирменном стиле. Скачивайте PNG.</p>
      <form class="card" id="crt-form" style="display:flex;flex-direction:column;gap:12px;margin-top:14px">
        <label class="field">О чём креатив<textarea class="inp" id="crt-topic" rows="3" style="background:var(--paper)" placeholder="Например: наклейка логотипа на заднее стекло за 1 день">${E(s.topic)}</textarea></label>
        <div class="two"><label class="field">Услуга<select class="inp" id="crt-svc" style="background:var(--paper)">${Object.entries(SVCS).map(([k, l]) => `<option value="${k}"${k === s.svc ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="field">Формат<div class="seg" style="background:var(--paper)">${Object.entries(C().FORMATS).map(([k, f]) => `<button type="button" data-cfmt="${k}" aria-pressed="${k === s.format}">${f.l}</button>`).join('')}</div></div></div>
        <div class="row">${s.photoUrl ? `<img src="${s.photoUrl}" alt="" style="width:46px;height:46px;border-radius:12px;object-fit:cover"><button class="lnk del" type="button" data-cphx>Убрать фото</button>` : '<label class="btn soft sm" for="crt-photo" style="background:var(--paper)">Загрузить своё фото</label>'}<input type="file" id="crt-photo" accept="image/*" hidden>
          <label class="row" style="font:600 14px var(--f)"><input type="checkbox" id="crt-ai" ${s.useAI ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--blue)"> Нет фото — нарисовать фон ИИ</label><span class="sp"></span>
          <button class="btn pri" type="submit" ${s.busy ? 'disabled' : ''}>${s.busy ? E(s.busy) : 'Придумать креативы'}</button></div>
        ${s.err ? `<div class="err">${E(s.err)}</div>` : ''}</form>`;
    if (s.variants.length) {
      if (s.caption) h += `<div class="card" style="margin-top:12px"><div class="row"><b style="font:800 17px var(--f)">Подпись к посту</b><span class="sp"></span><button class="copy" type="button" data-ccap>Копировать</button></div><p style="white-space:pre-wrap;margin:8px 0 0">${E(s.caption)}</p></div>`;
      h += `<div class="cgrid" style="margin-top:12px">${s.variants.map((v, i) => `<div class="cc"><div class="cimg ${s.format}">${s.previews[i] ? `<img src="${s.previews[i]}" alt="${E(v.headline)}">` : '<span class="spin"><i></i><i></i><i></i></span>'}</div><div class="row"><button class="lnk" type="button" data-cedit="${i}">Изменить</button><button class="lnk" type="button" data-cdl="${i}">Скачать PNG</button></div></div>`).join('')}</div>`;
    }
    return h;
  }
  async function paintPreviews() {
    const s = state.crt; if (!C() || !s.variants.length) return;
    for (let i = 0; i < s.variants.length; i++) {
      if (s.previews[i]) continue;
      try { s.previews[i] = (await C().render(s.variants[i], { format: s.format, img: s.photo || s.bg })).toDataURL('image/jpeg', .86); } catch (_) { s.previews[i] = ''; }
      const box = document.querySelectorAll('.cimg')[i]; if (box && s.previews[i] && state.view === 'crt') box.innerHTML = `<img src="${s.previews[i]}" alt="">`;
    }
  }
  async function crtGenerate() {
    const s = state.crt; s.topic = ($('crt-topic') || {}).value || s.topic;
    if (!s.topic.trim()) { s.err = 'Напишите, о чём креатив.'; render(); return; }
    s.err = ''; s.busy = 'Придумываем…'; s.variants = []; s.previews = []; render();
    try {
      const j = await genJSON({ system: system('designer', { short: true }), messages: [{ role: 'user', text: `Формат: ${C().FORMATS[s.format].l}. Услуга: ${SVCS[s.svc]}.\nЗадача: ${s.topic}` }], schema: SCHEMA_CRT, maxTokens: 4096, temperature: .9 });
      const tpl = Object.keys(C().TEMPLATES), th = Object.keys(C().THEMES);
      s.variants = (j.variants || []).filter(v => v && v.headline).slice(0, 4).map((v, i) => ({ template: tpl.includes(v.template) ? v.template : tpl[i % tpl.length], theme: th.includes(v.theme) ? v.theme : 'blue', headline: String(v.headline).slice(0, 90), sub: String(v.sub || '').slice(0, 160), bullets: (v.bullets || []).map(String).slice(0, 5), price: String(v.price || '').slice(0, 30), cta: String(v.cta || 'Пиши в Direct').slice(0, 30), badge: String(v.badge || '').slice(0, 20), bg_prompt: String(v.bg_prompt || '') }));
      if (!s.variants.length) throw new Error('Не пришло вариантов. Нажмите ещё раз.');
      s.caption = String(j.caption || '');
      if (!s.photo && s.useAI && state.status && state.status.images) {
        s.busy = 'Рисуем фон…'; render();
        try {
          const res = await fetch(API + '/api/image', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await auth.currentUser.getIdToken() }, body: JSON.stringify({ prompt: s.variants[0].bg_prompt || s.topic }) });
          const jj = await res.json(); if (!res.ok) throw new Error(jj.error); s.bg = await C().loadImg(jj.image);
        } catch (_) { s.bg = null; toast('Фон от ИИ не получился — собрали без фото'); }
      }
    } catch (e) { s.err = e.message; }
    s.busy = ''; render();
  }
  function crtEdit(i) {
    const v = state.crt.variants[i], sel = (n, o, cur) => `<select class="inp" name="${n}">${Object.entries(o).map(([k, x]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${E(x.l || x)}</option>`).join('')}</select>`;
    $('dlg').className = 'dlg wide';
    $('dlg').innerHTML = `<form id="crt-ed" data-i="${i}"><h2>Креатив</h2><div class="two" style="align-items:start"><canvas id="crt-cv" style="width:100%;border-radius:14px;background:var(--tile)"></canvas><div style="display:flex;flex-direction:column;gap:10px">
      <div class="two"><label class="field">Шаблон${sel('template', C().TEMPLATES, v.template)}</label><label class="field">Цвета${sel('theme', C().THEMES, v.theme)}</label></div>
      <label class="field">Заголовок<textarea class="inp" name="headline" rows="2">${E(v.headline)}</textarea></label>
      <label class="field">Подзаголовок<textarea class="inp" name="sub" rows="2">${E(v.sub)}</textarea></label>
      <label class="field">Пункты (каждый с новой строки)<textarea class="inp" name="bullets" rows="3">${E(v.bullets.join('\n'))}</textarea></label>
      <div class="two"><label class="field">Цена<input class="inp" name="price" value="${E(v.price)}"></label><label class="field">Плашка<input class="inp" name="badge" value="${E(v.badge)}"></label></div>
      <label class="field">Призыв<input class="inp" name="cta" value="${E(v.cta)}"></label></div></div>
      <div class="ft"><button class="btn soft" type="button" data-crtdl>Скачать PNG</button><button class="btn pri" type="submit">Готово</button></div></form>`;
    $('dlg').showModal(); crtLive();
  }
  let liveT;
  function crtApply() { const f = $('crt-ed'); if (!f) return; const fd = new FormData(f), v = state.crt.variants[+f.dataset.i]; ['template', 'theme', 'headline', 'sub', 'price', 'badge', 'cta'].forEach(k => v[k] = String(fd.get(k) || '').trim()); v.bullets = String(fd.get('bullets') || '').split('\n').map(x => x.trim()).filter(Boolean); state.crt.previews[+f.dataset.i] = ''; }
  function crtLive() { clearTimeout(liveT); liveT = setTimeout(async () => { const f = $('crt-ed'); if (!f) return; crtApply(); await C().render(state.crt.variants[+f.dataset.i], { format: state.crt.format, img: state.crt.photo || state.crt.bg, canvas: $('crt-cv') }); }, 150); }
  async function crtDownload(i) { const c = await C().render(state.crt.variants[i], { format: state.crt.format, img: state.crt.photo || state.crt.bg }); const b = await C().toBlob(c), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = 'raz-креатив-' + (i + 1) + '.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }

  /* ================= события интерфейса ================= */
  document.addEventListener('click', async ev => {
    const t = ev.target; if (!t.closest) return;
    const g = sel => t.closest(sel);
    let el;
    if (g('#logout')) { auth.signOut(); return; }
    if ((el = g('[data-nav]'))) { state.view = el.dataset.nav; remember(); render(); window.scrollTo(0, 0); return; }
    if (g('[data-dlgx]')) { $('dlg').close(); W = null; return; }
    if (t === $('dlg')) { $('dlg').close(); W = null; return; }
    if (t === $('scrim') || g('[data-dclose]')) { closeDrawer(); return; }
    // календарь
    if ((el = g('[data-open]'))) { openDrawer(el.dataset.open); return; }
    // отдел
    if (g('[data-runnow]')) { runDept(); return; }
    if ((el = g('[data-runresume]'))) { runDept(el.dataset.runresume); return; }
    if ((el = g('[data-runabort]'))) { await col.doc(el.dataset.runabort).set({ status: 'error', stage: '', error: 'Запуск отменён', updatedAt: Date.now() }, { merge: true }); return; }
    if ((el = g('[data-run]'))) { state.runId = el.dataset.run; render(); return; }
    if ((el = g('[data-trdel]'))) { await col.doc(el.dataset.trdel).delete(); return; }
    if ((el = g('[data-new]'))) { newEventDialog(el.dataset.new); return; }
    if (g('[data-plan]')) { planDialog(); return; }
    if ((el = g('[data-cal]'))) {
      const v = +el.dataset.cal;
      if (state.calMode === 'week') { if (!v) state.weekStart = ''; else state.weekStart = addDays(state.weekStart, 7 * v); if (state.weekStart) state.calYM = state.weekStart.slice(0, 7); }
      else { if (!v) state.calYM = today().slice(0, 7); else { const [y, m] = state.calYM.split('-').map(Number); const d = new Date(y, m - 1 + v, 1); state.calYM = d.getFullYear() + '-' + pad(d.getMonth() + 1); } }
      if (!v) state.weekStart = '';
      render(); return;
    }
    if ((el = g('[data-mode]'))) { state.calMode = el.dataset.mode; if (state.calMode === 'week' && !state.weekStart) { const t0 = state.calYM === today().slice(0, 7) ? today() : state.calYM + '-01'; state.weekStart = addDays(t0, -((dobj(t0).getDay() + 6) % 7)); } remember(); render(); return; }
    if ((el = g('[data-weekof]'))) { const d = el.dataset.weekof; state.calMode = 'week'; state.weekStart = addDays(d, -((dobj(d).getDay() + 6) % 7)); render(); return; }
    if ((el = g('[data-type]'))) { const k = el.dataset.type; state.typeOff.has(k) ? state.typeOff.delete(k) : state.typeOff.add(k); render(); return; }
    if ((el = g('.day[data-day]')) && window.innerWidth <= 700) { const d = el.dataset.day; state.calMode = 'week'; state.weekStart = addDays(d, -((dobj(d).getDay() + 6) % 7)); render(); return; }
    // панель события
    if (D && g('#drawer')) {
      const e = D.e;
      if ((el = g('[data-dai]'))) { const mode = el.dataset.dai; if (mode === 'all' && filled(e) && !confirm('Переписать событие заново? То, что вы вписали, заменится.')) return; await flush(); e.aiState = 'pending'; drawDrawer(); detailEvent(D.id, mode).then(() => toast('Событие расписано')).catch(err => toast(err.message, 5000)); return; }
      if (g('[data-dcopy]')) { copy(evText(e), g('[data-dcopy]')); return; }
      if ((el = g('[data-cpf]'))) { copy(e[el.dataset.cpf] || '', el); return; }
      if (g('[data-notes]')) { D.editNotes = !D.editNotes; drawDrawer(); return; }
      if (g('[data-ddel]')) { if (!confirm('Удалить событие?')) return; const id = D.id; D.dirty = false; closeDrawer(); await col.doc(id).delete(); toast('Удалено'); return; }
      if (g('[data-ddup]')) { await flush(); const id = await createEv({ ...packEv(e), title: e.title + ' (копия)', date: addDays(e.date, 7), status: 'plan', aiState: '' }); openDrawer(id); toast('Копия на неделю позже'); return; }
      if (g('[data-dcrt]')) { closeDrawer(); state.crt.topic = e.title + (e.idea ? '. ' + e.idea : ''); state.view = 'crt'; remember(); render(); return; }
      if ((el = g('[data-rm]'))) { const [k, i] = el.dataset.rm.split(':'); e[k].splice(+i, 1); dirty(); drawDrawer(); return; }
      if ((el = g('[data-addbtn]'))) { const inp = $('drawer').querySelector(`[data-addto="${el.dataset.addbtn}"]`); addItem(el.dataset.addbtn, inp); return; }
      if (g('[data-shadd]')) { e.shots.push({ frame: '', angle: '', sec: '', onscreen: '', voice: '' }); if (e.type !== 'content' && e.shots.length === 1) {} dirty(); drawDrawer(); return; }
      if ((el = g('[data-shrm]'))) { e.shots.splice(+el.dataset.shrm, 1); dirty(); drawDrawer(); return; }
      if ((el = g('[data-shup]'))) { const i = +el.dataset.shup; [e.shots[i - 1], e.shots[i]] = [e.shots[i], e.shots[i - 1]]; dirty(); drawDrawer(); return; }
      if ((el = g('[data-shdn]'))) { const i = +el.dataset.shdn; if (i < e.shots.length - 1) { [e.shots[i + 1], e.shots[i]] = [e.shots[i], e.shots[i + 1]]; dirty(); drawDrawer(); } return; }
      return;
    }
    // планирование
    if (g('[data-planback]')) { W.step = 'setup'; drawPlan(); return; }
    // агенты
    if ((el = g('[data-role]'))) { state.role = el.dataset.role; const last = state.threads.find(x => x.role === state.role); state.thread = last ? last.id : null; state.chatErr = ''; remember(); render(); return; }
    if ((el = g('[data-thread]'))) { state.thread = el.dataset.thread || null; state.chatErr = ''; render(); return; }
    if ((el = g('[data-q]')) && state.view === 'agents') { sendChat(el.dataset.q); return; }
    if ((el = g('[data-tocal]')) || (el = g('[data-cpm]'))) {
      const th = state.threads.find(x => x.id === state.thread); if (!th) return;
      const i = +(el.dataset.tocal ?? el.dataset.cpm), m = th.messages[i];
      if (el.dataset.cpm != null) { copy(m.text, el); return; }
      let src = th.messages.slice(0, i + 1).map(x => x.role === 'user' ? '### Задача\n' + x.text : '### ' + (ROLES[x.agent] || ROLES.marketer).name + '\n' + x.text).join('\n\n');
      if (src.length > 50000) src = '…' + src.slice(-50000);
      planDialog(src); return;
    }
    if ((el = g('[data-ask]'))) { state.view = 'agents'; state.role = el.dataset.ask; state.thread = null; remember(); render(); $('c-in').value = el.dataset.q || ''; $('c-in').focus(); return; }
    // instagram
    if (g('[data-igsync]')) { syncIG(false); return; }
    if (g('[data-igadd]')) { editDialog('igpost', null, { date: today(), type: 'reels' }); return; }
    if ((el = g('[data-igplan]'))) { newEventDialog(addDays(today(), 1), { title: 'Пост про «' + SVCS[el.dataset.igplan] + '»', type: 'content', idea: 'В Instagram давно не было публикаций про эту услугу — покажем результат и процесс, позовём заказать.' }); return; }
    // справочник
    if ((el = g('[data-btab]'))) { state.baseTab = el.dataset.btab; render(); return; }
    if ((el = g('[data-add]'))) { editDialog(el.dataset.add); return; }
    if ((el = g('[data-edit]'))) { const [k, id] = el.dataset.edit.split(':'); editDialog(k, id); return; }
    if (g('[data-efdel]')) { const f = $('edit-form'); if (!confirm('Удалить?')) return; await col.doc(f.dataset.id).delete(); $('dlg').close(); toast('Удалено'); return; }
    if ((el = g('[data-evfrom]'))) { const [k, id] = el.dataset.evfrom.split(':'), x = state.items.find(i => i.id === id); if (!x) return; newEventDialog(addDays(today(), 1), k === 'offer' ? { title: 'Запуск оффера: ' + x.title, type: 'offer', idea: [x.audience && 'Для: ' + x.audience, x.includes && 'Входит: ' + x.includes, x.price && 'Цена: ' + x.price].filter(Boolean).join('. ') } : { title: x.title, type: 'idea', idea: x.notes || '' }); return; }
    if ((el = g('[data-reset]'))) { const k = el.dataset.reset; await col.doc('agents').set({ ...state.agents, [k]: '' }); toast('Вернули инструкцию по умолчанию'); return; }
    // креативы
    if ((el = g('[data-cfmt]'))) { state.crt.format = el.dataset.cfmt; state.crt.previews = []; render(); return; }
    if (g('[data-cphx]')) { state.crt.photo = null; state.crt.photoUrl = ''; state.crt.previews = []; render(); return; }
    if ((el = g('[data-cedit]'))) { crtEdit(+el.dataset.cedit); return; }
    if ((el = g('[data-cdl]'))) { crtDownload(+el.dataset.cdl); return; }
    if (g('[data-crtdl]')) { crtApply(); crtDownload(+$('crt-ed').dataset.i); return; }
    if (g('[data-ccap]')) { copy(state.crt.caption, g('[data-ccap]')); return; }
  });

  function addItem(k, inp) {
    const v = (inp.value || '').trim(); if (!v || !D) return;
    D.e[k].push({ t: v, done: false }); inp.value = ''; dirty(); drawDrawer();
    const n = $('drawer').querySelector(`[data-addto="${k}"]`); if (n) n.focus();
  }
  document.addEventListener('input', ev => {
    const t = ev.target;
    if (D && t.closest && t.closest('#drawer')) {
      const e = D.e;
      if (t.tagName === 'TEXTAREA') autoH(t);
      if (t.dataset.f) { if (t.dataset.f === 'date' && !t.value) return; e[t.dataset.f] = t.value; if (t.dataset.f !== 'type') dirty(); }
      else if (t.dataset.li) { const [k, i] = t.dataset.li.split(':'); e[k][+i].t = t.value; dirty(); }
      else if (t.dataset.sh) { const [i, k] = t.dataset.sh.split(':'); e.shots[+i][k] = t.value; dirty(); }
      return;
    }
    if (t.closest && t.closest('#crt-ed')) crtLive();
    if (t.id === 'crt-topic') state.crt.topic = t.value;
    if (t.closest && t.closest('#agents-form') && t.tagName === 'TEXTAREA') autoH(t);
    if (t.dataset && t.dataset.pr) { const [i, k] = t.dataset.pr.split(':'); W.rows[+i][k] = t.type === 'checkbox' ? t.checked : t.value; if (k === 'on') { const b = $('plan-form').querySelector('[type=submit]'), n = W.rows.filter(r => r.on).length; b.textContent = 'Добавить ' + n + ' и расписать'; b.disabled = !n; } }
  });
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (D && t.closest && t.closest('#drawer')) {
      const e = D.e;
      if (t.dataset.ck) { const [k, i] = t.dataset.ck.split(':'); e[k][+i].done = t.checked; const all = [...e.prep, ...e.steps]; if (all.length && all.every(s => s.done) && e.status !== 'done') { e.status = 'done'; toast('Всё отмечено — событие выполнено'); } dirty(); drawDrawer(); return; }
      if (t.dataset.f === 'type') { e.type = t.value; if (!stOf(e)[e.status]) e.status = 'plan'; if (e.type === 'content' && e.format === 'none') e.format = 'reels'; dirty(); drawDrawer(); return; }
      if (t.dataset.f === 'date' && t.value) { e.date = t.value; dirty(); return; }
      if (t.dataset.f === 'status' || t.dataset.f === 'format') { dirty(); drawDrawer(); }
      return;
    }
    if (t.closest && t.closest('#crt-ed')) crtLive();
    if (t.id === 'crt-svc') state.crt.svc = t.value;
    if (t.id === 'crt-ai') state.crt.useAI = t.checked;
    if (t.id === 'crt-photo' && t.files[0]) { const s = state.crt; if (s.photoUrl) URL.revokeObjectURL(s.photoUrl); s.photoUrl = URL.createObjectURL(t.files[0]); C().loadImg(s.photoUrl).then(i => { s.photo = i; s.previews = []; render(); }); }
    if (t.dataset && t.dataset.pr && t.type === 'checkbox') t.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.addEventListener('keydown', ev => {
    const t = ev.target;
    if (ev.key === 'Escape' && D && !$('dlg').open) { closeDrawer(); return; }
    if (t.dataset && t.dataset.addto && ev.key === 'Enter') { ev.preventDefault(); addItem(t.dataset.addto, t); return; }
    if (t.classList && t.classList.contains('ttl') && ev.key === 'Enter') { ev.preventDefault(); t.blur(); return; }
    if (t.id === 'c-in' && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); sendChat(t.value); }
  });
  document.addEventListener('submit', async ev => {
    const f = ev.target; ev.preventDefault();
    if (f.id === 'new-form') {
      const fd = new FormData(f), b = f.querySelector('[type=submit]'); b.disabled = true;
      const type = fd.get('type');
      try {
        const ai = fd.get('ai') === 'on';
        const id = await createEv({ title: String(fd.get('title')).trim(), date: fd.get('date'), type, format: type === 'content' ? 'reels' : 'none', idea: String(fd.get('idea') || '').trim(), aiState: ai ? 'pending' : '' });
        $('dlg').close(); openDrawer(id);
        if (ai) detailEvent(id, 'all').then(() => toast('Событие расписано')).catch(e => toast(e.message, 5000));
      } catch (_) { b.disabled = false; toast('Не сохранилось'); }
    }
    if (f.id === 'plan-form') { if (W.step === 'setup') planList(); else planCommit(); }
    if (f.id === 'chat-form') sendChat($('c-in').value);
    if (f.id === 'edit-form') saveEdit(f);
    if (f.id === 'about-form') { const fd = new FormData(f), d = { updatedAt: Date.now(), by: me() }; ABOUT.forEach(([k]) => d[k] = String(fd.get(k) || '').trim()); try { await col.doc('about').set(d); toast('Сохранено — агенты теперь это учитывают'); document.activeElement.blur(); render(); } catch (_) { toast('Не сохранилось'); } }
    if (f.id === 'agents-form') { const fd = new FormData(f), d = {}; ['base', 'producer', 'planner', 'marketer', 'smm', 'analyst', 'designer'].forEach(k => { const v = String(fd.get(k) || '').trim(); d[k] = v && v !== PROMPTS[k] ? v : ''; }); try { await col.doc('agents').set({ ...d, updatedAt: Date.now() }); toast('Инструкции сохранены'); } catch (_) { toast('Не сохранилось'); } }
    if (f.id === 'idea-form') { const v = f.t.value.trim(); if (!v) return; f.t.value = ''; await col.doc().set({ kind: 'idea', title: v, status: 'new', notes: '', createdAt: Date.now(), updatedAt: Date.now(), by: me() }); }
    if (f.id === 'trend-form') { const link = f.link.value.trim(), note = f.note.value.trim(); if (!link && !note) return; await col.doc().set({ kind: 'trend', link, note, createdAt: Date.now(), by: me() }); f.reset(); toast('Сохранили в копилку'); }
    if (f.id === 'crt-form') crtGenerate();
    if (f.id === 'crt-ed') { crtApply(); $('dlg').close(); paintPreviews(); render(); }
  });
  /* перетаскивание событий по дням */
  document.addEventListener('dragstart', ev => { const el = ev.target.closest && ev.target.closest('[data-drag]'); if (el) { ev.dataTransfer.setData('text/plain', el.dataset.drag); ev.dataTransfer.effectAllowed = 'move'; } });
  document.addEventListener('dragover', ev => { const z = ev.target.closest && ev.target.closest('[data-drop]'); if (z) { ev.preventDefault(); z.classList.add('dragover'); } });
  document.addEventListener('dragleave', ev => { const z = ev.target.closest && ev.target.closest('[data-drop]'); if (z) z.classList.remove('dragover'); });
  document.addEventListener('drop', async ev => {
    const z = ev.target.closest && ev.target.closest('[data-drop]'); if (!z) return; ev.preventDefault(); z.classList.remove('dragover');
    const id = ev.dataTransfer.getData('text/plain'), e = evById(id); if (!e || e.date === z.dataset.drop) return;
    e.date = z.dataset.drop; e.updatedAt = Date.now(); await saveEv(e); toast('Перенесено на ' + fmtD(e.date));
  });
  window.addEventListener('beforeunload', () => { if (D && D.dirty) flush(); });
})();
