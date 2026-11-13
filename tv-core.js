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

TV.LAYOUTS = { g1:{n:1,t:'Одна на весь экран'}, g2:{n:2,t:'Две равные'}, g3:{n:3,t:'Три равные'}, g12:{n:3,t:'Большая слева + две'}, g21:{n:3,t:'Две + большая справа'}, g4:{n:4,t:'Четыре (2×2)'} };
TV.ANIMS = { spring:'Пружина снизу', up:'Плавно снизу', fade:'Растворение', left:'Слева направо', right:'Справа налево', zoom:'Увеличение', flip:'Переворот', drop:'Падение сверху', none:'Без анимации' };
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
  big:'', unit:'', plus:false, numColor:false, title:'', caption:'', list:'',
  visual:'', swatch:'#ffffff', photo:'', photoMode:'bg', photoFit:'cover', dim:45, zoom:true,
  sizeBig:'auto', sizeText:'m', align:'left', valign:'between', cLabel:'', cBig:'', cTitle:'', cCap:'', cList:'', icBg:'', icFg:'',
  auto:'', autoFrom:0 }, o);
const S = (o) => Object.assign({ on:true, layout:'g3', anim:'spring', speed:'normal', stagger:true, sec:0, facts:[] }, o);
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
  return { slideSec: +d.slideSec || 20, fx: d.fx !== false, lite: d.lite !== false, theme: d.theme === 'light' ? 'light' : 'dark', bg: TV.normBg(d.bg), pill: { bg: (d.pill && d.pill.bg) || '', fg: (d.pill && d.pill.fg) || '' }, show,
    screens: d.screens.map(s => { const sc = S(s || {}); sc.on = s.on !== false; if (!TV.LAYOUTS[sc.layout]) sc.layout = 'g3'; if (!TV.ANIMS[sc.anim]) sc.anim = 'spring';
      const src = s.facts || []; sc.facts = [0,1,2,3].map(i => F(src[i] || (i === 3 ? TV.newFact() : {}))); return sc; }) };
};

/* ---------- фото ---------- */
TV.IMGCACHE = {};
TV.loadImg = (id) => {
  if (!id) return Promise.resolve('');
  if (TV.IMGCACHE[id]) return Promise.resolve(TV.IMGCACHE[id]);
  const db = TV.DB(); if (!db) return Promise.resolve('');
  return TV.IMGCACHE[id] = fetch(`${db}/pub/${TV.IMG}${id}/d.json`).then(r => r.json()).then(d => (TV.IMGCACHE[id] = d || '')).catch(() => { delete TV.IMGCACHE[id]; return ''; });
};
TV.hydrate = (root) => root.querySelectorAll('[data-img]').forEach(el => {
  const id = el.dataset.img; Promise.resolve(TV.IMGCACHE[id] || TV.loadImg(id)).then(u => { if (u && typeof u === 'string') { if (el.tagName === 'IMG') el.src = u; else el.style.backgroundImage = `url("${u}")`; } });
});

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

