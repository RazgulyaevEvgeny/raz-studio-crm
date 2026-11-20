/* tv-core.js — общий движок экрана: стили карточек, анимации, иконки, данные по умолчанию и отрисовка.
   Используется и экраном (tv.html), и админкой (tv-admin.html) для предпросмотра. */
(function(){
const TV = window.TV = {};

/* Где лежат факты: Realtime Database CRM, раздел pub/<ключ> (читать может любой, кто знает ключ; писать — только сотрудники).
   Фото лежат отдельно, каждое в pub/<IMG><id>, чтобы экран не скачивал их заново при каждом изменении текста. */
TV.KEY = 'tvfacts_DdZ6xJoCLMkvw8lKZPyGDcoAOB1JNmrA';
TV.IMG = 'tvimg_IGPD6hxdYWcGBs0gb8OsEg_';
TV.DB = () => (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL || '').replace(/\/$/, '');

TV.COLORS = { blue:'#007aff', indigo:'#5856d6', purple:'#af52de', pink:'#ff2d55', red:'#ff3b30', orange:'#ff9500', yellow:'#ffcc00', green:'#34c759', teal:'#30b0c7', gray:'#8e8e93', black:'#1d1d1f' };
TV.COLORS_D = { blue:'#0a84ff', indigo:'#5e5ce6', purple:'#bf5af2', pink:'#ff375f', red:'#ff453a', orange:'#ff9f0a', yellow:'#ffd60a', green:'#30d158', teal:'#40c8e0', gray:'#8e8e93', black:'#3a3a3c' };
TV.THEME = 'light';
TV.col = k => (TV.THEME === 'dark' ? TV.COLORS_D : TV.COLORS)[k];
TV.COLOR_NAMES = { blue:'Синий', indigo:'Индиго', purple:'Фиолетовый', pink:'Розовый', red:'Красный', orange:'Оранжевый', yellow:'Жёлтый', green:'Зелёный', teal:'Бирюзовый', gray:'Серый', black:'Чёрный' };

TV.LAYOUTS = { g1:{n:1,t:'Одна на весь экран'}, g2:{n:2,t:'Две равные'}, g3:{n:3,t:'Три равные'}, g12:{n:3,t:'Большая слева + две'}, g21:{n:3,t:'Две + большая справа'}, g4:{n:4,t:'Четыре (2×2)'}, gx:{n:8,t:'Свободная: добавляйте карточки и задавайте ширину'} };
TV.cnt = sc => sc.layout === 'gx' ? Math.max(1, Math.min(8, +sc.cnt || 3)) : (TV.LAYOUTS[sc.layout] || TV.LAYOUTS.g3).n;
TV.ANIMS = { spring:'Пружина снизу', up:'Плавно снизу', fade:'Растворение', left:'Слева направо', right:'Справа налево', zoom:'Увеличение', flip:'Переворот', drop:'Падение сверху', none:'Без анимации' };
TV.TANIMS = { none:'Вместе с карточкой', fade:'Проявление', up:'Снизу вверх', left:'Слева', zoom:'Увеличение' };
TV.SPEEDS = { slow:['Медленно',1.7], normal:['Обычно',1], fast:['Быстро',.55] };
TV.STYLES = { plain:'Стекло', white:'Белая', blue:'Синяя', kaspi:'Kaspi', dark:'Тёмная', custom:'Свой цвет' };

TV.ICONS = {
  needle:'<path d="M14 4l6 6M4 20 15.5 8.5"/><circle cx="18.5" cy="5.5" r="2.5"/>',
  printer:'<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
  cube:'<path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  bag:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
  calendar:'<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  star:'<path d="m12 2 3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4L1.5 9.6 9 8.9z"/>',
  gift:'<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  tool:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  truck:'<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  ball:'<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 4 8M2.5 9.5A10 10 0 0 1 16 10M12 12c-2 4-6 6-9.5 5.5M12 12c4 1 7 4 8.5 7"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  steam:'<path d="M8 3c-1 2 1 3 0 5M12 3c-1 2 1 3 0 5M16 3c-1 2 1 3 0 5M3 13h18l-2 8H5z"/>',
  shield:'<path d="M12 22c5-3 8-6 8-11V5l-8-3-8 3v6c0 5 3 8 8 11z"/><path d="m9 12 2 2 4-4"/>',
  heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
  cup:'<path d="M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v3M10 2v3M14 2v3"/>',
  car:'<path d="M5 17h14l-1.5-6.5A2 2 0 0 0 15.6 9H8.4a2 2 0 0 0-1.9 1.5zM3 17h18v3H3z"/>',
  sign:'<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M12 16v5M8 21h8"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  sparkle:'<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  map:'<path d="M12 22s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  shirt:'<path d="M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3c-1 2-7 2-8 0z"/>',
  bolt:'<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  trophy:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  camera:'<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  percent:'<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  fire:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.2.3 1.2 1.2 2.2 2.5 2.7z"/>',
  smile:'<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
};
TV.icon = (name) => TV.ICONS[name] ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${TV.ICONS[name]}</svg>` : '';

/* ---------- значения по умолчанию ---------- */
const F = (o) => Object.assign({
  style:'plain', bg:'#007aff', fg:'', icon:'', color:'blue', label:'',
  kind:'', wcity:'Павлодар', wlat:52.2873, wlon:76.9674, wmode:'days', qrUrl:'', ct:'', ctMsg:'', ctBrand:true, wifiSsid:'', wifiPass:'', wifiSec:'WPA', wifiShow:true, fxList:'USD,EUR,RUB,CNY', cdDate:'', goalTo:0,
  big:'', unit:'', plus:false, numColor:false, title:'', caption:'', list:'',
  visual:'', swatch:'#ffffff', photo:'', photoMode:'bg', photoFit:'cover', dim:45, zoom:true,
  sizeBig:'auto', sizeText:'m', align:'left', valign:'between', cLabel:'', cBig:'', cTitle:'', cCap:'', cList:'', video:'', stars:0, oLabel:'', oBig:'', oTitle:'', oCap:'', oList:'', icBg:'', icFg:'',
  auto:'', autoFrom:0 }, o);
const S = (o) => Object.assign({ on:true, layout:'g3', anim:'spring', tanim:'fade', speed:'normal', stagger:true, sec:0, facts:[] }, o);
TV.F = F;
TV.DEFAULT = { slideSec: 20, fx: true, lite: true, theme: 'dark', show: { music:true, weather:true, clock:true }, screens: [
  S({ layout:'g12', facts:[
    F({style:'blue', label:'Спасибо, что выбираете нас', big:'1500', plus:true, title:'заказов студии выполнено', visual:'tag'}),
    F({style:'kaspi', icon:'bag', label:'Наш магазин на Kaspi', big:'2000', plus:true, caption:'заказов доставили по всему Казахстану'}),
    F({icon:'users', color:'green', label:'Клиенты', big:'900', plus:true, caption:'возвращаются к нам снова'}) ]}),
  S({ layout:'g12', facts:[
    F({style:'blue', icon:'calendar', label:'Наша история', big:'С февраля 2025', caption:'а всё началось с одной вышивальной машинки', visual:'tag'}),
    F({icon:'star', color:'purple', label:'Хиты студии', title:'Чаще всего заказывают DTF-принты и вышивку'}),
    F({icon:'gift', color:'pink', label:'Любимые заказы', title:'Подарки', caption:'Нет ничего приятнее, чем видеть, как ваш подарок радует других'}) ]}),
  S({ facts:[
    F({icon:'needle', color:'indigo', label:'Вышивка', big:'200', unit:'км', title:'вышивальной нити уже в стежках', caption:'длиннее дороги от Павлодара до Экибастуза'}),
    F({visual:'flag-it', big:'Итальянские нити', caption:'Яркие, прочные, не выцветают после стирок'}),
    F({icon:'printer', color:'purple', label:'DTF-печать', big:'150', numColor:true, title:'стирок выдерживает принт', caption:'не трескается и не линяет'}) ]}),
  S({ facts:[
    F({icon:'needle', color:'indigo', label:'Вышивка логотипа', big:'12000', title:'стежков в одном логотипе', caption:'и 1,5–2 часа работы машинки'}),
    F({icon:'cup', color:'orange', label:'Кофейный топпер', big:'35', unit:'мин', title:'печатается один топпер'}),
    F({icon:'steam', color:'blue', label:'Наша гордость', title:'Профессиональный отпариватель', caption:'каждая вещь уходит к вам идеально ровной'}) ]}),
  S({ facts:[
    F({icon:'cube', color:'orange', label:'3D-печать', big:'340', unit:'кг', title:'пластика превратили в изделия'}),
    F({visual:'swatch', swatch:'#ffffff', big:'112', unit:'кг', title:'белого — наш цвет №1', caption:'вывески, таблички, топперы'}),
    F({visual:'swatch', swatch:'#1d1d1f', big:'96', unit:'кг', title:'чёрного — на втором месте', caption:'вместе с белым — 60% всего пластика'}) ]}),
  S({ facts:[
    F({icon:'tool', color:'teal', label:'Самое маленькое', big:'Плоскогубцы', caption:'брендировали даже их'}),
    F({icon:'truck', color:'red', label:'Самое большое', big:'Фура', caption:'да, мы брендировали фуру'}),
    F({icon:'ball', color:'orange', label:'Самый большой заказ', title:'Весь инвентарь для женской волейбольной команды', caption:'Смотрите рилс в нашем Instagram'}) ]}),
  S({ facts:[
    F({icon:'clock', color:'green', label:'Сроки', big:'Всегда в срок', caption:'Никогда не обманываем насчёт сроков'}),
    F({icon:'shield', color:'blue', label:'Качество', big:'Гарантия', caption:'Ручаемся за качество каждой работы'}),
    F({style:'blue', icon:'heart', label:'Сервис', big:'Нас выбирают снова', caption:'Много постоянных клиентов приходят за сервисом и качеством'}) ]}),
  S({ facts:[
    F({big:'Что мы делаем', list:'DTF на одежде\nВышивка\n3D-печать\nНаклейки на авто\nВывески и таблички'}),
    F({visual:'insta', big:'@raz.brandstudio', numColor:true, color:'blue', caption:'Смотрите наши работы в Instagram'}),
    F({style:'blue', icon:'plus', big:'Есть идея?', caption:'Расскажите — придумаем и сделаем. А если это подарок, сделаем с особой любовью'}) ]}),
]};
TV.newFact = () => F({icon:'sparkle', color:'blue', label:'Новый факт', big:'100', title:'чего-нибудь крутого'});
TV.newScreen = () => S({ facts:[TV.newFact(), TV.newFact(), TV.newFact(), TV.newFact()] });

TV.AUTO = {};
/* фон экрана: цвет основы и 4 пятна свечения; '' — как задумано темой; a — яркость свечения в % */
TV.BG_DEF = {
  light: { base:'#ffffff', c:['#007aff','#af52de','#ff2d55','#30b0c7'], al:[.20,.16,.11,.16] },
  dark:  { base:'#000000', c:['#0a84ff','#5e5ce6','#bf5af2','#40c8e0'], al:[.16,.14,.08,.08] } };
TV.BG_PRESETS = [
  { n:'Как задумано', bg:{ base:'', c:['','','',''], a:100 } },
  { n:'Закат', bg:{ base:'', c:['#ff9f0a','#ff375f','#bf5af2','#ff453a'], a:120 } },
  { n:'Океан', bg:{ base:'', c:['#0a84ff','#40c8e0','#5e5ce6','#64d2ff'], a:130 } },
  { n:'Изумруд', bg:{ base:'', c:['#30d158','#40c8e0','#0a84ff','#30d158'], a:110 } },
  { n:'Kaspi', bg:{ base:'', c:['#ff453a','#ff9f0a','#ff375f','#ff453a'], a:110 } },
  { n:'Ночь', bg:{ base:'#05060a', c:['#5e5ce6','#0a84ff','#bf5af2','#5e5ce6'], a:160 } },
  { n:'Без свечения', bg:{ base:'', c:['','','',''], a:0 } } ];
TV.normBg = b => { b = b || {}; const c = Array.isArray(b.c) ? b.c : []; return { base: b.base || '', c: [0,1,2,3].map(i => c[i] || ''), a: b.a == null ? 100 : Math.max(0, Math.min(300, +b.a || 0)) }; };
const rgba = (hex, a) => { const h = String(hex).replace('#',''); return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${Math.max(0, Math.min(1, a)).toFixed(3)})`; };
TV.bgApply = (stage, bg, theme) => {
  const b = TV.normBg(bg), D = TV.BG_DEF[theme === 'light' ? 'light' : 'dark'];
  if (b.base) stage.style.setProperty('background', b.base, 'important'); else stage.style.removeProperty('background');
  const blobs = stage.querySelectorAll('.bgfx i');
  for (let i = 0; i < blobs.length && i < 4; i++) {
    const custom = b.c[i] || b.a !== 100;
    blobs[i].style.background = custom ? `radial-gradient(circle,${rgba(b.c[i] || D.c[i], D.al[i] * b.a / 100)},${rgba(b.c[i] || D.c[i], 0)} 62%)` : '';
  }
  return b.base;
};
/* музыка: воркер ym-wave и настройки по умолчанию */
TV.YM = { worker: 'https://ym-wave.design-onegin.workers.dev', key: 'XRcl7HslUDmN3WPNqWABNaI5' };
TV.normalizeMusic = (m) => { m = m || {}; return {
  st: /^[a-z]+:[A-Za-z0-9_.-]+$/.test(m.st || '') ? m.st : 'user:onyourwave', name: m.name || '',
  mood: ['all','calm','fun','active','sad'].indexOf(m.mood) >= 0 ? m.mood : 'calm',
  div: ['default','favorite','popular','discover'].indexOf(m.div) >= 0 ? m.div : 'default',
  lang: ['any','russian','not-russian'].indexOf(m.lang) >= 0 ? m.lang : 'any',
  vol: m.vol == null ? 60 : Math.max(0, Math.min(100, +m.vol || 0)), skip: +m.skip || 0 }; };
TV.AUTO_SRC = { orders:'Выданные заказы студии', kaspi:'Продажи Kaspi', clients:'Клиенты студии' };
TV.value = f => { const b = +String(f.big).replace(/\s/g,'') || 0; const v = f.auto && TV.AUTO[f.auto] != null ? Math.max(0, +TV.AUTO[f.auto] - (+f.autoFrom || 0)) : 0; return b + v; };

/* привести данные из базы к полному виду (старые записи тоже) */
TV.normalize = (d) => {
  if (!d || !Array.isArray(d.screens)) d = JSON.parse(JSON.stringify(TV.DEFAULT));
  const show = Object.assign({ music:true, weather:true, clock:true }, d.show || {});
  const h0 = d.hdr || {}, sz = v => Math.max(0.6, Math.min(1.6, +v || 1)), ord = Array.isArray(h0.order) && h0.order.length === 3 && ['music','weather','clock'].every(k => h0.order.includes(k)) ? h0.order : ['music','weather','clock'];
  const hdr = { music: sz(h0.music), weather: sz(h0.weather), clock: sz(h0.clock), order: ord, city: h0.city || 'Павлодар', lat: +h0.lat || 52.2873, lon: +h0.lon || 76.9674 };
  return { slideSec: +d.slideSec || 20, fx: d.fx !== false, lite: d.lite !== false, theme: d.theme === 'light' ? 'light' : 'dark', foot: d.foot == null ? 'Работаем с 11:00 до 19:00' : String(d.foot).slice(0, 120), bg: TV.normBg(d.bg), pill: { bg: (d.pill && d.pill.bg) || '', fg: (d.pill && d.pill.fg) || '' }, show, hdr,
    screens: d.screens.map(s => { const sc = S(s || {}); sc.on = s.on !== false; if (!TV.LAYOUTS[sc.layout]) sc.layout = 'g3'; if (!TV.ANIMS[sc.anim]) sc.anim = 'spring';
      const src = s.facts || []; sc.facts = Array.from({ length: Math.max(4, Math.min(8, src.length)) }, (_, i) => i).map(i => F(src[i] || (i === 3 ? TV.newFact() : {}))); return sc; }) };
};

/* ---------- фото ---------- */
TV.IMGCACHE = {};
/* память устройства: фото и видео лежат в IndexedDB приставки и при следующих запусках берутся оттуда, без интернета */
TV.PERSIST = false;
const idb = () => TV._idb || (TV._idb = new Promise((res) => { try { const r = indexedDB.open('raz-tv', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } }));
TV.fileGet = (id) => !TV.PERSIST ? Promise.resolve('') : idb().then(d => !d ? '' : new Promise(res => { try { const q = d.transaction('files').objectStore('files').get(id); q.onsuccess = () => res(q.result || ''); q.onerror = () => res(''); } catch (e) { res(''); } }));
TV.fileHas = (id) => (TV.IMGCACHE[id] && typeof TV.IMGCACHE[id] === 'string') ? Promise.resolve(true) : !TV.PERSIST ? Promise.resolve(false) : idb().then(d => !d ? false : new Promise(res => { try { const q = d.transaction('files').objectStore('files').count(id); q.onsuccess = () => res(q.result > 0); q.onerror = () => res(false); } catch (e) { res(false); } }));
TV.filePut = (id, v) => { if (TV.PERSIST && v) idb().then(d => { try { d && d.transaction('files', 'readwrite').objectStore('files').put(v, id); } catch (e) {} }); };
TV.filePrune = (keep) => { if (TV.PERSIST) idb().then(d => { try { if (!d) return; const st = d.transaction('files', 'readwrite').objectStore('files'), q = st.getAllKeys(); q.onsuccess = () => { const ks = q.result || []; if (ks.length > 60) ks.forEach(k => { if (!keep[k]) st.delete(k); }); }; } catch (e) {} }); };
TV.loadImg = (id) => {
  if (!id) return Promise.resolve('');
  if (TV.IMGCACHE[id]) return Promise.resolve(TV.IMGCACHE[id]);
  const db = TV.DB(); if (!db) return Promise.resolve('');
  return TV.IMGCACHE[id] = TV.fileGet(id).then(c => c || fetch(`${db}/pub/${TV.IMG}${id}.json`).then(r => r.json()).then(o => { if (!o) return ''; const n = +o.n || 1; if (n < 2) return o.d || '';
      /* большой файл лежит частями: докачиваем остальные по очереди и склеиваем */
      let p = Promise.resolve([o.d || '']); for (let k = 1; k < n; k++) p = p.then(a => fetch(`${db}/pub/${TV.IMG}${id}_p${k}/d.json`).then(r => r.json()).then(x => { if (typeof x !== 'string') throw new Error('part'); a.push(x); return a; }));
      return p.then(a => a.join('')); }).then(d => { TV.filePut(id, d); return d; })).then(d => (TV.IMGCACHE[id] = d || '')).catch(() => { delete TV.IMGCACHE[id]; return ''; });
};
/* видео: хранится как dataURL, для проигрывания превращаем в blob-ссылку (один раз на файл) */
TV.VIDURL = {};
TV.NOVID = false;   // в приложении «Студия» видео скачивает и играет сама приставка, странице оно не нужно
TV.loadVid = (id) => TV.VIDURL[id] || (TV.VIDURL[id] = Promise.resolve(TV.loadImg(id)).then(d => (d && typeof d === 'string') ? fetch(d).then(r => r.blob()).then(b => URL.createObjectURL(b)) : '').catch(() => { delete TV.VIDURL[id]; return ''; }));
TV.playVids = (root, on) => root.querySelectorAll('video').forEach(v => { try { if (on) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); } else v.pause(); } catch (e) {} });
/* заранее скачать все фото и видео экранов, по одному, чтобы смена слайдов шла без ожидания */
TV.preloadAll = (screens) => { const ids = [], keep = {}; (screens || []).forEach(sc => (sc.facts || []).forEach(f => { if (f.photo) { ids.push(['i', f.photo]); keep[f.photo] = 1; } if (f.video && !TV.NOVID) { ids.push(['v', f.video]); keep[f.video] = 1; } }));
  return ids.reduce((p, x) => p.then(() => x[0] === 'v' ? TV.loadVid(x[1]) : TV.loadImg(x[1])).catch(() => {}), Promise.resolve()).then(() => TV.filePrune(keep)); };
