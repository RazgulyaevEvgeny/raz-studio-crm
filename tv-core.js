/* tv-core.js — общий движок экрана: стили карточек, иконки, данные по умолчанию и отрисовка.
   Используется и экраном (tv.html), и админкой (tv-admin.html) для предпросмотра. */
(function(){
const TV = window.TV = {};

/* Где лежат факты: Realtime Database CRM, раздел pub/<ключ> (читать может любой, кто знает ключ; писать — только сотрудники) */
TV.KEY = 'tvfacts_DdZ6xJoCLMkvw8lKZPyGDcoAOB1JNmrA';

TV.COLORS = { blue:'#007aff', indigo:'#5856d6', purple:'#af52de', pink:'#ff2d55', red:'#ff3b30', orange:'#ff9500', yellow:'#ffcc00', green:'#34c759', teal:'#30b0c7', gray:'#8e8e93', black:'#1d1d1f' };
TV.COLOR_NAMES = { blue:'Синий', indigo:'Индиго', purple:'Фиолетовый', pink:'Розовый', red:'Красный', orange:'Оранжевый', yellow:'Жёлтый', green:'Зелёный', teal:'Бирюзовый', gray:'Серый', black:'Чёрный' };

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
};
TV.icon = (name, size) => TV.ICONS[name] ? `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"${size?` width="${size}" height="${size}"`:''}>${TV.ICONS[name]}</svg>` : '';

/* ---------- данные по умолчанию (пока в базе ничего нет) ---------- */
const F = (o) => Object.assign({ style:'plain', icon:'', color:'blue', label:'', big:'', unit:'', plus:false, numColor:false, title:'', caption:'', visual:'', swatch:'#ffffff', list:'' }, o);
TV.DEFAULT = { slideSec: 20, screens: [
  { on:true, layout:'g12', facts:[
    F({style:'blue', label:'Спасибо, что выбираете нас', big:'1500', plus:true, title:'заказов студии выполнено', visual:'tag'}),
    F({style:'kaspi', icon:'bag', label:'Наш магазин на Kaspi', big:'2000', plus:true, caption:'заказов доставили по всему Казахстану'}),
    F({icon:'users', color:'green', label:'Клиенты', big:'900', plus:true, caption:'возвращаются к нам снова'}) ]},
  { on:true, layout:'g12', facts:[
    F({style:'blue', icon:'calendar', label:'Наша история', big:'С февраля 2025', caption:'а всё началось с одной вышивальной машинки', visual:'tag'}),
    F({icon:'star', color:'purple', label:'Хиты студии', title:'Чаще всего заказывают DTF-принты и вышивку'}),
    F({icon:'gift', color:'pink', label:'Любимые заказы', title:'Подарки', caption:'Нет ничего приятнее, чем видеть, как ваш подарок радует других'}) ]},
  { on:true, layout:'g3', facts:[
    F({icon:'needle', color:'indigo', label:'Вышивка', big:'200', unit:'км', title:'вышивальной нити уже в стежках', caption:'длиннее дороги от Павлодара до Экибастуза'}),
    F({visual:'flag-it', big:'Итальянские нити', caption:'Яркие, прочные, не выцветают после стирок'}),
    F({icon:'printer', color:'purple', label:'DTF-печать', big:'150', numColor:true, title:'стирок выдерживает принт', caption:'не трескается и не линяет'}) ]},
  { on:true, layout:'g3', facts:[
    F({icon:'needle', color:'indigo', label:'Вышивка логотипа', big:'12000', title:'стежков в одном логотипе', caption:'и 1,5–2 часа работы машинки'}),
    F({icon:'cup', color:'orange', label:'Кофейный топпер', big:'35', unit:'мин', title:'печатается один топпер'}),
    F({icon:'steam', color:'blue', label:'Наша гордость', title:'Профессиональный отпариватель', caption:'каждая вещь уходит к вам идеально ровной'}) ]},
  { on:true, layout:'g3', facts:[
    F({icon:'cube', color:'orange', label:'3D-печать', big:'340', unit:'кг', title:'пластика превратили в изделия'}),
    F({visual:'swatch', swatch:'#ffffff', big:'112', unit:'кг', title:'белого — наш цвет №1', caption:'вывески, таблички, топперы'}),
    F({visual:'swatch', swatch:'#1d1d1f', big:'96', unit:'кг', title:'чёрного — на втором месте', caption:'вместе с белым — 60% всего пластика'}) ]},
  { on:true, layout:'g3', facts:[
    F({icon:'tool', color:'teal', label:'Самое маленькое', big:'Плоскогубцы', caption:'брендировали даже их'}),
    F({icon:'truck', color:'red', label:'Самое большое', big:'Фура', caption:'да, мы брендировали фуру'}),
    F({icon:'ball', color:'orange', label:'Самый большой заказ', title:'Весь инвентарь для женской волейбольной команды', caption:'Смотрите рилс в нашем Instagram'}) ]},
  { on:true, layout:'g3', facts:[
    F({icon:'clock', color:'green', label:'Сроки', big:'Всегда в срок', caption:'Никогда не обманываем насчёт сроков'}),
    F({icon:'shield', color:'blue', label:'Качество', big:'Гарантия', caption:'Ручаемся за качество каждой работы'}),
    F({style:'blue', icon:'heart', label:'Сервис', big:'Нас выбирают снова', caption:'Много постоянных клиентов приходят за сервисом и качеством'}) ]},
  { on:true, layout:'g3', facts:[
    F({big:'Что мы делаем', list:'DTF на одежде\nВышивка\n3D-печать\nНаклейки на авто\nВывески и таблички'}),
    F({visual:'insta', big:'@raz.brandstudio', numColor:true, color:'blue', caption:'Смотрите наши работы в Instagram'}),
    F({style:'blue', icon:'plus', big:'Есть идея?', caption:'Расскажите — придумаем и сделаем. А если это подарок, сделаем с особой любовью'}) ]},
]};
TV.newFact = () => F({icon:'sparkle', color:'blue', label:'Новый факт', big:'100', title:'чего-нибудь крутого'});

/* ---------- стили карточек ---------- */
TV.CSS = `
.bgfx{position:absolute;inset:0;z-index:0;overflow:hidden}
.bgfx i{position:absolute;width:1300px;height:1300px;border-radius:50%;will-change:transform}
.bgfx i:nth-child(1){left:-300px;top:-500px;background:radial-gradient(circle,rgba(0,122,255,.20),rgba(0,122,255,0) 65%);animation:tvd1 38s ease-in-out infinite alternate}
.bgfx i:nth-child(2){right:-400px;top:-300px;background:radial-gradient(circle,rgba(175,82,222,.16),rgba(175,82,222,0) 65%);animation:tvd2 46s ease-in-out infinite alternate}
.bgfx i:nth-child(3){left:300px;bottom:-700px;background:radial-gradient(circle,rgba(255,45,85,.11),rgba(255,45,85,0) 65%);animation:tvd3 52s ease-in-out infinite alternate}
.bgfx i:nth-child(4){right:100px;bottom:-650px;background:radial-gradient(circle,rgba(48,176,199,.16),rgba(48,176,199,0) 65%);animation:tvd4 44s ease-in-out infinite alternate}
@keyframes tvd1{to{transform:translate(520px,300px) scale(1.15)}}@keyframes tvd2{to{transform:translate(-560px,360px) scale(.9)}}
@keyframes tvd3{to{transform:translate(480px,-340px) scale(1.2)}}@keyframes tvd4{to{transform:translate(-620px,-260px) scale(1.05)}}
.scene{position:absolute;left:72px;right:72px;top:192px;bottom:112px;display:grid;gap:28px;z-index:2;pointer-events:none}
.scene .f{opacity:0;transform:translateY(60px) scale(.94);transition:opacity .7s ease,transform .7s ease}
.scene.on .f{opacity:1;transform:none;transition:opacity .9s ease,transform 1.1s cubic-bezier(.2,1.25,.3,1)}
.scene.out .f{opacity:0;transform:translateY(-40px) scale(.97)}
.scene.on .f:nth-child(2){transition-delay:.18s}.scene.on .f:nth-child(3){transition-delay:.36s}
.scene.out .f:nth-child(2){transition-delay:.08s}.scene.out .f:nth-child(3){transition-delay:.16s}
.scene.on .ic,.scene.on .sw,.scene.on .insta{animation:tvpop .8s cubic-bezier(.2,1.6,.4,1) both}
.scene.on .f:nth-child(1) .ic{animation-delay:.45s}.scene.on .f:nth-child(2) .ic,.scene.on .f:nth-child(2) .sw,.scene.on .f:nth-child(2) .insta{animation-delay:.6s}.scene.on .f:nth-child(3) .ic,.scene.on .f:nth-child(3) .sw,.scene.on .f:nth-child(3) .insta{animation-delay:.75s}
.scene.on .li .ic{animation-delay:calc(.5s + var(--n,0)*.12s)}
@keyframes tvpop{0%{transform:scale(0) rotate(-20deg)}100%{transform:none}}
.g3{grid-template-columns:1fr 1fr 1fr}
.g12{grid-template-columns:1.25fr 1fr;grid-template-rows:1fr 1fr}.g12 .f:first-child{grid-row:span 2}
.f{background:rgba(255,255,255,.62);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.95),0 14px 40px rgba(40,60,140,.08);border-radius:40px;padding:48px 50px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden;color:#1d1d1f}
.f.blue{background:#007aff;color:#fff}.f.kaspi{background:#f14635;color:#fff}
.f.blue .t,.f.kaspi .t,.f.blue .h,.f.kaspi .h{color:#fff}
.f.blue .cap,.f.kaspi .cap,.f.blue .top,.f.kaspi .top{color:rgba(255,255,255,.86)}
.f.blue .ic,.f.kaspi .ic{background:rgba(255,255,255,.22)!important}
.f.blue::after,.f.kaspi::after{content:"";position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.22),transparent);transform:skewX(-18deg);animation:tvshine 7s ease-in-out 2s infinite}
@keyframes tvshine{0%,70%{left:-60%}100%{left:130%}}
.ic{width:80px;height:80px;border-radius:22px;display:grid;place-items:center;color:#fff;flex:none}.ic svg{width:44px;height:44px}
.top{display:flex;align-items:center;gap:22px;font-size:28px;font-weight:600;color:#8e8e93;min-height:80px}
.num{display:inline-block;font-family:"Inter Tight",Inter,system-ui,sans-serif;font-weight:800;letter-spacing:-.045em;line-height:.92;font-variant-numeric:tabular-nums;font-size:150px}
.num small{font-size:.38em;letter-spacing:-.01em;margin-left:8px;opacity:.6}.num .pl{font-size:.5em;opacity:1;margin-left:0}
.g12 .f:first-child .num{font-size:250px}
.t{font-family:"Inter Tight",Inter,system-ui,sans-serif;font-size:44px;font-weight:700;letter-spacing:-.02em;line-height:1.08;color:#1d1d1f}
.num+.t{margin-top:22px}
.cap{font-size:27px;color:#8e8e93;font-weight:500;line-height:1.35;margin-top:14px}
.h{font-family:"Inter Tight",Inter,system-ui,sans-serif;font-size:64px;font-weight:800;letter-spacing:-.03em;line-height:1.02}
.h.sm{font-size:52px}.g12 .f:first-child .h{font-size:120px}
.flag{display:flex;height:20px;width:150px;border-radius:6px;overflow:hidden}.flag i{flex:1}.flag i:nth-child(2){box-shadow:inset 0 0 0 2px rgba(0,0,0,.08)}
.sw{width:120px;height:120px;border-radius:30px;box-shadow:inset 0 0 0 2px rgba(0,0,0,.08)}
.deco{position:absolute;right:-60px;top:-50px;width:440px;opacity:.13;color:#fff;animation:tvspin 60s linear infinite}@keyframes tvspin{to{transform:rotate(360deg)}}
.list{display:flex;flex-direction:column;gap:16px;margin-top:20px}
.li{display:flex;align-items:center;gap:20px;font-size:32px;font-weight:600}
.li .ic{width:60px;height:60px;border-radius:17px}.li .ic svg{width:32px;height:32px}
.insta{width:96px;height:96px;border-radius:26px;background:linear-gradient(45deg,#ffcc00,#ff2d55,#af52de);display:grid;place-items:center}.insta svg{width:54px;height:54px}
`;
TV.injectCSS = () => { if (document.getElementById('tv-core-css')) return; const s = document.createElement('style'); s.id = 'tv-core-css'; s.textContent = TV.CSS; document.head.appendChild(s); };

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const isNum = s => /^\d[\d\s]*$/.test(String(s||'').trim());
TV.isNum = isNum;
const TAG = '<svg class="deco" viewBox="44 60 50 50" fill="currentColor"><path d="M70.4 60.3C76.3 60.2 82.3 60.6 88.2 60.4C90.2 60.7 91.7 62.3 92 64.3C91.8 70.3 92.3 76.3 92.1 82.3C92.1 83.7 91.7 85.1 91 86.3C84.3 93.5 77.2 100.4 70.1 107.2C68.3 108.3 66.4 108 64.8 106.7C59.6 101.5 54.3 96.3 49.2 91.1C45.6 87.4 42.7 85.6 47.1 80.7C52.9 74.4 59.6 68.7 65.5 62.4C66.8 61.2 68.6 60.4 70.4 60.3"/></svg>';
const LIST_COLORS = ['purple','indigo','orange','red','blue','green','teal','pink'];
const LIST_ICONS = { 'dtf':'printer','вышив':'needle','3d':'cube','накле':'car','авто':'car','вывес':'sign','таблич':'sign','топпер':'cup','футбол':'shirt' };
const listIcon = t => { const l = t.toLowerCase(); for (const k in LIST_ICONS) if (l.includes(k)) return LIST_ICONS[k]; return 'check'; };

TV.factHTML = (f) => {
  const col = TV.COLORS[f.color] || TV.COLORS.blue;
  let top = '';
  if (f.visual === 'flag-it') top = '<div class="flag"><i style="background:#009246"></i><i style="background:#fff"></i><i style="background:#ce2b37"></i></div>';
  else if (f.visual === 'swatch') top = `<div class="sw" style="background:${esc(f.swatch||'#fff')}"></div>`;
  else if (f.visual === 'insta') top = `<div class="insta"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="#fff"/></svg></div>`;
  else if (f.icon || f.label) top = `<div class="top">${f.icon ? `<span class="ic" style="background:${col}">${TV.icon(f.icon)}</span>` : ''}${esc(f.label)}</div>`;
  let body = '';
  if (f.big) {
    if (isNum(f.big)) {
      body += `<div class="num" data-to="${String(f.big).replace(/\s/g,'')}" data-plus="${f.plus?1:''}" data-unit="${esc(f.unit)}"${f.numColor?` style="color:${col}"`:''}>${Number(String(f.big).replace(/\s/g,'')).toLocaleString('ru-RU')}${f.plus?'<small class="pl">+</small>':''}${f.unit?`<small>${esc(f.unit)}</small>`:''}</div>`;
    } else {
      body += `<div class="h${String(f.big).length > 12 ? ' sm' : ''}"${f.numColor?` style="color:${col}"`:''}>${esc(f.big)}${f.unit?` <small style="font-size:.5em;opacity:.6">${esc(f.unit)}</small>`:''}</div>`;
    }
  }
  if (f.title) body += `<div class="t"${f.big && !isNum(f.big) ? ' style="margin-top:14px"' : ''}>${esc(f.title)}</div>`;
  if (f.caption) body += `<div class="cap">${esc(f.caption)}</div>`;
  if (f.list) body += '<div class="list">' + String(f.list).split('\n').filter(x=>x.trim()).map((x,i)=>`<div class="li" style="--n:${i+1}"><span class="ic" style="background:${TV.COLORS[LIST_COLORS[i%LIST_COLORS.length]]}">${TV.icon(listIcon(x))}</span>${esc(x)}</div>`).join('') + '</div>';
  // если «большое» — заголовок, а список под ним, держим заголовок наверху
  const split = f.list && !top;
  const deco = (f.style !== 'plain' && f.visual === 'tag') ? TAG : '';
  return `<div class="f ${f.style==='blue'?'blue':f.style==='kaspi'?'kaspi':''}">${deco}${split ? body : (top || '<div></div>') + `<div>${body}</div>`}</div>`;
};
TV.sceneHTML = (sc) => `<section class="scene ${sc.layout==='g12'?'g12':'g3'}">${(sc.facts||[]).slice(0,3).map(TV.factHTML).join('')}</section>`;

TV.countUp = (el) => {
  const to = +el.dataset.to, plus = !!el.dataset.plus, unit = el.dataset.unit;
  const tail = (plus ? '<small class="pl">+</small>' : '') + (unit ? `<small>${unit}</small>` : '');
  const t0 = performance.now(), d = 2200;
  (function f(t){ const p = Math.min(1,(t-t0)/d), e = 1-Math.pow(1-p,4);
    el.innerHTML = Math.round(to*e).toLocaleString('ru-RU') + (p===1 ? tail : (unit ? `<small>${unit}</small>` : ''));
    if (p<1) requestAnimationFrame(f); })(t0);
};
TV.animateIn = (sceneEl) => { sceneEl.classList.add('on'); sceneEl.querySelectorAll('.num[data-to]').forEach(el => setTimeout(() => TV.countUp(el), 500)); };

/* привести данные из базы к полному виду */
TV.normalize = (d) => {
  if (!d || !Array.isArray(d.screens)) return JSON.parse(JSON.stringify(TV.DEFAULT));
  return { slideSec: +d.slideSec || 20, screens: d.screens.map(s => ({ on: s.on !== false, layout: s.layout === 'g12' ? 'g12' : 'g3', facts: [0,1,2].map(i => F((s.facts||[])[i] || {})) })) };
};
})();