.scene{position:absolute;left:72px;right:72px;top:192px;bottom:112px;display:-webkit-box;display:flex;flex-direction:row;z-index:2;pointer-events:none;--sp:1;--st:.18s;--from:translateY(60px) scale(.94);--to:translateY(-40px) scale(.97);--ease:cubic-bezier(.2,1.25,.3,1)}
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
.col{display:flex;flex-direction:column;min-height:0}
.col>.f{flex:1 1 0%;min-height:0}
.col>*+*{margin-top:28px}
/* карточка */
.f{--fg:#1d1d1f;--fg2:#8e8e93;background:rgba(255,255,255,.62);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.95),0 14px 40px rgba(40,60,140,.08);border-radius:40px;padding:48px 50px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden;color:var(--fg);min-height:0;min-width:0}
.f>*{position:relative;z-index:1}
.f>.bgph,.f>.shade,.f>.deco{position:absolute}
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
.ic{width:80px;height:80px;border-radius:22px;display:flex;align-items:center;justify-content:center;color:#fff;flex:none}.top .ic{margin-right:22px}.ic svg{width:44px;height:44px}
.top{display:flex;align-items:center;font-size:28px;font-weight:600;color:var(--fg2);min-height:80px}
.num{display:inline-block;font-family:"Inter Tight",Inter,system-ui,sans-serif;font-weight:800;letter-spacing:-.045em;line-height:.92;font-variant-numeric:tabular-nums;font-size:150px;color:var(--fg)}
.num small{font-size:.38em;letter-spacing:-.01em;margin-left:8px;opacity:.6}.num .pl{font-size:.5em;opacity:1;margin-left:0}
.hero .num{font-size:250px}
.h{font-family:"Inter Tight",Inter,system-ui,sans-serif;font-size:64px;font-weight:800;letter-spacing:-.03em;line-height:1.02;color:var(--fg)}
.h.long{font-size:52px}.hero .h{font-size:120px}.hero .h.long{font-size:92px}
.t{font-family:"Inter Tight",Inter,system-ui,sans-serif;font-size:44px;font-weight:700;letter-spacing:-.02em;line-height:1.08;color:var(--fg)}
.num+.t,.h+.t{margin-top:18px}
.cap{font-size:27px;color:var(--fg2);font-weight:500;line-height:1.35;margin-top:14px}
.f[data-fg] .cap,.f[data-fg] .top{color:var(--fg);opacity:.8}
/* размеры */
.f.sb-s .num{font-size:96px}.f.sb-m .num{font-size:150px}.f.sb-l .num{font-size:210px}.f.sb-xl .num{font-size:280px}
.f.sb-s .h{font-size:44px}.f.sb-m .h{font-size:64px}.f.sb-l .h{font-size:92px}.f.sb-xl .h{font-size:124px}
.f.sx-s .t{font-size:32px}.f.sx-s .cap,.f.sx-s .li{font-size:22px}.f.sx-l .t{font-size:56px}.f.sx-l .cap,.f.sx-l .li{font-size:34px}.f.sx-xl .t{font-size:70px}.f.sx-xl .cap,.f.sx-xl .li{font-size:42px}
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
.lite .bgfx i{animation:none!important}
.lite .f{box-shadow:0 0 0 1.5px rgba(0,0,0,.05)!important}
.lite .f.shine::after{display:none!important}
.lite .deco,.lite .bgph.kb{animation:none!important}
.lite .scene .f,.lite .scene.on .f,.lite .scene.out .f{transform:none!important;transition:opacity .5s linear!important;transition-delay:0s!important}
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
  --l2:rgba(235,235,245,.6);--l3:rgba(235,235,245,.3);--card:#1c1c1e;--card2:#161618;--edge:rgba(255,255,255,.07)}
.dark .bgfx i{opacity:1}
.dark .bgfx i:nth-child(1){background:radial-gradient(circle,rgba(10,132,255,.16),rgba(10,132,255,0) 62%)}
.dark .bgfx i:nth-child(2){background:radial-gradient(circle,rgba(94,92,230,.14),rgba(94,92,230,0) 62%)}
.dark .bgfx i:nth-child(3){background:radial-gradient(circle,rgba(191,90,242,.08),rgba(191,90,242,0) 62%)}
.dark .bgfx i:nth-child(4){background:radial-gradient(circle,rgba(64,200,224,.08),rgba(64,200,224,0) 62%)}

.dark .f{border-radius:44px;box-shadow:inset 0 0 0 1.5px var(--edge),inset 0 1.5px 0 rgba(255,255,255,.06);--fg:#fff;--fg2:var(--l2)}
.dark .f.st-plain{background:#1c1c1e;background:linear-gradient(180deg,#202022 0%,#18181a 100%)}
.dark .f.st-white{background:#2c2c2e;background:linear-gradient(180deg,#323234 0%,#28282a 100%)}
.dark .f.st-dark{background:#000;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.12)}
.dark .f.st-blue{background:#0a84ff;background:linear-gradient(155deg,#3d9bff 0%,#0a7aff 38%,#0058d6 100%);--fg2:rgba(255,255,255,.78)}
.dark .f.st-kaspi{background:#f14635;background:linear-gradient(155deg,#ff6a5b 0%,#f2402f 40%,#c8241a 100%);--fg2:rgba(255,255,255,.8)}
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
TV.injectCSS = () => { if (document.getElementById('tv-core-css')) return; const s = document.createElement('style'); s.id = 'tv-core-css'; s.textContent = TV.CSS; document.head.appendChild(s); };

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
TV.esc = esc;
const isNum = s => /^\d[\d\s]*$/.test(String(s||'').trim());
TV.isNum = isNum;
const isLight = hex => { const h = String(hex||'').replace('#',''); if (h.length < 6) return false; const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16); return (r*299 + g*587 + b*114) / 1000 > 170; };
const TAG = '<svg class="deco" viewBox="44 60 50 50" fill="currentColor"><path d="M70.4 60.3C76.3 60.2 82.3 60.6 88.2 60.4C90.2 60.7 91.7 62.3 92 64.3C91.8 70.3 92.3 76.3 92.1 82.3C92.1 83.7 91.7 85.1 91 86.3C84.3 93.5 77.2 100.4 70.1 107.2C68.3 108.3 66.4 108 64.8 106.7C59.6 101.5 54.3 96.3 49.2 91.1C45.6 87.4 42.7 85.6 47.1 80.7C52.9 74.4 59.6 68.7 65.5 62.4C66.8 61.2 68.6 60.4 70.4 60.3"/></svg>';
const LIST_COLORS = ['purple','indigo','orange','red','blue','green','teal','pink'];
const LIST_ICONS = { 'dtf':'printer','вышив':'needle','3d':'cube','накле':'car','авто':'car','вывес':'sign','таблич':'sign','топпер':'cup','футбол':'shirt' };
const listIcon = t => { const l = t.toLowerCase(); for (const k in LIST_ICONS) if (l.includes(k)) return LIST_ICONS[k]; return 'check'; };

TV.factHTML = (f, hero, idx) => {
  const col = TV.col(f.color) || TV.col('blue');
  const bgPhoto = f.photo && f.photoMode === 'bg';
  const cls = ['f', 'st-' + (TV.STYLES[f.style] ? f.style : 'plain')];
  let style = idx != null ? `--i:${idx};` : '';
  if (hero) cls.push('hero');
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

  const photoTop = f.photo && f.photoMode === 'top';
  const vis = ['flag-it','swatch','insta'].includes(f.visual) ? f.visual : '';
  let visual = '';
  if (vis === 'flag-it') visual = '<div class="flag"><i style="background:#009246"></i><i style="background:#fff"></i><i style="background:#ce2b37"></i></div>';
  else if (vis === 'swatch') visual = `<div class="sw" style="background:${esc(f.swatch||'#fff')}"></div>`;
  else if (vis === 'insta') visual = `<div class="insta"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="#fff"/></svg></div>`;
  const icB = f.icBg ? (TV.col(f.icBg) || f.icBg) : col;
  const icon = (f.icon && !vis) ? `<span class="ic${f.icBg || f.icFg ? ' ic-set' : ''}" style="background:${esc(icB)};${f.icFg ? `color:${esc(f.icFg)};` : ''}">${TV.icon(f.icon)}</span>` : '';
  const cl = f.cLabel ? `color:${esc(f.cLabel)};opacity:1;` : '';
  const labelRow = (icon || f.label) ? `<div class="top" style="${icon ? '' : 'min-height:0;'}${cl}">${icon}${esc(f.label)}</div>` : '';
  const pic = !photoTop ? '' : f.photoFit === 'contain' ? `<div class="pic contain"><i class="pb" data-img="${esc(f.photo)}"></i><span class="pw"><img class="ps" alt="" data-img="${esc(f.photo)}"></span></div>` : `<div class="pic" data-img="${esc(f.photo)}"></div>`;
  const top = photoTop ? labelRow + pic : vis ? visual + labelRow : labelRow;

  let body = '';
  if (f.big) {
    const ncol = f.cBig ? ` style="color:${esc(f.cBig)}"` : f.numColor ? ` style="color:${col}"` : '';
    if (isNum(f.big)) {
      const val = TV.value(f);
      body += `<div class="num" data-to="${val}" data-plus="${f.plus?1:''}" data-unit="${esc(f.unit)}"${ncol}>${val.toLocaleString('ru-RU')}${f.plus?'<small class="pl">+</small>':''}${f.unit?`<small>${esc(f.unit)}</small>`:''}</div>`;
    } else {
      body += `<div class="h${String(f.big).length > 12 ? ' long' : ''}"${ncol}>${esc(f.big)}${f.unit?` <small style="font-size:.5em;opacity:.6">${esc(f.unit)}</small>`:''}</div>`;
    }
  }
  if (f.title) body += `<div class="t"${f.cTitle ? ` style="color:${esc(f.cTitle)}"` : ''}>${esc(f.title)}</div>`;
  if (f.caption) body += `<div class="cap"${f.cCap ? ` style="color:${esc(f.cCap)};opacity:1"` : ''}>${esc(f.caption)}</div>`;
  if (f.list) body += '<div class="list">' + String(f.list).split('\n').filter(x=>x.trim()).map((x,i)=>`<div class="li" style="--n:${i+1};${f.cList ? 'color:' + esc(f.cList) : ''}"><span class="ic" style="background:${TV.col(LIST_COLORS[i%LIST_COLORS.length])}">${TV.icon(listIcon(x))}</span>${esc(x)}</div>`).join('') + '</div>';

  const deco = (colored && !bgPhoto && f.visual === 'tag') ? TAG : '';
  const bg = bgPhoto ? `<div class="bgph ${f.zoom ? 'kb' : ''}" data-img="${esc(f.photo)}"></div><div class="shade"></div>` : '';
  const inner = photoTop ? `<div class="ft" style="display:flex;flex-direction:column;flex:1 1 auto;min-height:0">${top}</div><div class="fb">${body}</div>` : (f.list && !top) ? body : (top ? `<div class="ft">${top}</div>` : '<div></div>') + `<div class="fb">${body}</div>`;
  return `<div class="${cls.join(' ')}"${f.fg ? ' data-fg' : ''} style="${style}">${bg}${deco}${inner}</div>`;
};
TV.sceneHTML = (sc) => {
  const L = TV.LAYOUTS[sc.layout] || TV.LAYOUTS.g3, sp = (TV.SPEEDS[sc.speed] || TV.SPEEDS.normal)[1];
  const heroIdx = sc.layout === 'g12' ? 0 : sc.layout === 'g21' ? 2 : sc.layout === 'g1' ? 0 : -1;
  const cards = (sc.facts||[]).slice(0, L.n).map((f,i) => TV.factHTML(f, i === heroIdx, i));
  const c = (arr, big) => `<div class="col${big ? ' big' : ''}">${arr.join('')}</div>`;
  let inner;
  if (sc.layout === 'g12') inner = c([cards[0]], true) + c([cards[1], cards[2]]);
  else if (sc.layout === 'g21') inner = c([cards[0], cards[1]]) + c([cards[2]], true);
  else if (sc.layout === 'g4') inner = c([cards[0], cards[2]]) + c([cards[1], cards[3]]);
  else inner = cards.join('');
  return `<section class="scene ${sc.layout} an-${TV.ANIMS[sc.anim] ? sc.anim : 'spring'}" style="--sp:${sc.anim === 'none' ? 0.001 : sp};--st:${sc.stagger === false || sc.anim === 'none' ? '0s' : (0.18 * sp).toFixed(2) + 's'}">${inner}</section>`;
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
TV.animateIn = (sceneEl) => { TV.hydrate(sceneEl); sceneEl.classList.add('on'); sceneEl.querySelectorAll('.num[data-to]').forEach(el => setTimeout(() => TV.countUp(el), 500)); };
})();