TV.hydrate = (root) => { root.querySelectorAll('video[data-vid]').forEach(el => { if (el._h || TV.NOVID) return; el._h = 1; el.muted = true;
    TV.loadVid(el.dataset.vid).then(u => { if (!u) return; el.src = u; if (el.closest('.scene.on')) TV.playVids(el.parentNode, true); }); });
  root.querySelectorAll('[data-img]').forEach(el => {
  const id = el.dataset.img; Promise.resolve(TV.IMGCACHE[id] || TV.loadImg(id)).then(u => { if (u && typeof u === 'string') { if (el.tagName === 'IMG') el.src = u; else el.style.backgroundImage = `url("${u}")`; } });
}); };

/* ---------- стили ---------- */
TV.CSS = `
.bgfx{position:absolute;top:0;right:0;bottom:0;left:0;z-index:0;overflow:hidden}
.bgfx i{position:absolute;width:1300px;height:1300px;border-radius:50%;will-change:transform}
.bgfx i:nth-child(1){left:-300px;top:-500px;background:radial-gradient(circle,rgba(0,122,255,.20),rgba(0,122,255,0) 65%);animation:tvd1 38s ease-in-out infinite alternate}
.bgfx i:nth-child(2){right:-400px;top:-300px;background:radial-gradient(circle,rgba(175,82,222,.16),rgba(175,82,222,0) 65%);animation:tvd2 46s ease-in-out infinite alternate}
.bgfx i:nth-child(3){left:300px;bottom:-700px;background:radial-gradient(circle,rgba(255,45,85,.11),rgba(255,45,85,0) 65%);animation:tvd3 52s ease-in-out infinite alternate}
.bgfx i:nth-child(4){right:100px;bottom:-650px;background:radial-gradient(circle,rgba(48,176,199,.16),rgba(48,176,199,0) 65%);animation:tvd4 44s ease-in-out infinite alternate}
@keyframes tvd1{to{transform:translate(520px,300px) scale(1.15)}}@keyframes tvd2{to{transform:translate(-560px,360px) scale(.9)}}
@keyframes tvd3{to{transform:translate(480px,-340px) scale(1.2)}}@keyframes tvd4{to{transform:translate(-620px,-260px) scale(1.05)}}
.nofx .bgfx{display:none}

.scene{position:absolute;left:72px;right:72px;top:192px;top:calc(88px + var(--hh,104px));bottom:112px;display:-webkit-box;display:flex;flex-direction:row;z-index:2;pointer-events:none;--sp:1;--st:.18s;--from:translateY(60px) scale(.94);--to:translateY(-40px) scale(.97);--ease:cubic-bezier(.2,1.25,.3,1)}
.scene .f{opacity:0;transform:var(--from);transition:opacity calc(.7s * var(--sp)) ease,transform calc(.7s * var(--sp)) ease}
.scene.on .f{opacity:1;transform:none;transition:opacity calc(.9s * var(--sp)) ease,transform calc(1.1s * var(--sp)) var(--ease)}
.scene.out .f{opacity:0;transform:var(--to)}
.scene.on .f{transition-delay:calc(var(--st) * var(--i,0))}
.scene.out .f{transition-delay:calc(var(--st) * .4 * var(--i,0))}
.scene.on .ic,.scene.on .sw,.scene.on .insta{animation:tvpop calc(.8s * var(--sp)) cubic-bezier(.2,1.6,.4,1) both;animation-delay:calc(.45s * var(--sp) + var(--st) * var(--i,0))}
.scene.on .li .ic{animation-delay:calc(.5s * var(--sp) + var(--n,0) * .12s)}
@keyframes tvpop{0%{transform:scale(0) rotate(-20deg)}100%{transform:none}}
/* варианты анимации */
.an-up{--from:translateY(140px);--ease:cubic-bezier(.2,.8,.2,1)}
.an-fade{--from:none;--to:none}
.an-left{--from:translateX(-160px);--to:translateX(120px);--ease:cubic-bezier(.2,.9,.25,1)}
.an-right{--from:translateX(160px);--to:translateX(-120px);--ease:cubic-bezier(.2,.9,.25,1)}
.an-zoom{--from:scale(.72);--to:scale(1.06);--ease:cubic-bezier(.2,1.2,.3,1)}
.an-flip{--from:perspective(1400px) rotateY(-75deg);--to:perspective(1400px) rotateY(60deg);--ease:cubic-bezier(.2,1,.3,1)}
.an-flip .f{transform-origin:left center}
.an-drop{--from:translateY(-160px);--to:translateY(120px);--ease:cubic-bezier(.3,1.4,.4,1)}
.an-none{--sp:0.001;--st:0s}
.an-none .ic,.an-none .sw,.an-none .insta{animation:none!important}

/* раскладки: только flex — работает и в старых браузерах приставок */
.scene>.f,.scene>.col{flex:1 1 0%;min-width:0}
.scene>*+*{margin-left:28px}
.scene>.big{flex:1.25 1 0%}
/* заголовок экрана над карточками */
.scene.has-head{padding-top:132px}
.f .t,.f .cap,.f .lt,.f .h,.f .li{overflow-wrap:break-word;word-wrap:break-word;-webkit-hyphens:auto;hyphens:auto}
.f .lt{min-width:0}
/* свободная раскладка: карточки идут рядами, ширина у каждой своя */
.scene.gx{-webkit-flex-wrap:wrap;flex-wrap:wrap;align-content:stretch;left:58px;right:58px;top:178px;bottom:98px}
.scene.gx>.f:not(.shd){margin:14px!important;flex:0 0 auto;min-height:0}
.scene.gx.has-head{padding-top:132px}
.scene.gx>.f.shd{left:14px;right:14px;top:14px}
.scene>.f.shd{position:absolute;left:0;right:0;top:0;height:108px;margin:0!important;padding:0 6px;background:none!important;box-shadow:none!important;border-radius:0;justify-content:center;overflow:visible;flex:none}
.shd .sh1{font-family:"Inter Tight",Inter,system-ui,sans-serif;font-size:68px;font-weight:800;letter-spacing:-.025em;line-height:1.02;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.shd .sh2{font-size:30px;font-weight:500;line-height:1.2;color:var(--fg2);margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dark .scene>.f.shd{box-shadow:none!important;background:none!important}
.col{display:flex;flex-direction:column;min-height:0}
.col>.f{flex:1 1 0%;min-height:0}
.col>*+*{margin-top:28px}
/* карточка */
.f{--fg:#1d1d1f;--fg2:#8e8e93;background:rgba(255,255,255,.62);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.95),0 14px 40px rgba(40,60,140,.08);border-radius:40px;padding:48px 50px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden;color:var(--fg);min-height:0;min-width:0}
.f>*{position:relative;z-index:1}
.f>.bgph,.f>.shade,.f>.deco{position:absolute}
.f .stars{font-size:44px;letter-spacing:8px;line-height:1;color:#ffcc00;margin-bottom:22px}
.f .stars i{font-style:normal;opacity:.22}
.f.rev .t{font-size:32px;font-weight:500;line-height:1.32;letter-spacing:-.01em;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:9;overflow:hidden}
.f.rev.big .t{font-size:40px}
.f.rev .cap{font-weight:600;margin-top:20px}
.f video.bgv{position:absolute!important;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0!important;border-radius:inherit}
.f .fb{margin-top:24px}
.ft .top+.pic,.ft .flag+.top,.ft .sw+.top,.ft .insta+.top{margin-top:20px}
.f.st-white{background:#fff}
.f.st-blue{background:#007aff;--fg:#fff;--fg2:rgba(255,255,255,.86)}
.f.st-kaspi{background:#f14635;--fg:#fff;--fg2:rgba(255,255,255,.88)}
.f.st-dark{background:#1d1d1f;--fg:#fff;--fg2:rgba(255,255,255,.7)}
.f.st-custom{--fg:#fff;--fg2:rgba(255,255,255,.86)}
.f.light-bg{--fg:#1d1d1f;--fg2:rgba(0,0,0,.55)}
.f.on-color .ic:not(.ic-set){background:rgba(255,255,255,.22)!important;color:#fff}
.f.shine::after{content:"";position:absolute;z-index:2;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.22),transparent);transform:skewX(-18deg);animation:tvshine 7s ease-in-out 2s infinite;pointer-events:none}
@keyframes tvshine{0%,70%{left:-60%}100%{left:130%}}
.f.va-center{justify-content:center}.f.va-top{justify-content:flex-start}.f.va-bottom{justify-content:flex-end}
.f.al-center{text-align:center;align-items:center}.f.al-center .top{justify-content:center}.f.al-center .li{justify-content:center}
.f.al-right{text-align:right;align-items:flex-end}.f.al-right .top{justify-content:flex-end}
/* фото */
.f .bgph{position:absolute;top:0;right:0;bottom:0;left:0;z-index:0;background:#d1d1d6 center/cover no-repeat}
.f .bgph.kb{animation:tvkb 24s ease-in-out infinite alternate}
@keyframes tvkb{from{transform:scale(1)}to{transform:scale(1.12) translate(-2%,-1%)}}
.f .shade{position:absolute;top:0;right:0;bottom:0;left:0;z-index:0;background:linear-gradient(to top,rgba(0,0,0,var(--dim)),rgba(0,0,0,calc(var(--dim) * .35)))}
.f.has-bg{--fg:#fff;--fg2:rgba(255,255,255,.88)}
.f .pic{display:block;flex:1 1 auto;min-height:120px;border-radius:26px;background:#e5e5ea center/cover no-repeat}
.f .pic.contain{background-size:contain;background-color:transparent}
.wxic{background:transparent!important;width:76px;height:76px}.wxic svg{width:76px;height:76px}
.hero.wdg .h.wxt,.hero.wdg .h.clk{font-size:300px}.hero.wdg .wxn .t,.hero.wdg-clock .t{font-size:64px}.hero.wdg .h.mus{font-size:110px}.hero.wdg .t{font-size:52px}
.hero .wxic{width:110px;height:110px}.hero .wxic svg{width:110px;height:110px}.hero.wdg .top .lt{font-size:52px}
.hero .wxd{gap:64px}.hero .wxd>div{font-size:40px}.hero .wxd i,.hero .wxd i svg{width:96px;height:96px}.hero .wxd i{margin:10px 0}.hero .wxd b{font-size:60px}.hero .wxd small{font-size:40px}
.wdg-kzmap .fb{flex:1 1 auto;min-height:0;display:flex}.kzw{flex:1;display:flex;flex-direction:column;gap:22px;min-height:0}
.kzm{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center}.kzsvg{width:100%;height:100%;max-height:100%;overflow:visible}
.kzb{fill:rgba(127,127,127,.18);stroke:rgba(127,127,127,.55);stroke-width:2.5;stroke-linejoin:round}.on-color .kzb{fill:rgba(255,255,255,.14);stroke:rgba(255,255,255,.55)}
.kza{fill:none;stroke:#ff9f0a;stroke-width:3;stroke-linecap:round}.kzg{fill:#ff9f0a;opacity:.22}.kzd{fill:#ff9f0a;stroke:#fff;stroke-width:3}.kzh{fill:#0a84ff;stroke:#fff;stroke-width:4}
.kzs{flex:0 0 auto;display:flex;align-items:baseline;gap:22px 28px;flex-wrap:wrap}.wdg .h.kzn{font-size:96px;font-weight:800;line-height:1;letter-spacing:-.04em}.kzs .t{font-size:40px}.kzl{display:flex;gap:28px;flex-wrap:wrap;margin-left:auto}
.kzt{display:flex;gap:12px;font-size:32px;color:var(--fg2);white-space:nowrap}.kzt b{color:var(--fg);font-weight:800}
.ctq{--q:300px;justify-content:center!important}.ctq>.ft{display:none!important}.ctq>.fb{flex:1 1 auto;min-height:0;display:flex;align-items:center;margin:0!important}
.ctq .ctop{display:flex;align-items:center;gap:calc(var(--q) * .06);min-width:0;margin:0 0 calc(var(--q) * .09)!important;min-height:0!important}
.ctq .ctl{flex:none;width:calc(var(--q) * .24);height:calc(var(--q) * .24);border-radius:calc(var(--q) * .07);background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.12)}.ctq .ctl svg{width:62%;height:62%}
.ctq .ctop .lt{font-size:calc(var(--q) * .1)!important;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;color:var(--fg2)}.ctq.ctbrand .ctop .lt{color:#fff}
.ctq .ctw{display:flex;align-items:center;gap:calc(var(--q) * .13);width:100%;min-width:0}
.ctq .qri{flex:none;width:var(--q);height:var(--q);padding:calc(var(--q) * .055);border-radius:calc(var(--q) * .09);background:#fff;box-sizing:border-box;box-shadow:0 6px 24px rgba(0,0,0,.14)}.ctq .qri .qrs{display:block;width:100%;height:100%}
.ctq .qre{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#8e8e93;font-size:calc(var(--q) * .12);font-weight:800;text-align:center}
.ctq .ctt{flex:1;min-width:0}.ctq .ctn{font-size:calc(var(--q) * .175);font-weight:800;letter-spacing:-.02em;line-height:1.1;white-space:nowrap;overflow:hidden;color:inherit}
.ctq .ctc{font-size:calc(var(--q) * .092);line-height:1.32;margin-top:calc(var(--q) * .05);color:var(--fg2);-webkit-hyphens:none;hyphens:none;word-break:normal;overflow-wrap:normal;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.ctq .ctc b{color:inherit;font-weight:800;opacity:1}
.ctq.ctbrand .ctc{color:rgba(255,255,255,.88)}
.ctq.ctv .ctw{flex-direction:column;text-align:center;gap:0}.ctq.ctv .ctt{display:contents}.ctq.ctv .ctop{order:-1;justify-content:center;max-width:100%;margin-bottom:calc(var(--q) * .12)!important}.ctq.ctv .qri{margin-bottom:calc(var(--q) * .12)}.ctq.ctv .ctn,.ctq.ctv .ctc{width:100%}
.qrw{display:flex;align-items:center;gap:40px}.qri .qrs{display:block;width:100%;height:100%}.qrt .cap b{color:var(--fg)}.qri{width:calc(300px * var(--fz,1));height:calc(300px * var(--fz,1));flex:none;background:#fff;border-radius:24px;padding:calc(18px * var(--fz,1));box-sizing:border-box;object-fit:contain}
.qre{display:flex;align-items:center;justify-content:center;color:#8e8e93;font-size:60px;font-weight:800}.hero .qri{width:calc(400px * var(--fz,1));height:calc(400px * var(--fz,1))}
.qrt{min-width:0}.wdg .qrt .h{font-size:calc(60px * var(--fz,1))!important;line-height:1.1;-webkit-hyphens:none;hyphens:none;overflow-wrap:normal;word-break:normal;letter-spacing:-.02em}.hero.wdg .qrt .h{font-size:calc(76px * var(--fz,1))!important}.wdg .qrt .cap{margin-top:18px}
.fxl{display:flex;flex-direction:column;gap:14px}.fxr{display:flex;justify-content:space-between;align-items:baseline;gap:24px;font-size:40px;color:var(--fg2)}.fxr b{color:var(--fg);font-weight:800}
.fxr i{font-style:normal;font-size:56px;font-weight:800;color:var(--fg);font-variant-numeric:tabular-nums;white-space:nowrap}.hero .fxr{font-size:56px}.hero .fxr i{font-size:84px}
.wdg .h.cdn{font-size:120px;font-weight:800;letter-spacing:-.03em;line-height:1}.hero.wdg .h.cdn{font-size:220px}
.wdg .h.gln{font-size:120px;font-weight:800;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}.wdg .h.gln small{font-size:.38em;opacity:.7;font-weight:600}
.glb{height:28px;border-radius:14px;background:rgba(127,127,127,.25);margin:26px 0 18px;overflow:hidden}.glb i{display:block;height:100%;border-radius:14px;background:currentColor;opacity:.9}
.wdg-weather .fb{display:flex;align-items:flex-end;justify-content:space-between;gap:40px;flex-wrap:wrap}.wdg-weather .wxd{margin-top:0}
.wdg .h.wxt,.wdg .h.clk{font-size:150px;font-weight:800;letter-spacing:-.045em;line-height:.95;font-variant-numeric:tabular-nums}
.wdg .h.mus{font-size:64px;line-height:1.05}
.wxd{display:flex;gap:34px;margin-top:26px}.wxd>div{display:flex;flex-direction:column;align-items:center;font-size:28px;color:var(--fg2)}
.wxd i{display:block;width:52px;height:52px;margin:4px 0}.wxd i svg{width:52px;height:52px}.wxd b{font-size:32px;color:var(--fg)}.wxd small{font-size:24px;opacity:.75}
.ic{width:80px;height:80px;border-radius:22px;display:flex;align-items:center;justify-content:center;color:#fff;flex:none}.top .ic{margin-right:22px}.ic svg{width:44px;height:44px}
.top{display:flex;align-items:center;font-size:34px;font-weight:600;color:var(--fg2);min-height:80px}
.num{display:inline-block;font-family:"Inter Tight",Inter,system-ui,sans-serif;font-weight:800;letter-spacing:-.045em;line-height:.92;font-variant-numeric:tabular-nums;font-size:150px;color:var(--fg)}
.num small{font-size:.38em;letter-spacing:-.01em;margin-left:8px;opacity:.6}.num .pl{font-size:.5em;opacity:1;margin-left:0}
.hero .num{font-size:250px}
.h{font-family:"Inter Tight",Inter,system-ui,sans-serif;font-size:64px;font-weight:800;letter-spacing:-.03em;line-height:1.02;color:var(--fg)}
.h.long{font-size:52px}.hero .h{font-size:120px}.hero .h.long{font-size:92px}
.t{font-family:"Inter Tight",Inter,system-ui,sans-serif;font-size:44px;font-weight:700;letter-spacing:-.02em;line-height:1.08;color:var(--fg)}
.num+.t,.h+.t{margin-top:18px}
.cap{font-size:32px;color:var(--fg2);font-weight:500;line-height:1.35;margin-top:14px}
.f[data-fg] .cap,.f[data-fg] .top{color:var(--fg);opacity:.8}
/* размеры */
.f.sb-s .num{font-size:96px}.f.sb-m .num{font-size:150px}.f.sb-l .num{font-size:210px}.f.sb-xl .num{font-size:280px}
.f.sb-s .h{font-size:44px}.f.sb-m .h{font-size:64px}.f.sb-l .h{font-size:92px}.f.sb-xl .h{font-size:124px}
.f.sx-s .t{font-size:32px}.f.sx-s .cap,.f.sx-s .li{font-size:26px}.f.sx-l .t{font-size:56px}.f.sx-l .cap,.f.sx-l .li{font-size:38px}.f.sx-xl .t{font-size:70px}.f.sx-xl .cap,.f.sx-xl .li{font-size:46px}
.flag{display:flex;height:20px;width:150px;border-radius:6px;overflow:hidden}.flag i{flex:1}.flag i:nth-child(2){box-shadow:inset 0 0 0 2px rgba(0,0,0,.08)}
.sw{width:120px;height:120px;border-radius:30px;box-shadow:inset 0 0 0 2px rgba(0,0,0,.08)}
.deco{position:absolute!important;z-index:0!important;right:-60px;top:-50px;width:440px;opacity:.13;color:#fff;animation:tvspin 60s linear infinite}@keyframes tvspin{to{transform:rotate(360deg)}}
.list{display:flex;flex-direction:column;margin-top:20px}.li+.li{margin-top:16px}
.li{display:flex;align-items:center;font-size:32px;font-weight:600}
.li .ic{width:60px;height:60px;border-radius:17px;margin-right:20px}.li .ic svg{width:32px;height:32px}
.insta{width:96px;height:96px;border-radius:26px;background:linear-gradient(45deg,#ffcc00,#ff2d55,#af52de);display:flex;align-items:center;justify-content:center;color:#fff}.insta svg{width:54px;height:54px}
`;
TV.CSS += `
/* лёгкий режим для слабых приставок: без тяжёлых эффектов, карточки просто проявляются */
.lite .bgfx i{animation:none!important;will-change:auto!important}
.lite .f{box-shadow:0 0 0 1.5px rgba(0,0,0,.05)!important}
.lite .f.shine::after{display:none!important}
.lite .deco,.lite .bgph.kb{animation:none!important}
/* плавный режим для слабой приставки: в дереве только текущий экран (и следующий, заранее отрисованный);
   двигаются только готовые слои карточек — прозрачность и короткий сдвиг, без перерисовки; в покое на экране не анимируется ничего */
.lite .scene{display:none}
.lite .scene.on,.lite .scene.out,.lite .scene.pre{display:flex}
.lite .scene .f{opacity:0;transform:translateY(36px);transition:none!important;will-change:opacity,transform}
.lite .scene.an-left .f,.lite .scene.an-flip .f{transform:translateX(-48px)}
.lite .scene.an-right .f{transform:translateX(48px)}
.lite .scene.an-drop .f{transform:translateY(-36px)}
.lite .scene.an-zoom .f{transform:scale(.96)}
.lite .scene.an-fade .f,.lite .scene.an-none .f{transform:none}
.lite .scene.on .f{opacity:1;transform:none!important;transition:opacity .45s ease-out,transform .55s cubic-bezier(.2,.8,.2,1)!important;transition-delay:calc(.09s * var(--i,0))!important}
.lite .scene.an-none.on .f{transition:none!important}
.lite .scene.out .f{opacity:0;transform:none!important;transition:opacity .25s linear!important;transition-delay:0s!important}
.lite .scene.on .ic,.lite .scene.on .sw,.lite .scene.on .insta{animation:none!important}
.lite .eq i{animation:none!important;height:18px!important}
.lite .colon{animation:none!important}
.lite .f .pic .pb{filter:brightness(.5)}
`;
TV.CSS += `
/* ===== тёмная тема в духе iOS =====
   фон — чистый чёрный с едва заметным цветным свечением; карточки — «материал» #1c1c1e с тонкой светлой гранью;
   текст — белый и два уровня серого как в iOS (60% и 30%); цветные карточки — мягкие градиенты; фото — с плавной вуалью */
.dark{background:#000!important;color:#fff;--ink:#fff;--tile:#1c1c1e;--tile2:#2c2c2e;--mute:rgba(235,235,245,.6);
  --l2:rgba(235,235,245,.68);--l3:rgba(235,235,245,.3);--card:#1c1c1e;--card2:#161618;--edge:rgba(255,255,255,.07)}
.dark .bgfx i{opacity:1}
.dark .bgfx i:nth-child(1){background:radial-gradient(circle,rgba(10,132,255,.16),rgba(10,132,255,0) 62%)}
.dark .bgfx i:nth-child(2){background:radial-gradient(circle,rgba(94,92,230,.14),rgba(94,92,230,0) 62%)}
.dark .bgfx i:nth-child(3){background:radial-gradient(circle,rgba(191,90,242,.08),rgba(191,90,242,0) 62%)}
.dark .bgfx i:nth-child(4){background:radial-gradient(circle,rgba(64,200,224,.08),rgba(64,200,224,0) 62%)}

.dark .f{border-radius:44px;box-shadow:inset 0 0 0 1.5px var(--edge),inset 0 1.5px 0 rgba(255,255,255,.06);--fg:#fff;--fg2:var(--l2)}
.dark .f.st-plain{background:#1c1c1e;background:linear-gradient(180deg,#202022 0%,#18181a 100%)}
.dark .f.st-white{background:#2c2c2e;background:linear-gradient(180deg,#323234 0%,#28282a 100%)}
.dark .f.st-dark{background:#000;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.12)}
.dark .f.st-blue{background:#0a84ff;background:linear-gradient(155deg,#3d9bff 0%,#0a7aff 38%,#0058d6 100%);--fg2:rgba(255,255,255,.85)}
.dark .f.st-kaspi{background:#f14635;background:linear-gradient(155deg,#ff6a5b 0%,#f2402f 40%,#c8241a 100%);--fg2:rgba(255,255,255,.86)}
.dark .f.st-custom{background-image:linear-gradient(155deg,rgba(255,255,255,.16) 0%,rgba(255,255,255,0) 45%,rgba(0,0,0,.22) 100%)!important}
.dark .f.st-blue,.dark .f.st-kaspi,.dark .f.st-custom{box-shadow:inset 0 1.5px 0 rgba(255,255,255,.22),inset 0 0 0 1.5px rgba(255,255,255,.08)}
.dark .f.light-bg{--fg:#1d1d1f;--fg2:rgba(0,0,0,.55)}
.dark .f.shine::after{background:linear-gradient(100deg,transparent,rgba(255,255,255,.12),transparent)}

/* типографика */
.dark .top{color:var(--fg2);font-weight:600;letter-spacing:-.005em}
.dark .num{font-weight:700;letter-spacing:-.05em;color:var(--fg)}
.dark .num small{color:var(--fg2);opacity:1;font-weight:600}
.dark .num .pl{color:var(--fg);opacity:.55}
.dark .h{font-weight:700;letter-spacing:-.035em}
.dark .t{font-weight:600;letter-spacing:-.02em;color:var(--fg)}
.dark .cap{color:var(--fg2);font-weight:500}
.dark .f.st-plain .cap,.dark .f.st-white .cap,.dark .f.st-dark .cap{color:var(--l2)}

/* значки — как иконки настроек iOS: сплошной цвет с лёгким объёмом */
.dark .ic{border-radius:24px;background-image:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,0) 55%,rgba(0,0,0,.12))}
.dark .f.on-color .ic:not(.ic-set){background-color:rgba(255,255,255,.2)!important;background-image:none}
.dark .li .ic{border-radius:18px}
.dark .li{color:var(--fg)}
.dark .sw{box-shadow:inset 0 0 0 2px rgba(255,255,255,.14)}
.dark .flag{box-shadow:0 0 0 1.5px rgba(255,255,255,.1)}

/* фото на всю карточку: снизу и сверху плавная вуаль, чтобы текст читался, а середина фото оставалась живой */
.dark .f .bgph{background-color:#2c2c2e}
.dark .f .shade{border-radius:inherit;background:linear-gradient(to top,rgba(0,0,0,calc(var(--dim) * 1.75)) 0%,rgba(0,0,0,calc(var(--dim) * 1.05)) 28%,rgba(0,0,0,0) 62%),linear-gradient(to bottom,rgba(0,0,0,calc(var(--dim) * .9)) 0%,rgba(0,0,0,0) 30%);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.08)}
.dark .f.has-bg .num,.dark .f.has-bg .h,.dark .f.has-bg .t{text-shadow:0 2px 24px rgba(0,0,0,.35)}
.dark .f.has-bg{--fg2:rgba(255,255,255,.82)}
/* фото сверху: на всю ширину карточки, без отступов, как карточки App Store */
.dark .f .ft .pic{order:-1;margin:-48px -50px 0;border-radius:0;background-color:#2c2c2e}
.dark .f .ft .top+.pic,.dark .f .ft .pic{margin-top:-48px}
.dark .f .ft .top:first-child:not(:last-child){margin-top:30px}
.dark .f.st-plain .ft .pic::after{content:"";position:absolute;left:0;right:0;bottom:0;height:34%;background:linear-gradient(to bottom,rgba(24,24,26,0),rgba(28,28,30,.9))}
`;
TV.CSS += `
/* фото «целиком» (логотип, изделие на белом): размытая копия заполняет фон, само фото — поверх без обрезки */
.f .pic{position:relative;overflow:hidden}
.f .pic .pb{position:absolute;top:0;right:0;bottom:0;left:0;background:center/cover no-repeat}
.f .pic .pw{position:absolute;top:8%;right:8%;bottom:8%;left:8%;display:flex;align-items:center;justify-content:center}
.f .pic .pb{transform:scale(1.25);filter:blur(40px) saturate(1.2) brightness(.55)}
.f .pic .ps{display:block;max-width:100%;max-height:100%;border-radius:22px;box-shadow:0 24px 60px rgba(0,0,0,.45),0 0 0 1.5px rgba(255,255,255,.08)}
.dark .f .pic.contain{background-color:#2c2c2e}
.dark.lite .f{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.07)!important}
`;
/* размеры текста карточки умножаются на --fz (его ставит fitText). zoom не используем:
   в WebView 74 на приставке он ломает раскладку и замеры */
TV.cssFz = css => css.replace(/font-size:(\d+(?:\.\d+)?)px/g, 'font-size:calc($1px * var(--fz,1))')
  .replace('.ic{width:80px;height:80px;', '.ic{width:calc(80px * var(--fz,1));height:calc(80px * var(--fz,1));')
  .replace('.ic svg{width:44px;height:44px}', '.ic svg{width:calc(44px * var(--fz,1));height:calc(44px * var(--fz,1))}')
  .replace('.top .ic{margin-right:22px}', '.top .ic{margin-right:calc(22px * var(--fz,1))}');
TV.injectCSS = () => { if (document.getElementById('tv-core-css')) return; const s = document.createElement('style'); s.id = 'tv-core-css'; s.textContent = TV.cssFz(TV.CSS); document.head.appendChild(s); };

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
TV.esc = esc;
const isNum = s => /^\d[\d\s]*$/.test(String(s||'').trim());
TV.isNum = isNum;
const isLight = hex => { const h = String(hex||'').replace('#',''); if (h.length < 6) return false; const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16); return (r*299 + g*587 + b*114) / 1000 > 170; };
const TAG = '<svg class="deco" viewBox="44 60 50 50" fill="currentColor"><path d="M70.4 60.3C76.3 60.2 82.3 60.6 88.2 60.4C90.2 60.7 91.7 62.3 92 64.3C91.8 70.3 92.3 76.3 92.1 82.3C92.1 83.7 91.7 85.1 91 86.3C84.3 93.5 77.2 100.4 70.1 107.2C68.3 108.3 66.4 108 64.8 106.7C59.6 101.5 54.3 96.3 49.2 91.1C45.6 87.4 42.7 85.6 47.1 80.7C52.9 74.4 59.6 68.7 65.5 62.4C66.8 61.2 68.6 60.4 70.4 60.3"/></svg>';
const LIST_COLORS = ['purple','indigo','orange','red','blue','green','teal','pink'];
const LIST_ICONS = { 'dtf':'printer','вышив':'needle','3d':'cube','накле':'car','авто':'car','вывес':'sign','таблич':'sign','топпер':'cup','футбол':'shirt' };
const listIcon = t => { const l = t.toLowerCase(); for (const k in LIST_ICONS) if (l.includes(k)) return LIST_ICONS[k]; return 'check'; };

TV.WX={sun:'<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="13" fill="#ffcc00"/><g stroke="#ffcc00" stroke-width="4" stroke-linecap="round"><path d="M32 5v7M32 52v7M5 32h7M52 32h7M13 13l5 5M46 46l5 5M13 51l5-5M46 18l5-5"/></g></svg>',
 cloud:'<svg viewBox="0 0 64 64"><circle cx="24" cy="26" r="10" fill="#ffcc00"/><path d="M20 50h28a10 10 0 0 0 0-20 14 14 0 0 0-27 3A8.5 8.5 0 0 0 20 50z" fill="#c7c7cc"/></svg>',
 overcast:'<svg viewBox="0 0 64 64"><path d="M16 48h32a11 11 0 0 0 0-22 15 15 0 0 0-29 3A9.5 9.5 0 0 0 16 48z" fill="#aeaeb2"/></svg>',
 snow:'<svg viewBox="0 0 64 64"><path d="M16 38h32a10 10 0 0 0 0-20 14 14 0 0 0-27 3A8.5 8.5 0 0 0 16 38z" fill="#aeaeb2"/><g fill="#5ac8fa"><circle cx="22" cy="48" r="3"/><circle cx="34" cy="52" r="3"/><circle cx="46" cy="48" r="3"/></g></svg>',
 rain:'<svg viewBox="0 0 64 64"><path d="M16 38h32a10 10 0 0 0 0-20 14 14 0 0 0-27 3A8.5 8.5 0 0 0 16 38z" fill="#aeaeb2"/><g stroke="#007aff" stroke-width="4" stroke-linecap="round"><path d="M22 44l-3 8M34 44l-3 8M46 44l-3 8"/></g></svg>',
 fog:'<svg viewBox="0 0 64 64"><g stroke="#aeaeb2" stroke-width="5" stroke-linecap="round"><path d="M12 24h40M8 34h48M14 44h36"/></g></svg>'};
TV.wmo=function(c){if(c===0)return['sun','Ясно'];if(c<=2)return['cloud','Малооблачно'];if(c===3)return['overcast','Пасмурно'];
 if(c<=48)return['fog','Туман'];if(c<=67||(c>=80&&c<=82))return['rain','Дождь'];if(c<=77||c===85||c===86)return['snow','Снег'];return['rain','Гроза']}

/* ---------- QR-код рисуется прямо на экране (без сторонних сервисов): байтовый режим, коррекция M ---------- */
TV.qr = (function(){
  const ECC = [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28];
  const BLK = [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];
  const raw = v => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
  const dataCw = v => Math.floor(raw(v) / 8) - ECC[v] * BLK[v];
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 255; };
  const divisor = d => { const r = new Array(d).fill(0); r[d - 1] = 1; let root = 1; for (let i = 0; i < d; i++) { for (let j = 0; j < d; j++) { r[j] = mul(r[j], root); if (j + 1 < d) r[j] ^= r[j + 1]; } root = mul(root, 2); } return r; };
  const rem = (data, dv) => { const r = new Array(dv.length).fill(0); for (const b of data) { const f = b ^ r.shift(); r.push(0); for (let i = 0; i < dv.length; i++) r[i] ^= mul(dv[i], f); } return r; };
  const alignPos = (v, size) => { if (v === 1) return []; const n = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2; const r = [6]; for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p); return r; };
  return function(text){
    const bytes = Array.from(typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text) : unescape(encodeURIComponent(text)).split('').map(c => c.charCodeAt(0)));
    let v = 1; for (; v <= 40; v++) { if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCw(v) * 8) break; } if (v > 40) return '';
    const bits = []; const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
    const cap = dataCw(v) * 8; put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
    for (let p = 0xEC; bits.length < cap; p ^= 0xEC ^ 0x11) put(p, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    // коррекция ошибок и перемешивание блоков
    const nb = BLK[v], el = ECC[v], rc = Math.floor(raw(v) / 8), ns = nb - rc % nb, sl = Math.floor(rc / nb), dv = divisor(el), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) { const d = data.slice(k, k + sl - el + (i < ns ? 0 : 1)); k += d.length; const e = rem(d, dv); if (i < ns) d.push(0); blocks.push(d.concat(e)); }
    const cw = []; for (let i = 0; i < blocks[0].length; i++) for (let j = 0; j < blocks.length; j++) if (i !== sl - el || j >= ns) cw.push(blocks[j][i]);
    // поле
    const size = v * 4 + 17, m = [], fn = []; for (let y = 0; y < size; y++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    const sf = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { sf(6, i, i % 2 === 0); sf(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([x, y]) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy; if (xx >= 0 && xx < size && yy >= 0 && yy < size) sf(xx, yy, d !== 2 && d !== 4); } });
    const ap = alignPos(v, size), na = ap.length;
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) { if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sf(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
    const fmt = mask => { const d = (0 << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); const b = ((d << 10) | r) ^ 0x5412, g = i => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) sf(8, i, g(i)); sf(8, 7, g(6)); sf(8, 8, g(7)); sf(7, 8, g(8)); for (let i = 9; i < 15; i++) sf(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) sf(size - 1 - i, 8, g(i)); for (let i = 8; i < 15; i++) sf(8, size - 15 + i, g(i)); sf(8, size - 8, true); };
    fmt(0);
    if (v >= 7) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25); const b = (v << 12) | r; for (let i = 0; i < 18; i++) { const bt = ((b >>> i) & 1) !== 0, a = size - 11 + i % 3, c = Math.floor(i / 3); sf(a, c, bt); sf(c, a, bt); } }
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) { const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && bi < cw.length * 8) { m[y][x] = ((cw[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; } } }
    const inv = (mask, x, y) => [ (x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, x * y % 2 + x * y % 3 === 0, (x * y % 2 + x * y % 3) % 2 === 0, ((x + y) % 2 + x * y % 3) % 2 === 0 ][mask];
    const apply = mask => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && inv(mask, x, y)) m[y][x] = !m[y][x]; };
    const penalty = () => { let p = 0, dark = 0;
      for (let a = 0; a < 2; a++) for (let i = 0; i < size; i++) { let run = 1; for (let j = 1; j <= size; j++) { const c = j < size && (a ? m[j][i] === m[j - 1][i] : m[i][j] === m[i][j - 1]); if (c) run++; else { if (run >= 5) p += run - 2; run = 1; } } }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) dark++;
      return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10; };
    let best = 0, bp = Infinity;
    for (let k = 0; k < 8; k++) { apply(k); fmt(k); const pn = penalty(); if (pn < bp) { bp = pn; best = k; } apply(k); }
    apply(best); fmt(best);
    let d = ''; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) d += `M${x + 2} ${y + 2}h1v1h-1z`;
    const s = size + 4;
    return `<svg class="qrs" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  };
})();

/* ---------- карта Казахстана: контур (упрощённый) и города ---------- */
TV.KZ_BORDER = [[49.2,46.4],[48.6,47.5],[46.6,48.4],[47.1,49.2],[46.8,49.9],[47.6,50.4],[48.7,50.6],[49.4,51.1],[50.8,51.7],[52.4,51.7],[54.5,51.0],[55.7,50.6],[57.5,51.1],[58.7,51.0],[59.5,50.6],[60.9,50.8],[61.6,51.3],[60.1,51.9],[61.0,52.9],[62.1,53.0],[61.2,53.4],[61.1,53.9],[62.6,54.0],[65.2,54.3],[68.2,54.9],[69.1,55.4],[70.8,55.3],[71.2,54.3],[72.2,54.4],[73.5,53.9],[76.4,54.2],[77.9,53.3],[79.1,52.5],[80.1,51.4],[81.5,50.8],[83.1,51.0],[84.0,50.4],[85.0,50.0],[86.2,49.5],[87.3,49.1],[86.6,48.6],[85.6,48.0],[85.5,47.1],[83.1,47.2],[82.3,45.5],[80.0,45.0],[80.4,43.1],[80.2,42.1],[78.6,42.8],[76.0,42.9],[74.5,43.1],[73.5,42.5],[71.8,42.8],[70.9,42.3],[69.1,41.4],[68.4,40.7],[67.9,41.2],[66.6,41.2],[66.0,42.9],[64.5,43.6],[62.0,43.5],[61.0,44.4],[58.6,45.6],[56.0,45.0],[56.0,41.3],[55.0,41.3],[53.0,42.1],[52.5,41.8],[52.7,42.6],[51.3,43.2],[50.3,44.3],[50.9,44.6],[51.4,45.4],[53.0,45.3],[53.2,46.7],[51.2,47.0],[49.2,46.4]];
TV.KZ_CITIES = { 'алматы':[76.95,43.24],'астана':[71.43,51.13],'нур-султан':[71.43,51.13],'шымкент':[69.6,42.32],'караганда':[73.1,49.8],'караганды':[73.1,49.8],'актобе':[57.17,50.28],'тараз':[71.37,42.9],'павлодар':[76.95,52.29],
  'усть-каменогорск':[82.6,49.95],'оскемен':[82.6,49.95],'өскемен':[82.6,49.95],'семей':[80.23,50.41],'семипалатинск':[80.23,50.41],'атырау':[51.88,47.1],'костанай':[63.62,53.21],'кызылорда':[65.5,44.85],'уральск':[51.37,51.23],'орал':[51.37,51.23],
  'петропавловск':[69.15,54.87],'актау':[51.17,43.65],'темиртау':[72.96,50.06],'туркестан':[68.25,43.3],'кокшетау':[69.39,53.28],'талдыкорган':[78.37,45.02],'экибастуз':[75.32,51.72],'жезказган':[67.71,47.78],'балхаш':[74.98,46.85],
  'конаев':[77.07,43.87],'капшагай':[77.07,43.87],'каскелен':[76.62,43.2],'рудный':[63.12,52.96],'сатпаев':[67.53,47.9],'аксу':[76.5,52.04],'степногорск':[71.89,52.35],'щучинск':[70.2,52.93],'жанаозен':[52.8,43.34],'кульсары':[53.97,46.95],
  'талгар':[77.24,43.3],'есик':[77.45,43.36],'риддер':[83.51,50.34],'аягоз':[80.44,47.97],'лисаковск':[62.49,52.54],'арыс':[68.8,42.43],'жаркент':[80.0,44.17],'шахтинск':[72.59,49.71],'сарань':[72.85,49.79],'байконур':[63.31,45.62],
  'кентау':[68.51,43.52],'хромтау':[58.44,50.25],'косшы':[71.55,51.0],'зыряновск':[84.27,49.73],'алтай':[84.27,49.73],'текели':[78.82,44.83],'житикара':[61.2,52.19],'аральск':[61.67,46.8],'приозерск':[73.72,46.04],'курчатов':[78.54,50.76] };
TV.kzTown = n => { const k = String(n || '').toLowerCase().replace(/ё/g, 'е').replace(/^(г\.|город|с\.|п\.)\s*/, '').replace(/\s*(г\.|город)$/, '').trim(); return TV.KZ_CITIES[k] || TV.KZ_CITIES[k.split(/[\s,(]/)[0]] || null; };
TV.kzMap = (towns) => {
  const W = 1000, lon0 = 46.2, lon1 = 87.6, lat0 = 40.4, lat1 = 55.6, k = Math.cos(48 * Math.PI / 180);
  const sx = (W - 20) / ((lon1 - lon0) * k), H = Math.round((lat1 - lat0) * sx + 20);
  const P = ([lo, la]) => [10 + (lo - lon0) * k * sx, 10 + (lat1 - la) * sx];
  const path = TV.KZ_BORDER.map((p, i) => (i ? 'L' : 'M') + P(p).map(v => v.toFixed(1)).join(' ')).join('') + 'Z';
  const home = P(TV.KZ_CITIES['павлодар']); let max = 1; const pts = [];
  Object.keys(towns || {}).forEach(t => { const c = TV.kzTown(t); if (!c) return; const n = +towns[t] || 0; if (!n) return; const p = P(c); const ex = pts.find(q => Math.abs(q.p[0] - p[0]) < 1 && Math.abs(q.p[1] - p[1]) < 1); if (ex) ex.n += n; else pts.push({ p, n }); });
  pts.forEach(q => max = Math.max(max, q.n)); pts.sort((a, b) => a.n - b.n);
  const arcs = pts.filter(q => Math.hypot(q.p[0] - home[0], q.p[1] - home[1]) > 8).map(q => { const mx = (q.p[0] + home[0]) / 2, my = (q.p[1] + home[1]) / 2 - Math.hypot(q.p[0] - home[0], q.p[1] - home[1]) * .22;
    return `<path d="M${home[0].toFixed(1)} ${home[1].toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${q.p[0].toFixed(1)} ${q.p[1].toFixed(1)}" class="kza" style="opacity:${(.25 + .55 * Math.sqrt(q.n / max)).toFixed(2)}"/>`; }).join('');
  const dots = pts.map(q => { const r = 6 + 20 * Math.sqrt(q.n / max); return `<circle cx="${q.p[0].toFixed(1)}" cy="${q.p[1].toFixed(1)}" r="${(r * 1.9).toFixed(1)}" class="kzg"/><circle cx="${q.p[0].toFixed(1)}" cy="${q.p[1].toFixed(1)}" r="${r.toFixed(1)}" class="kzd"/>`; }).join('');
  return `<svg class="kzsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${path}" class="kzb"/>${arcs}${dots}<circle cx="${home[0].toFixed(1)}" cy="${home[1].toFixed(1)}" r="13" class="kzh"/><circle cx="${home[0].toFixed(1)}" cy="${home[1].toFixed(1)}" r="5" fill="#fff"/></svg>`;
};

/* ---------- карточки-контакты: QR, Wi-Fi, Instagram, WhatsApp, почта ----------
   единая вёрстка: логотип и подпись сверху, QR слева, крупно — ник/номер/почта, ниже пояснение.
   Все размеры считаются от размера QR (--q), а он — от размера карточки (TV.fitText), поэтому
   в любых карточках пропорции одинаковые и текст не скачет. */
const SVG = (p, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra || ''}>${p}</svg>`;
TV.CONTACT = {
  qr:    { name: 'QR-код', bg: '', ic: SVG('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'), color: '#0a84ff', label: 'Наведите камеру телефона', cap: 'откроется ссылка' },
  wifi:  { name: 'Wi-Fi', bg: 'linear-gradient(135deg,#0a84ff,#5e5ce6)', ic: SVG('<path d="M2 8.8a15 15 0 0 1 20 0M5 12.6a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1.1" fill="currentColor"/>'), color: '#0a84ff', label: 'Бесплатный Wi-Fi', cap: 'Наведите камеру — и вы в сети' },
  insta: { name: 'Instagram', bg: 'linear-gradient(135deg,#f9a33b 0%,#ee2a7b 45%,#9b30c8 75%,#5b51d8 100%)', ic: SVG('<rect x="3" y="3" width="18" height="18" rx="5.2"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.4" cy="6.6" r="1.15" fill="currentColor" stroke="none"/>'), color: '#d62976', label: 'Мы в Instagram', cap: 'Работы, новинки и акции' },
  wa:    { name: 'WhatsApp', bg: 'linear-gradient(135deg,#25d366,#0e9f6e)', ic: SVG('<path d="M3.6 20.4l1.4-4.3a8.6 8.6 0 1 1 3.1 3z"/><path d="M8.8 8.2c.2-.6.6-.7 1-.7h.5l1 2.3-.8 1c.6 1.2 1.6 2.2 2.8 2.8l1-.8 2.3 1v.5c0 .4-.2.8-.7 1-2.9 1-7.7-3.8-7.1-7.1z" fill="currentColor" stroke="none"/>'), color: '#12b76a', label: 'Напишите нам в WhatsApp', cap: 'Наведите камеру — откроется чат' },
  mail:  { name: 'Почта', bg: 'linear-gradient(135deg,#3a8dff,#1d4ed8)', ic: SVG('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/>'), color: '#1d4ed8', label: 'Наша почта', cap: 'Наведите камеру — откроется письмо' }
};
TV.instaUser = v => String(v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[\/?#].*$/, '');
TV.waDigits = v => { let d = String(v || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); if (d.length === 10) d = '7' + d; return d; };
TV.phoneFmt = d => d.length === 11 ? `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : (d ? '+' + d : '');
TV.contactParts = (f, k) => {
  const C = TV.CONTACT[k]; let link = '', title = '', cap = f.caption || C.cap;
  if (k === 'qr') { link = String(f.qrUrl || '').trim(); title = f.title || (link ? link.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : 'Вставьте ссылку'); }
  else if (k === 'wifi') { const e = s => String(s || '').replace(/([\;,:"])/g, '\\$1'), ss = String(f.wifiSsid || '').trim(), open = f.wifiSec === 'nopass';
    if (ss) link = `WIFI:T:${open ? 'nopass' : 'WPA'};S:${e(ss)};${open ? '' : 'P:' + e(f.wifiPass) + ';'};`;
    title = ss || 'Название сети'; cap = (!open && f.wifiShow !== false && f.wifiPass ? `Пароль: <b>${esc(f.wifiPass)}</b><br>` : '') + esc(f.title || C.cap); }
  else if (k === 'insta') { const u = TV.instaUser(f.ct); if (u) link = 'https://instagram.com/' + u; title = u ? '@' + u : '@ваш_ник'; }
  else if (k === 'wa') { const d = TV.waDigits(f.ct); if (d) link = 'https://wa.me/' + d + (f.ctMsg ? '?text=' + encodeURIComponent(f.ctMsg) : ''); title = TV.phoneFmt(d) || '+7 ••• ••• •• ••'; }
  else if (k === 'mail') { const m = String(f.ct || '').trim(); if (m) link = 'mailto:' + m + (f.ctMsg ? '?subject=' + encodeURIComponent(f.ctMsg) : ''); title = m || 'почта@пример.kz'; }
  const qr = link ? TV.qr(link) : `<div class="qre">${esc(C.name)}</div>`;
  return { ct: k, top: '',
    body: `<div class="ctw"><div class="qri">${qr}</div><div class="ctt"><div class="top ctop"><span class="ctl" style="color:${C.color}">${C.ic}</span><span class="lt">${esc(f.label || C.label)}</span></div><div class="ctn">${esc(title)}</div><div class="ctc">${k === 'wifi' ? cap : esc(cap)}</div></div></div>` };
};

/* ---------- виджеты: погода, часы, «сейчас играет» ---------- */
TV.LIVE = { wx: {}, track: null };   // живые данные: погода по городам, текущий трек
TV.WIDGETS = { '': 'Обычная карточка', weather: 'Погода', clock: 'Часы', music: 'Сейчас играет', kzmap: 'Карта доставок Kaspi', qr: 'QR-код (любая ссылка)', insta: 'Instagram', wa: 'WhatsApp', mail: 'Почта', wifi: 'Wi-Fi для гостей', fx: 'Курс валют', countdown: 'Обратный отсчёт', goal: 'Цель с прогрессом' };
TV.FX_NAMES = { USD: 'Доллар', EUR: 'Евро', RUB: 'Рубль', CNY: 'Юань', KGS: 'Сом', UZS: 'Сум', TRY: 'Лира', AED: 'Дирхам', GBP: 'Фунт' };
const DAYS = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'], DAYS_FULL = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const deg = t => (t > 0 ? '+' : t < 0 ? '−' : '') + Math.abs(Math.round(t)) + '°';
TV.wxKey = f => (+f.wlat || 52.2873).toFixed(2) + ',' + (+f.wlon || 76.9674).toFixed(2);
TV.nowKz = () => { const d = new Date(Date.now() + (new Date().getTimezoneOffset() + 300) * 60000); return d; };   // время Павлодара, UTC+5
TV.widgetParts = (f, hero) => {
  const k = f.kind;
  if (k === 'weather') {
    const w = TV.LIVE.wx[TV.wxKey(f)];
    const top = `<div class="top"><span class="ic wxic">${w ? TV.WX[TV.wmo(w.code)[0]] : TV.WX.cloud}</span><span class="lt">${esc(f.wcity || 'Павлодар')}</span></div>`;
    let body = `<div class="wxn"><div class="h wxt">${w ? deg(w.t) : '—'}</div><div class="t">${w ? TV.wmo(w.code)[1] : 'Загружаю погоду…'}</div></div>`;
    if (w && f.wmode !== 'now' && w.days && w.days.length) body += `<div class="wxd">${w.days.slice(1, hero ? 6 : 4).map(d => `<div><span>${DAYS[new Date(d.d + 'T12:00:00').getDay()]}</span><i>${TV.WX[TV.wmo(d.code)[0]]}</i><b>${deg(d.max)}</b><small>${deg(d.min)}</small></div>`).join('')}</div>`;
    return { top, body };
  }
  if (k === 'clock') {
    const d = TV.nowKz(), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return { top: `<div class="top"><span class="lt">${DAYS_FULL[d.getDay()]}</span></div>`, body: `<div class="h clk">${hm}</div><div class="t">${d.getDate()} ${MONTHS[d.getMonth()]}</div>` };
  }
  if (k === 'kzmap') {   // карта доставок Kaspi: города из учёта, дуги из Павлодара
    const towns = (TV.AUTO && TV.AUTO.towns) || {}, list = Object.keys(towns).map(t => [t, +towns[t] || 0]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
    const total = list.reduce((s, x) => s + x[1], 0), cities = list.length, n = v => v.toLocaleString('ru-RU');
    const pl = (v, a, b, c2) => v % 10 === 1 && v % 100 !== 11 ? a : v % 10 >= 2 && v % 10 <= 4 && (v % 100 < 10 || v % 100 >= 20) ? b : c2;
    const top = list.slice(0, hero ? 4 : 3).map(x => `<div class="kzt"><span>${esc(x[0])}</span><b>${n(x[1])}</b></div>`).join('');
    return { top: `<div class="top"><span class="lt">${esc(f.label || 'Доставили по Казахстану')}</span></div>`,
      body: `<div class="kzw"><div class="kzm">${TV.kzMap(towns)}</div><div class="kzs">${cities ? `<div class="h kzn">${n(cities)}</div><div class="t">${pl(cities, 'город', 'города', 'городов')} · ${n(total)} ${pl(total, 'заказ', 'заказа', 'заказов')}</div><div class="kzl">${top}</div>` : `<div class="t">Города появятся, когда учёт студии обновит данные Kaspi</div>`}${f.caption ? `<div class="cap">${esc(f.caption)}</div>` : ''}</div></div>` };
  }
  if (TV.CONTACT[k]) return TV.contactParts(f, k);
  if (k === 'fx') {
    const r = TV.LIVE.fx || {}, list = String(f.fxList || 'USD,EUR,RUB').toUpperCase().split(/[\s,;]+/).filter(Boolean).slice(0, 5);
    const fmt = v => v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1).replace('.', ',') : v.toFixed(2).replace('.', ',');
    return { top: `<div class="top"><span class="lt">${esc(f.label || 'Курс тенге')}</span></div>`,
      body: `<div class="fxl">${list.map(c => `<div class="fxr"><span><b>${esc(c)}</b> ${esc(TV.FX_NAMES[c] || '')}</span><i>${r[c] ? fmt(r[c]) + ' ₸' : '—'}</i></div>`).join('')}</div>` };
  }
  if (k === 'countdown') {
    const end = f.cdDate ? new Date(f.cdDate + (f.cdDate.length <= 10 ? 'T00:00' : '') + ':00+05:00') : null, ms = end ? end - Date.now() : NaN;
    let big = '—', sub = f.title || '';
    if (!isNaN(ms) && ms > 0) { const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
      const pl = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c;
      big = d >= 1 ? d + ' ' + pl(d, 'день', 'дня', 'дней') + (d < 3 ? ' ' + h + ' ч' : '') : h + ' ч ' + m + ' мин'; }
    else if (!isNaN(ms)) { big = f.caption || 'Уже началось!'; sub = ''; }
    return { top: `<div class="top"><span class="lt">${esc(f.label || 'Осталось')}</span></div>`, body: `<div class="h cdn">${esc(big)}</div>${sub ? `<div class="t">${esc(sub)}</div>` : ''}` };
  }
  if (k === 'goal') {
    const cur = TV.value(f), to = Math.max(1, +String(f.goalTo).replace(/\s/g, '') || 1), pc = Math.max(0, Math.min(100, cur / to * 100));
    const n = v => Math.round(v).toLocaleString('ru-RU');
    return { top: `<div class="top"><span class="lt">${esc(f.label || 'Наша цель')}</span></div>`,
      body: `<div class="h gln">${n(cur)} <small>из ${n(to)}</small></div><div class="glb"><i style="width:${pc.toFixed(1)}%"></i></div><div class="t">${esc(f.title || (cur >= to ? 'Цель достигнута!' : 'осталось ' + n(to - cur)))}</div>` };
  }
  if (k === 'music') {
    const t = TV.LIVE.track || {};
    return { top: `<div class="top"><span class="lt">${esc(f.label || 'Сейчас играет')}</span></div>`,
      body: `<div class="h mus">${esc(t.title || 'Музыка')}</div><div class="t">${esc(t.artist || 'Яндекс Музыка')}</div>`, cover: t.cover || '' };
  }
  return null;
};

TV.factHTML = (f, hero, idx, gx) => {
  const col = TV.col(f.color) || TV.col('blue');
  const bgPhoto = f.photo && f.photoMode === 'bg';
  const cls = ['f', 'st-' + (TV.STYLES[f.style] ? f.style : 'plain')];
  let style = idx != null ? `--i:${idx};` : '';
  if (hero) cls.push('hero');
  /* свободная раскладка: ширина в % ряда; иначе доля места в ряду или колонке */
  if (gx) style += `width:calc(${Math.max(15, Math.min(100, +f.gw || 33))}% - 28px);height:calc(${(100 / gx).toFixed(3)}% - 28px);`;
  else if (+f.w && +f.w !== 1) style += `flex:${Math.max(0.5, Math.min(3, +f.w))} 1 0%;`;
  if (f.style === 'custom') { style += `background:${esc(f.bg)};`; if (isLight(f.bg)) cls.push('light-bg'); }
  const colored = ['blue','kaspi','dark'].includes(f.style) || (f.style === 'custom' && !isLight(f.bg)) || bgPhoto;
  if (colored) cls.push('on-color');
  if (['blue','kaspi','custom'].includes(f.style) && !bgPhoto) cls.push('shine');
  if (bgPhoto) cls.push('has-bg');
  if (f.fg) style += `--fg:${esc(f.fg)};--fg2:${esc(f.fg)};`;
  if (f.sizeBig && f.sizeBig !== 'auto') cls.push('sb-' + f.sizeBig);
  if (f.sizeText && f.sizeText !== 'm') cls.push('sx-' + f.sizeText);
  if (f.align && f.align !== 'left') cls.push('al-' + f.align);
  if (f.valign && f.valign !== 'between') cls.push('va-' + f.valign);
  if (bgPhoto) style += `--dim:${Math.max(0, Math.min(90, +f.dim || 0)) / 100};`;

  const wp = TV.widgetParts(f, hero);
  if (wp) {   // виджет: своё содержимое, но те же стили, цвета и размеры, что у обычных карточек
    cls.push('wdg', 'wdg-' + f.kind);
    if (wp.ct) { cls.push('ctq'); const C = TV.CONTACT[wp.ct]; if (C.bg && f.ctBrand !== false) { cls.push('on-color', 'ctbrand'); style += `background:${C.bg};color:#fff;`; } }
    let bgw = '';
    if (wp.cover && f.wcover !== false) { cls.push('has-bg', 'on-color'); bgw = `<div class="bgph" style="background-image:url('${esc(wp.cover.replace('200x200', '600x600'))}')"></div><div class="shade"></div>`; style += '--dim:.5;'; }
    return `<div class="${cls.join(' ')}" data-w="${f.kind}" style="${style}">${bgw}<div class="ft">${wp.top}</div><div class="fb">${wp.body}</div></div>`;
  }
  const photoTop = f.photo && f.photoMode === 'top';
  const vis = ['flag-it','swatch','insta'].includes(f.visual) ? f.visual : '';
  let visual = '';
  if (vis === 'flag-it') visual = '<div class="flag"><i style="background:#009246"></i><i style="background:#fff"></i><i style="background:#ce2b37"></i></div>';
  else if (vis === 'swatch') visual = `<div class="sw" style="background:${esc(f.swatch||'#fff')}"></div>`;
  else if (vis === 'insta') visual = `<div class="insta"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="#fff"/></svg></div>`;
  const icB = f.icBg ? (TV.col(f.icBg) || f.icBg) : col;
  const icon = (f.icon && !vis) ? `<span class="ic${f.icBg || f.icFg ? ' ic-set' : ''}" style="background:${esc(icB)};${f.icFg ? `color:${esc(f.icFg)};` : ''}">${TV.icon(f.icon)}</span>` : '';
  /* прозрачность текста: '' — авто; число 10..100 — текст сплошным цветом с этой непрозрачностью */
  const op = k => (f[k] === '' || f[k] == null) ? null : Math.max(0, Math.min(100, +f[k])) / 100;
  const tone = (c, o, solid) => (c || o != null) ? `color:${c ? esc(c) : 'var(--fg)'};opacity:${o != null ? o : 1};` : '';
  const cl = tone(f.cLabel, op('oLabel'));
  const labelRow = (icon || f.label) ? `<div class="top" style="${icon ? '' : 'min-height:0;'}">${icon}${f.label ? `<span class="lt" style="${cl}">${esc(f.label)}</span>` : ''}</div>` : '';
  const pic = !photoTop ? '' : f.photoFit === 'contain' ? `<div class="pic contain"><i class="pb" data-img="${esc(f.photo)}"></i><span class="pw">${f.video ? `<video class="ps" muted loop playsinline preload="auto" data-vid="${esc(f.video)}"></video>` : `<img class="ps" alt="" data-img="${esc(f.photo)}">`}</span></div>` : `<div class="pic" data-img="${esc(f.photo)}">${f.video ? `<video class="bgv" muted loop playsinline preload="auto" data-vid="${esc(f.video)}"></video>` : ''}</div>`;
  const top = photoTop ? labelRow + pic : vis ? visual + labelRow : labelRow;

  let body = '';
  if (f.big) {
    const ncol = ` style="${f.cBig ? `color:${esc(f.cBig)};` : f.numColor ? `color:${col};` : ''}${op('oBig') != null ? `opacity:${op('oBig')};` : ''}"`;
    if (isNum(f.big)) {
      const val = TV.value(f);
      body += `<div class="num" data-to="${val}" data-plus="${f.plus?1:''}" data-unit="${esc(f.unit)}"${ncol}>${val.toLocaleString('ru-RU')}${f.plus?'<small class="pl">+</small>':''}${f.unit?`<small>${esc(f.unit)}</small>`:''}</div>`;
    } else {
      body += `<div class="h${String(f.big).length > 12 ? ' long' : ''}"${ncol}>${esc(f.big)}${f.unit?` <small style="font-size:.5em;opacity:.6">${esc(f.unit)}</small>`:''}</div>`;
    }
  }
  if (f.title) body += `<div class="t" style="${f.cTitle ? `color:${esc(f.cTitle)};` : ''}${op('oTitle') != null ? `opacity:${op('oTitle')};` : ''}">${esc(f.title)}</div>`;
  if (f.caption) body += `<div class="cap" style="${tone(f.cCap, op('oCap'))}">${esc(f.caption)}</div>`;
  if (f.list) body += '<div class="list">' + String(f.list).split('\n').filter(x=>x.trim()).map((x,i)=>`<div class="li" style="--n:${i+1};${f.cList ? 'color:' + esc(f.cList) + ';' : ''}${op('oList') != null ? 'opacity:' + op('oList') : ''}"><span class="ic" style="background:${TV.col(LIST_COLORS[i%LIST_COLORS.length])}">${TV.icon(listIcon(x))}</span>${esc(x)}</div>`).join('') + '</div>';

  // отзыв: ряд звёзд над текстом, сам текст мельче и ограничен по высоте
  const nst = Math.max(0, Math.min(5, Math.round(+f.stars || 0)));
  if (nst) { cls.push('rev'); body = `<div class="stars">${'★'.repeat(nst)}<i>${'★'.repeat(5 - nst)}</i></div>` + body; }
  const deco = (colored && !bgPhoto && f.visual === 'tag') ? TAG : '';
  const bg = bgPhoto ? `<div class="bgph ${f.zoom ? 'kb' : ''}" data-img="${esc(f.photo)}"></div>${f.video ? `<video class="bgv" muted loop playsinline preload="auto" data-vid="${esc(f.video)}"></video>` : ''}<div class="shade"></div>` : '';
  const inner = photoTop ? `<div class="ft" style="display:flex;flex-direction:column;flex:1 1 auto;min-height:0">${top}</div><div class="fb">${body}</div>` : (f.list && !top) ? body : (top ? `<div class="ft">${top}</div>` : '<div></div>') + `<div class="fb">${body}</div>`;
  return `<div class="${cls.join(' ')}"${f.fg ? ' data-fg' : ''} style="${style}">${bg}${deco}${inner}</div>`;
};
/* текст подстраивается под размер карточки, как у виджетов айфона:
   если не влезает — всё содержимое плавно уменьшается (и отступы тоже), строки переносятся */
TV.fitText = (root) => {
  if (!root) return;
  [].forEach.call(root.querySelectorAll('.f:not(.shd)'), f => {
    const kids = [].filter.call(f.children, c => !/(^|\s)(bgph|bgv|shade|rzh|deco)(\s|$)/.test(c.getAttribute('class') || '') && c.tagName !== 'VIDEO');
    const set = s => { if (s >= 1) { f.style.removeProperty('--fz'); f.style.padding = ''; } else { f.style.setProperty('--fz', s.toFixed(3)); f.style.padding = Math.round(48 * Math.max(s, .5)) + 'px ' + Math.round(50 * Math.max(s, .5)) + 'px'; } };
    set(1);
    if (!kids.length || !f.clientHeight || !f.clientWidth) return;
    if (f.classList.contains('ctq')) {   // карточки-контакты: QR и текст от размера карточки, одинаковые пропорции везде
      const iw = f.clientWidth - 100, ih = f.clientHeight - 96, vert = iw < ih * 1.15;
      f.classList.toggle('ctv', vert);
      let q = vert ? Math.min(iw * .74, ih * .5) : Math.min(ih * .96, iw * .4);
      const pad = q < 230 ? Math.max(.55, q / 230) : 1;
      if (pad < 1) f.style.padding = Math.round(48 * pad) + 'px ' + Math.round(50 * pad) + 'px';
      const fits = () => { const t = f.querySelector('.ctn'), lb = f.querySelector('.ctop .lt'), fr = f.getBoundingClientRect(), last = kids[kids.length - 1].getBoundingClientRect(); return (!t || t.scrollWidth <= t.clientWidth + 2) && (!lb || lb.scrollWidth <= lb.clientWidth + 2 || q < 160) && last.bottom <= fr.bottom - 10; };
      for (let i = 0; i < 14; i++) { f.style.setProperty('--q', Math.round(q) + 'px'); if (fits() || q < 90) break; q *= .93; }
      return;
    }
    const over = () => {
      const cs = getComputedStyle(f), pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
      const fr = f.getBoundingClientRect(), k = fr.height / (f.offsetHeight || 1);   // k — масштаб сцены на экране
      if (kids[kids.length - 1].getBoundingClientRect().bottom > fr.bottom - pb * .5 * k + 2 || kids[0].getBoundingClientRect().top < fr.top + pt * .5 * k - 2) return true;
      return [].some.call(f.querySelectorAll('.ft,.fb,.top,.num,.h,.t,.cap,.lt,.list'), x => x.scrollWidth > x.clientWidth + 2 && x.clientWidth > 0);
    };
    if (!over()) return;
    let lo = .3, hi = 1;
    for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; set(m); if (over()) hi = m; else lo = m; }
    set(lo);
  });
};
TV.sceneHTML = (sc) => {
  const L = TV.LAYOUTS[sc.layout] || TV.LAYOUTS.g3, sp = (TV.SPEEDS[sc.speed] || TV.SPEEDS.normal)[1];
  const heroIdx = sc.layout === 'g12' ? 0 : sc.layout === 'g21' ? 2 : sc.layout === 'g1' ? 0 : -1;
  const list = (sc.facts||[]).slice(0, TV.cnt(sc));
  let rows = 1;   // свободная раскладка: считаем ряды, чтобы высота делилась поровну и ничего не вылезало
  if (sc.layout === 'gx') { let acc = 0; list.forEach(f => { const w = Math.max(15, Math.min(100, +f.gw || 33)); if (acc && acc + w > 100.5) { rows++; acc = 0; } acc += w; }); }
  const cards = list.map((f,i) => TV.factHTML(f, i === heroIdx, i, sc.layout === 'gx' ? rows : 0));
  const bw = Math.max(0.6, Math.min(3, +sc.bigw || 1.25));
  const c = (arr, big) => `<div class="col${big ? ' big' : ''}"${big && bw !== 1.25 ? ` style="flex:${bw} 1 0%"` : ''}>${arr.join('')}</div>`;
  const hd = String(sc.head || '').trim(), sb = String(sc.sub || '').trim();
  const head = (hd || sb) ? `<div class="f shd" style="--i:0">${hd ? `<div class="sh1"${sc.cHead ? ` style="color:${esc(sc.cHead)}"` : ''}>${esc(hd)}</div>` : ''}${sb ? `<div class="sh2">${esc(sb)}</div>` : ''}</div>` : '';
  let inner;
  if (sc.layout === 'g12') inner = c([cards[0]], true) + c([cards[1], cards[2]]);
  else if (sc.layout === 'g21') inner = c([cards[0], cards[1]]) + c([cards[2]], true);
  else if (sc.layout === 'g4') inner = c([cards[0], cards[2]]) + c([cards[1], cards[3]]);
  else inner = cards.join('');
  inner += head;
  return `<section class="scene ${sc.layout}${head ? ' has-head' : ''} an-${TV.ANIMS[sc.anim] ? sc.anim : 'spring'}" style="--sp:${sc.anim === 'none' ? 0.001 : sp};--st:${sc.stagger === false || sc.anim === 'none' ? '0s' : (0.18 * sp).toFixed(2) + 's'}">${inner}</section>`;
};
TV.countUp = (el) => {
  const to = +el.dataset.to, plus = !!el.dataset.plus, unit = el.dataset.unit;
  const tail = (plus ? '<small class="pl">+</small>' : '') + (unit ? `<small>${unit}</small>` : '');
  if (TV.LITE) { el.innerHTML = to.toLocaleString('ru-RU') + tail; return; }
  const t0 = performance.now(), d = 2200;
  (function f(t){ const p = Math.min(1,(t-t0)/d), e = 1-Math.pow(1-p,4);
    el.innerHTML = Math.round(to*e).toLocaleString('ru-RU') + (p===1 ? tail : (unit ? `<small>${unit}</small>` : ''));
    if (p<1) requestAnimationFrame(f); })(t0);
};
TV.animateIn = (sceneEl) => { TV.hydrate(sceneEl); sceneEl.classList.add('on'); TV.playVids(sceneEl, true); sceneEl.querySelectorAll('.num[data-to]').forEach(el => setTimeout(() => TV.countUp(el), 500)); };
})();
