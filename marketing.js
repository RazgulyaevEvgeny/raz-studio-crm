/* Маркетинговый отдел: календарь стратегии и продаж, конкуренты, идеи, офферы
   и ИИ-команда (маркетолог, SMM-менеджер, аналитик, планёрка).
   Всё хранится в Firestore, коллекция marketing (поле kind: event, competitor, idea, offer, goal; разговоры — с полем messages).
   Ответы ИИ приходят через сервер marketing-worker (Cloudflare) — бесплатно, на Google Gemini.
   Креативы рисует marketing-creative.js, «О студии» и Instagram тоже здесь. */

/* читает переменные страницы учёта (orders, prices…) — они объявлены в основном скрипте */
function GLOBAL(name) { try { return (0, eval)(name); } catch (_) { return undefined; } }

(function () {
  /* адрес сервера-посредника; если имя воркера другое — поменяйте */
  const MKT_API = 'https://raz-marketing.design-onegin.workers.dev';

  /* ---------- справочники ---------- */
  const TABS = [
    ['cal', 'Календарь'], ['ig', 'Instagram'], ['create', 'Креативы'], ['comp', 'Конкуренты'], ['ideas', 'Идеи'], ['offers', 'Офферы'], ['about', 'О студии'], ['chat', 'ИИ-команда']
  ];
  const ETYPES = {
    strategy: { l: 'Стратегия', c: '--blue' },
    offer: { l: 'Акция и оффер', c: '--danger' },
    content: { l: 'Контент', c: '--st-design' },
    sales: { l: 'Продажи', c: '--ok' },
    growth: { l: 'Рост и цифры', c: '--st-prod' }
  };
  const ICATS = { content: 'Контент', offer: 'Акция или оффер', channel: 'Канал продаж', partner: 'Партнёрство', other: 'Другое' };
  const ISTAT = { new: 'Новая', work: 'В работе', done: 'Сделано', drop: 'Отложили' };
  const OSTAT = { active: 'Действует', draft: 'Черновик', archive: 'В архиве' };
  const SVCS = { vinyl: 'Винил на авто', dtf: 'DTF-печать', sign3d: '3D-таблички и вывески', print3d: '3D-печать', toppers: 'Топперы', other: 'Другое' };
  /* по каким словам в подписи понимаем, о какой услуге пост */
  const SVC_RX = { vinyl: /винил|наклейк|оклейк|авто|машин|стекл|плотер|плоттер/i, dtf: /dtf|дтф|футболк|худи|свитшот|принт|мерч|одежд|печать на/i, sign3d: /табличк|вывеск|навигац|qr|кофейн|кафе|барбер/i, print3d: /3d|3д|принтер|напечата|пластик/i, toppers: /топпер|торт/i };
  const RUBR = { process: 'Процесс', case: 'Кейс клиента', beforeafter: 'До и после', price: 'Цены и офферы', promo: 'Акция', team: 'Команда', tips: 'Полезное', other: 'Другое' };
  const IGTYPES = { reels: 'Reels', photo: 'Фото', carousel: 'Карусель', story: 'Сторис' };
  /* «О студии»: поля, которые читает вся ИИ-команда */
  const ABOUT = [
    ['city', 'Город и адрес', 'Город, район, ориентир, есть ли парковка'],
    ['contacts', 'Контакты', 'WhatsApp, телефон, Instagram, 2ГИС, Kaspi'],
    ['hours', 'График работы', 'Пн–Сб 10:00–19:00'],
    ['usp', 'Чем мы лучше других', 'Своё производство, срок 1 день, бесплатный макет…'],
    ['services', 'Услуги и условия', 'Что делаем, сроки, гарантии, минимальный заказ, доставка'],
    ['audience', 'Наши клиенты', 'Кто заказывает чаще всего и зачем'],
    ['tone', 'Как мы общаемся', 'На «ты» или «вы», дерзко или спокойно, языки'],
    ['brand', 'Фирменный стиль', 'Цвета, шрифты, что можно и нельзя в дизайне'],
    ['cases', 'Кейсы и известные клиенты', 'С кем работали, лучшие работы'],
    ['goals', 'Цели на 3 месяца', 'Сколько заказов и выручки хотим, что запускаем'],
    ['tried', 'Что пробовали и не сработало', ''],
    ['notes', 'Дополнительно', 'Всё остальное, что важно знать маркетологу']
  ];

  const ROLES = {
    marketer: { name: 'Маркетолог', sub: 'стратегия, рост, офферы, цены, КП', c: '--blue', ini: 'М',
      quick: ['Стратегия продаж на месяц для трёх главных услуг с датами', 'Проверь наш прайс: где наценка низкая и что поднять', 'Собери пакеты 3D-табличек для кофейни', 'Напиши КП для барбершопа', 'План поиска клиентов на винил без бюджета', 'Холодное сообщение заведению в WhatsApp'] },
    smm: { name: 'SMM-менеджер', sub: 'Instagram, Reels, посты, сторис', c: '--st-design', ini: 'S',
      quick: ['Что у нас уже есть в Instagram и чего не хватает', 'Контент-план на 2 недели с датами', '5 сценариев Reels из процесса в мастерской', 'Пост-кейс про оклейку авто', 'Сторис с опросом, чтобы собрать заявки', 'Перепиши шапку профиля и Highlights'] },
    analyst: { name: 'Аналитик', sub: 'конкуренты, продажи, рост, клиенты', c: '--st-prod', ini: 'А',
      quick: ['Сравни нас с конкурентами из раздела «Конкуренты»', 'Почему просели продажи — разбери цифры учёта', 'Какие услуги растут, а какие падают', 'Портреты клиентов по трём услугам', 'Скрипт «тайного покупателя» для обзвона конкурентов'] },
    team: { name: 'Планёрка', sub: 'вся команда по очереди', c: '--ok', ini: '★', team: true,
      quick: ['Как поднять продажи винила на авто за месяц', 'Запускаем 3D-таблички для заведений — план с датами', 'Маркетинговый план на следующий месяц', 'Разберите наши цены против конкурентов и дайте контент под это'] }
  };
  const TEAM_ORDER = ['analyst', 'marketer', 'smm'];

  /* поля форм для каждого вида записи: [ключ, подпись, тип, подсказка или варианты] */
  const FORMS = {
    event: { h: 'Событие в календаре', f: [
      ['title', 'Что делаем *', 'text', 'Запуск акции «Наклейка на авто + логотип»'],
      ['date', 'Дата *', 'date'], ['type', 'Тип', 'select', ETYPES], ['notes', 'Подробности', 'textarea', 'Что именно сделать, кто отвечает, какой результат ждём'], ['done', 'Сделано', 'check']] },
    competitor: { h: 'Конкурент', f: [
      ['name', 'Название *', 'text', 'Студия «Пример»'], ['services', 'Что делают', 'text', 'Оклейка авто, DTF, вывески'],
      ['link', 'Instagram, 2ГИС или сайт', 'text', 'https://instagram.com/…'], ['prices', 'Цены, которые знаем', 'textarea', 'Наклейка на стекло — 4 000 ₸, футболка DTF — 5 000 ₸'],
      ['strong', 'Сильные стороны', 'textarea'], ['weak', 'Слабые места', 'textarea'], ['notes', 'Заметки', 'textarea', 'Отзывы в 2ГИС, как отвечают в WhatsApp, сроки']] },
    idea: { h: 'Идея', f: [
      ['title', 'Идея *', 'text', 'Бесплатная наклейка «Я из RAZ» каждому клиенту'], ['cat', 'Куда относится', 'select', ICATS],
      ['status', 'Статус', 'select', ISTAT], ['notes', 'Подробности', 'textarea']] },
    offer: { h: 'Оффер', f: [
      ['title', 'Название *', 'text', 'Набор табличек для кофейни'], ['status', 'Статус', 'select', OSTAT], ['svc', 'Услуга', 'select', SVCS],
      ['audience', 'Для кого', 'text', 'Кофейни и кафе, которые открываются'], ['includes', 'Что входит', 'textarea', 'Wi-Fi, QR меню, номера столов, логотип на стойку'],
      ['price', 'Цена', 'text', '25 000 ₸ вместо 32 000 ₸'], ['until', 'Действует до', 'date']] },
    igpost: { h: 'Пост в Instagram', f: [
      ['date', 'Дата *', 'date'], ['type', 'Формат', 'select', IGTYPES], ['rubric', 'Рубрика', 'select', RUBR],
      ['caption', 'Тема или подпись *', 'textarea', 'О чём пост, можно вставить подпись целиком'], ['link', 'Ссылка на пост', 'text', 'https://instagram.com/p/…'],
      ['likes', 'Лайки', 'number'], ['comments', 'Комментарии', 'number'], ['reach', 'Охват', 'number'], ['photo', 'Обложка или скриншот', 'file']] },
    goal: { h: 'Цель на месяц', f: [
      ['revenue', 'Выручка, ₸', 'number', '800000'], ['orders', 'Заказов', 'number', '40'], ['note', 'Главный фокус месяца', 'textarea', 'Запуск 3D-табличек, 20 холодных сообщений кофейням в неделю']] }
  };

  /* ---------- стили ---------- */
  const st = document.createElement('style');
  st.textContent = `
  #p-marketing .ph .btns,#p-marketing .ph .btns .btn.primary{display:flex}
  .mk-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}.mk-tabs::-webkit-scrollbar{display:none}
  .mk-tabs button{flex:none;min-height:44px;padding:0 18px;border-radius:999px;background:var(--tile);font:600 14px var(--f);display:inline-flex;align-items:center;gap:8px}
  .mk-tabs button:hover{background:var(--tile-2)}.mk-tabs button[aria-selected="true"]{background:var(--ink);color:#fff}
  .mk-tabs em{font-style:normal;font-weight:500;opacity:.6;font-size:12.5px}
  .mk-view{display:flex;flex-direction:column;gap:14px;min-width:0}
  .mk-row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.mk-row small{color:var(--muted)}
  .mk-brief textarea,.mk-form textarea,.mk-dlg textarea,.mk-dlg input,.mk-dlg select,.mk-qadd input,.mk-qadd select{width:100%;border:0;background:var(--paper);border-radius:14px;padding:11px 14px;line-height:1.45;min-height:46px}
  .mk-dlg input,.mk-dlg select,.mk-dlg textarea{background:var(--tile)}
  .mk-brief textarea,.mk-form textarea,.mk-dlg textarea{resize:vertical}
  #p-marketing :is(textarea,input,select):focus-visible{outline:3px solid var(--blue);outline-offset:1px}
  /* календарь */
  .mk-mbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .mk-mbar h2{margin:0 6px;font:800 24px/1 var(--f);letter-spacing:-.035em;min-width:170px}
  .mk-ib{width:44px;height:44px;border-radius:50%;background:var(--tile);display:grid;place-items:center;font:700 18px var(--f)}.mk-ib:hover{background:var(--tile-2)}
  .mk-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
  .mk-kpi{background:var(--tile);border-radius:22px;padding:14px 16px;display:flex;flex-direction:column;gap:4px;text-align:left;min-width:0}
  button.mk-kpi:hover{background:var(--tile-2)}
  .mk-kpi span{font:600 13px var(--f);color:var(--muted)}.mk-kpi b{font:800 24px/1.1 var(--f);letter-spacing:-.03em}.mk-kpi small{color:var(--muted);font-size:12.5px}
  .mk-kpi b.up{color:var(--ok)}.mk-kpi b.down{color:var(--danger)}
  .mk-bar{height:8px;border-radius:99px;background:var(--paper);overflow:hidden}.mk-bar i{display:block;height:100%;background:var(--ok);border-radius:99px}
  .mk-leg{display:flex;flex-wrap:wrap;gap:6px}
  .mk-leg button{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 12px;border-radius:999px;background:var(--tile);font:600 13px var(--f)}
  .mk-leg button[aria-pressed="false"]{opacity:.45}
  .mk-dot{width:9px;height:9px;border-radius:50%;background:var(--ec,var(--muted));flex:none}
  .mk-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
  .mk-wd{font:700 12px var(--f);color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding:0 6px}
  .mk-day{min-height:104px;background:var(--tile);border-radius:16px;padding:7px;display:flex;flex-direction:column;gap:3px;text-align:left;min-width:0;cursor:pointer}
  .mk-day:hover{background:var(--tile-2)}.mk-day.out{opacity:.4}.mk-day.sel{box-shadow:inset 0 0 0 2.5px var(--blue)}
  .mk-day .n{display:flex;justify-content:space-between;align-items:baseline;gap:4px;font:700 13px var(--f);width:100%}
  .mk-day.today .n b{background:var(--blue);color:#fff;border-radius:99px;padding:0 7px}
  .mk-day .n small{font:600 11px var(--f);color:var(--ok);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mk-ev{display:flex;align-items:center;gap:5px;font:600 11.5px/1.25 var(--f);padding:2px 5px;border-radius:7px;background:color-mix(in srgb,var(--ec) 14%,var(--paper));min-width:0;width:100%}
  .mk-ev span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mk-ev.done span{text-decoration:line-through;opacity:.6}
  .mk-more{font:600 11px var(--f);color:var(--muted);padding-left:5px}
  .mk-dots{display:none;gap:3px;flex-wrap:wrap}
  .mk-agenda{display:flex;flex-direction:column;gap:8px}
  .mk-agh{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px;flex-wrap:wrap}
  .mk-agh h3{margin:0;font:800 18px/1.2 var(--f);letter-spacing:-.02em}
  .mk-it{display:flex;gap:12px;align-items:flex-start;background:var(--tile);border-radius:18px;padding:12px 14px;min-width:0}
  .mk-it .tx{flex:1;min-width:0}.mk-it .tx b{display:block;font:700 15px/1.3 var(--f);overflow-wrap:anywhere}.mk-it .tx small{display:block;color:var(--muted);font-size:13px;margin-top:2px;white-space:pre-wrap;overflow-wrap:anywhere}
  .mk-it.done .tx b{text-decoration:line-through;color:var(--muted)}
  .mk-it .tag{display:inline-flex;align-items:center;gap:6px;font:600 12px var(--f);color:var(--muted);margin-bottom:3px}
  .mk-chk{flex:none;width:28px;height:28px;border-radius:50%;box-shadow:inset 0 0 0 2.5px var(--line);display:grid;place-items:center;color:transparent;background:var(--paper)}
  .mk-chk.on{background:var(--ok);box-shadow:none;color:#fff}
  .mk-acts{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
  .mk-a{display:inline-flex;align-items:center;text-decoration:none;min-height:32px;padding:0 10px;border-radius:999px;font:600 12.5px var(--f);color:var(--blue);background:var(--paper);white-space:nowrap}.mk-a:hover{background:var(--tile-2)}
  .mk-a.del{color:var(--muted)}.mk-a.del:hover{color:var(--danger)}
  .mk-empty{background:var(--tile);border-radius:22px;padding:22px;color:var(--muted);text-align:center;font-size:14.5px}
  .mk-empty b{display:block;color:var(--ink);font:700 16px var(--f);margin-bottom:4px}
  /* карточки */
  .mk-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
  .mk-card{background:var(--tile);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:8px;min-width:0}
  .mk-card h3{margin:0;font:800 18px/1.2 var(--f);letter-spacing:-.02em;overflow-wrap:anywhere}
  .mk-card dl{margin:0;display:grid;gap:6px}.mk-card dt{font:600 12px var(--f);color:var(--muted)}.mk-card dd{margin:0;font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}
  .mk-card a{color:var(--blue);overflow-wrap:anywhere}
  .mk-card .mk-acts{justify-content:flex-start;margin-top:auto;padding-top:4px}
  .mk-pill{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;font:600 12px var(--f);padding:3px 10px;border-radius:99px;background:var(--paper)}
  .mk-filters{display:flex;gap:6px;flex-wrap:wrap}
  .mk-filters button{min-height:36px;padding:0 13px;border-radius:999px;background:var(--tile);font:600 13px var(--f)}
  .mk-filters button[aria-pressed="true"]{background:var(--blue);color:#fff}
  .mk-filters em{font-style:normal;opacity:.65;font-weight:500}
  .mk-qadd{display:flex;gap:8px;background:var(--tile);border-radius:22px;padding:10px}
  .mk-qadd input{flex:1}.mk-qadd select{width:auto;flex:none}
  .mk-st{border:0;border-radius:99px;background:var(--paper);font:600 12.5px var(--f);padding:6px 10px;min-height:32px}
  /* диалог */
  .mk-dlg{border:0;border-radius:26px;padding:0;width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 32px);background:var(--paper);color:var(--ink);box-shadow:0 20px 60px rgba(10,11,20,.25)}
  .mk-dlg::backdrop{background:rgba(10,11,20,.4)}
  .mk-dlg form{display:flex;flex-direction:column;gap:12px;padding:20px}
  .mk-dlg h2{margin:0;font:800 22px/1.15 var(--f);letter-spacing:-.03em}
  .mk-dlg label{display:flex;flex-direction:column;gap:6px;font:600 13px var(--f);color:var(--muted)}
  .mk-dlg label.ck{flex-direction:row;align-items:center;gap:10px;color:var(--ink)}.mk-dlg label.ck input{width:22px;height:22px;min-height:0}
  .mk-dlg .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .mk-dlg .ft{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px}
  .mk-dlg .ft .danger{margin-right:auto}
  .mk-dlg .er{color:var(--danger);font-size:14px}.mk-dlg .er:empty{display:none}
  .mk-pl{display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto}
  .mk-pl label{flex-direction:row;align-items:flex-start;gap:10px;background:var(--tile);border-radius:14px;padding:10px 12px;color:var(--ink);font:500 14px var(--fb)}
  .mk-pl input{width:20px;height:20px;min-height:0;flex:none;margin-top:2px}
  .mk-pl small{display:block;color:var(--muted)}
  /* ИИ-команда */
  .mk-team{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
  .mk-role{display:flex;align-items:center;gap:12px;text-align:left;padding:14px;border-radius:22px;background:var(--tile);cursor:pointer;min-width:0}
  .mk-role:hover{background:var(--tile-2)}.mk-role.on{background:var(--ink);color:#fff}.mk-role.on small{color:#c9cbe0}
  .mk-ava{flex:none;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font:800 16px var(--f);color:#fff;background:var(--rc)}
  .mk-role b{display:block;font:700 15px/1.2 var(--f)}.mk-role small{display:block;color:var(--muted);font-size:12.5px;line-height:1.3;margin-top:2px}.mk-role div{min-width:0}
  .mk-wrap{display:grid;grid-template-columns:260px minmax(0,1fr);gap:12px;align-items:start}
  .mk-hist{gap:6px;max-height:calc(100vh - 260px);overflow:auto;position:sticky;top:12px}
  .mk-hist h3{margin:2px 4px 6px;font:700 13px var(--f);color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .mk-th{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:10px 12px;border-radius:14px;cursor:pointer}
  .mk-th:hover{background:var(--tile-2)}.mk-th.on{background:var(--paper)}
  .mk-th .d{flex:none;width:9px;height:9px;border-radius:50%;background:var(--rc)}
  .mk-th span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 13.5px var(--f)}
  .mk-th em{font-style:normal;color:var(--muted);font-size:12px}
  .mk-th .x{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:var(--muted);visibility:hidden}
  .mk-th:hover .x,.mk-th.on .x{visibility:visible}.mk-th .x:hover{color:var(--danger);background:var(--tile)}
  .mk-chat{min-height:60vh}.mk-msgs{display:flex;flex-direction:column;gap:14px}
  .mk-m{display:flex;gap:10px;align-items:flex-start;min-width:0}.mk-m .mk-ava{width:34px;height:34px;font-size:13px}
  .mk-b{flex:1;min-width:0;background:var(--paper);border-radius:18px;padding:12px 16px}
  .mk-m.me{justify-content:flex-end}.mk-m.me .mk-b{flex:0 1 auto;max-width:85%;background:var(--blue);color:#fff;white-space:pre-wrap}
  .mk-who{display:flex;align-items:center;gap:8px;font:700 13px var(--f);margin-bottom:4px}.mk-who em{font-style:normal;color:var(--muted);font-weight:500}
  .mk-b .mk-acts{justify-content:flex-start;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}.mk-b .mk-a{background:var(--tile)}
  .mk-md{font-size:14.5px;line-height:1.55;overflow-wrap:anywhere}
  .mk-md h1,.mk-md h2,.mk-md h3,.mk-md h4{font-family:var(--f);letter-spacing:-.02em;margin:14px 0 6px;line-height:1.2}
  .mk-md h1{font-size:20px}.mk-md h2{font-size:18px}.mk-md h3{font-size:16px}.mk-md h4{font-size:15px}
  .mk-md>:first-child{margin-top:0}.mk-md p{margin:6px 0}.mk-md ul,.mk-md ol{margin:6px 0;padding-left:22px}.mk-md li{margin:3px 0}
  .mk-md a{color:var(--blue)}.mk-md code{background:var(--tile);padding:1px 5px;border-radius:6px;font-size:13px}
  .mk-md hr{border:0;border-top:1px solid var(--line);margin:12px 0}.mk-md blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid var(--line);color:var(--muted)}
  .mk-tw{overflow-x:auto;margin:8px 0}.mk-md table{border-collapse:collapse;font-size:13.5px;min-width:100%}
  .mk-md th,.mk-md td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}.mk-md th{background:var(--tile);font-family:var(--f)}
  .mk-src{margin-top:10px;padding-top:8px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}
  .mk-src a{color:var(--blue);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mk-wait{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:14px}
  .mk-bl{display:inline-flex;gap:4px}.mk-bl i{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:mkb 1.2s infinite}
  .mk-bl i:nth-child(2){animation-delay:.2s}.mk-bl i:nth-child(3){animation-delay:.4s}
  @keyframes mkb{0%,80%,100%{opacity:.25}40%{opacity:1}}
  @media (prefers-reduced-motion:reduce){.mk-bl i{animation:none;opacity:.6}}
  .mk-err{color:var(--danger);font-size:14px}
  .mk-intro{background:var(--paper);border-radius:18px;padding:18px;color:var(--muted);font-size:14.5px}.mk-intro b{color:var(--ink)}
  .mk-quick .chip{background:var(--paper);white-space:normal;text-align:left;height:auto;min-height:0;padding-block:8px;line-height:1.3;flex:0 1 auto}
  .mk-quick .chip:hover{background:var(--tile-2)}
  .mk-form{display:flex;gap:10px;align-items:flex-end}.mk-form textarea{flex:1;min-height:52px;max-height:40vh}
  .mk-foot{color:var(--muted);font-size:12px}
  @media(max-width:900px){.mk-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:860px){.mk-wrap{grid-template-columns:minmax(0,1fr)}.mk-hist{position:static;max-height:none;flex-direction:row;overflow-x:auto;padding:10px}.mk-hist h3{display:none}.mk-th{flex:none;width:auto;max-width:220px;background:var(--paper)}.mk-th.on{box-shadow:inset 0 0 0 2px var(--blue)}}
  @media(max-width:700px){
    .mk-hist.empty{display:none}#p-marketing .ph .btns{width:100%}#p-marketing .ph .btns .btn{flex:1}
    .mk-team{grid-template-columns:repeat(2,minmax(0,1fr))}.mk-role{padding:10px;gap:8px}.mk-ava{width:34px;height:34px;font-size:14px}.mk-role small{display:none}
    .mk-form{flex-direction:column;align-items:stretch}.mk-m .mk-ava{display:none}.mk-m.me .mk-b{max-width:92%}.mk-b{padding:10px 12px}
    .mk-grid{gap:3px}.mk-day{min-height:52px;padding:5px;border-radius:12px;align-items:center}.mk-day .n{justify-content:center}.mk-day .n small,.mk-day .mk-ev,.mk-day .mk-more{display:none}.mk-day .mk-dots{display:flex;justify-content:center}
    .mk-wd{text-align:center;padding:0}.mk-mbar h2{font-size:20px;min-width:0;flex:1}
    .mk-kpi{padding:12px}.mk-kpi b{font-size:20px}
    .mk-it{flex-wrap:wrap}.mk-it .mk-acts{width:100%;justify-content:flex-start}.mk-it:has(.mk-chk) .mk-acts{padding-left:40px}
    .mk-cards{grid-template-columns:minmax(0,1fr)}.mk-qadd{flex-wrap:wrap}.mk-qadd input{flex:1 1 100%}.mk-qadd select{flex:1}
    .mk-dlg{width:100vw;max-width:100vw;max-height:92vh;margin:auto 0 0;border-radius:24px 24px 0 0}.mk-dlg .two{grid-template-columns:1fr}
  }`;
  document.head.appendChild(st);

  /* ---------- состояние ---------- */
  let col = null, loaded = false, dbErr = '';
  let items = [], threads = [], brief = '', briefAt = 0, about = {}, aboutAt = 0, ig = null, status = null, igSyncing = false, igAuto = false, igF = 'all';
  let crt = { topic: '', svc: 'vinyl', format: 'post', photo: null, photoUrl: '', useAI: true, busy: '', caption: '', variants: [], previews: [], bg: null, err: '', note: '' };
  let tab = 'cal', role = 'marketer', cur = null, busy = null, err = '';
  let calYM = '', selDay = '', typeOff = new Set(), ideaF = 'open', offerF = 'all';
  let dlg = null;
  try { tab = localStorage.getItem('mk-tab') || tab; role = localStorage.getItem('mk-role') || role; } catch (_) {}
  if (!TABS.some(t => t[0] === tab)) tab = 'cal';
  if (!ROLES[role]) role = 'marketer';

  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $$ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => dstr(new Date());
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return dstr(new Date(y, m - 1, d + n)); };
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MDAT = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];
  const MGEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const WDS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const fmtDay = s => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); return d + ' ' + MGEN[m - 1] + ', ' + WDS[dt.getDay()]; };
  const fmtShort = s => { if (!s) return ''; const [, m, d] = s.split('-').map(Number); return d + ' ' + MGEN[m - 1]; };
  const fmtT = t => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); };
  const money = n => Math.round(n || 0).toLocaleString('ru-RU') + ' ₸';
  const kShort = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' млн' : n >= 1e3 ? Math.round(n / 1e3) + ' тыс' : String(Math.round(n));
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
  const of = k => items.filter(x => x.kind === k);
  const me = () => (window.APP_ROLE || {}).name || '';
  const toastMsg = m => { const t = GLOBAL('toast'); if (typeof t === 'function') t(m); };
  const etype = e => ETYPES[e.type] ? e.type : 'strategy';

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
    const isLi = l => /^\s*([-*+]|\d+[.)])\s+/.test(l);
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
      if (isLi(l)) {
        const ol = /^\s*\d/.test(l), lis = [];
        while (i < L.length && (isLi(L[i]) || (/^\s{2,}\S/.test(L[i]) && lis.length))) {
          if (isLi(L[i]) && !(/^\s{2,}/.test(L[i]) && lis.length)) lis.push(inline(L[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')));
          else lis[lis.length - 1] += '<br>' + inline(L[i].trim().replace(/^([-*+]|\d+[.)])\s+/, '— '));
          i++;
        }
        out.push((ol ? '<ol>' : '<ul>') + lis.map(x => '<li>' + x + '</li>').join('') + (ol ? '</ol>' : '</ul>'));
        continue;
      }
      const p = [];
      while (i < L.length && L[i].trim() && !/^(#{1,4}\s|```|\s*>)/.test(L[i]) && !isLi(L[i]) && !isRow(L[i])) p.push(L[i++]);
      if (!p.length) { out.push('<p>' + inline(L[i++]) + '</p>'); continue; }
      out.push('<p>' + p.map(inline).join('<br>') + '</p>');
    }
    return out.join('');
  }

  /* ---------- продажи из учёта ---------- */
  function salesBy(from, to) {
    const orders = GLOBAL('orders') || [], receivedOf = GLOBAL('receivedOf') || (() => ''), profitOf = GLOBAL('profitOf') || (() => 0);
    const L = orders.filter(o => o.status !== 'cancel').map(o => [receivedOf(o), o]).filter(([d]) => d && d >= from && d <= to);
    return { n: L.length, rev: L.reduce((s, [, o]) => s + (+o.price || 0), 0), prof: L.reduce((s, [, o]) => s + profitOf(o), 0), list: L };
  }
  const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return dstr(new Date(y, m, 0)); };
  const prevYM = ym => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const nextYM = ym => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const goalOf = ym => items.find(x => x.kind === 'goal' && x.id === 'goal-' + ym);

  /* ---------- контекст для ИИ (без имён и телефонов клиентов) ---------- */
  function context() {
    const orders = GLOBAL('orders') || [], prices = GLOBAL('prices') || [], ledger = GLOBAL('ledger') || { office: [] };
    const svcLabel = GLOBAL('svcLabel') || (x => x), profitOf = GLOBAL('profitOf') || (() => 0), receivedOf = GLOBAL('receivedOf') || (() => ''), unitCostOf = GLOBAL('unitCostOf'), calcMin = GLOBAL('calcMin');
    const day = n => addDays(today(), -n);
    const out = [];
    const pr = prices.filter(x => !x.hidden).slice(0, 150).map(x => {
      const p = x.calc && calcMin ? 'от ' + money(calcMin(x.calc)) : (x.from ? 'от ' : '') + money(x.price);
      const c = unitCostOf ? unitCostOf(x) : 0;
      const mk = c > 0 && +x.price ? Math.round((+x.price - c) / c * 100) + '%' : '—';
      const tiers = (x.tiers || []).filter(t => t.qty && t.price).map(t => 'от ' + t.qty + ' шт — ' + money(t.price)).join('; ');
      return `| ${svcLabel(x.svc)} | ${x.name || ''} | ${x.unit || 'шт'} | ${p}${tiers ? ' (' + tiers + ')' : ''} | ${c ? money(c) : '—'} | ${mk} |`;
    });
    out.push('### Прайс студии\n' + (pr.length ? '| Услуга | Позиция | За что | Цена | Себестоимость | Наценка |\n|---|---|---|---|---|---|\n' + pr.join('\n') : 'Прайс пустой.'));
    const live = orders.filter(o => o.status !== 'cancel');
    const per = (from, to) => { const m = new Map(); live.filter(o => { const d = receivedOf(o); return d && d >= from && d <= to; }).forEach(o => { const k = svcLabel(o.service, o), e = m.get(k) || { n: 0, r: 0, p: 0 }; e.n++; e.r += +o.price || 0; e.p += profitOf(o); m.set(k, e); }); return m; };
    const now = per(day(90), day(0)), prev = per(day(180), day(91));
    const keys = [...new Set([...now.keys(), ...prev.keys()])];
    out.push('### Заказы по услугам: последние 90 дней и предыдущие 90 дней\n' + (keys.length ? '| Услуга | Заказов (90 дн) | Выручка | Прибыль | Средний чек | Заказов (пред. 90) | Выручка (пред.) |\n|---|---|---|---|---|---|---|\n' +
      keys.map(k => { const a = now.get(k) || { n: 0, r: 0, p: 0 }, b = prev.get(k) || { n: 0, r: 0 }; return `| ${k} | ${a.n} | ${money(a.r)} | ${money(a.p)} | ${a.n ? money(a.r / a.n) : '—'} | ${b.n} | ${money(b.r)} |`; }).join('\n') : 'Заказов за полгода нет.'));
    const months = new Map();
    live.forEach(o => { const ym = (receivedOf(o) || '').slice(0, 7); if (ym && ym >= day(365).slice(0, 7)) { const e = months.get(ym) || { n: 0, r: 0 }; e.n++; e.r += +o.price || 0; months.set(ym, e); } });
    out.push('### Выручка по месяцам (12 мес.)\n' + ([...months].sort().map(([ym, e]) => { const g = goalOf(ym); return `${ym}: ${money(e.r)}, заказов ${e.n}${g && g.revenue ? ', цель ' + money(g.revenue) : ''}`; }).join('\n') || 'нет данных'));
    const g = goalOf(today().slice(0, 7));
    if (g) out.push('### Цель текущего месяца\n' + [g.revenue ? 'выручка ' + money(g.revenue) : '', g.orders ? 'заказов ' + g.orders : '', g.note || ''].filter(Boolean).join('; '));
    const src = new Map();
    live.filter(o => (receivedOf(o) || '') >= day(90)).forEach(o => { const s = o.source === 'toppers' ? 'Сайт топперов' : (o.kaspi || []).length || o.service === 'kaspi' ? 'Kaspi' : 'Студия (Instagram, WhatsApp, офлайн)'; src.set(s, (src.get(s) || 0) + 1); });
    out.push('### Откуда заказы (90 дней)\n' + ([...src].map(([k, v]) => `${k}: ${v}`).join('\n') || 'нет данных'));
    const ads = (ledger.office || []).filter(x => x.cat === 'ads' && (x.date || '') >= day(90)).reduce((s, x) => s + (+x.amount || 0), 0);
    out.push('### Расходы на рекламу за 90 дней: ' + money(ads));
    const comp = of('competitor');
    const one = s => String(s || '').replace(/\n/g, '; ');
    out.push('### Конкуренты (раздел «Конкуренты»)\n' + (comp.length ? comp.slice(0, 25).map(c => `- **${c.name}**${c.services ? ' — ' + c.services : ''}${c.link ? ' (' + c.link + ')' : ''}${c.prices ? '\n  Цены: ' + one(c.prices) : ''}${c.strong ? '\n  Сильные: ' + one(c.strong) : ''}${c.weak ? '\n  Слабые: ' + one(c.weak) : ''}${c.notes ? '\n  Заметки: ' + one(c.notes) : ''}`).join('\n') : 'Пока никого не добавили.'));
    const offs = of('offer').filter(o => o.status !== 'archive');
    out.push('### Офферы студии\n' + (offs.length ? offs.map(o => `- ${o.title} [${OSTAT[o.status] || 'Черновик'}]${o.svc ? ', ' + (SVCS[o.svc] || '') : ''}${o.audience ? ', для: ' + o.audience : ''}${o.price ? ', цена: ' + o.price : ''}${o.until ? ', до ' + o.until : ''}${o.includes ? '\n  Входит: ' + one(o.includes).slice(0, 600) : ''}`).join('\n') : 'Пока нет.'));
    const evs = of('event').filter(e => e.date >= day(14) && e.date <= addDays(today(), 30)).sort((a, b) => a.date.localeCompare(b.date));
    out.push('### Календарь маркетинга (−14…+30 дней)\n' + (evs.length ? evs.slice(0, 50).map(e => `- ${e.date} [${ETYPES[etype(e)].l}${e.done ? ', сделано' : ''}] ${e.title}`).join('\n') : 'Событий нет.'));
    out.push(igContext());
    const ids = of('idea').filter(x => x.status === 'new' || x.status === 'work');
    out.push('### Идеи в работе и новые\n' + (ids.length ? ids.slice(0, 30).map(x => `- ${x.title} [${ISTAT[x.status]}]`).join('\n') : 'Пока нет.'));
    return out.join('\n\n');
  }

  /* ---------- сервер ИИ ---------- */
  async function ask(r, messages) {
    const u = window.firebase && firebase.auth && firebase.auth().currentUser;
    if (!u) throw new Error('Войдите на сайт заново.');
    const token = await u.getIdToken();
    const res = await fetch(MKT_API + '/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ role: r, messages, context: r === 'planner' ? '' : context(), brief: aboutText() }) })
      .catch(() => { throw new Error('Нет связи с сервером ИИ-команды. Проверьте интернет или адрес MKT_API в marketing.js.'); });
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
      items = []; threads = [];
      s.docs.forEach(d => { const x = { id: d.id, ...d.data() }; if (d.id === 'brief') { brief = x.text || ''; briefAt = x.updatedAt || 0; } else if (d.id === 'about') { about = x; aboutAt = x.updatedAt || 0; } else if (d.id === 'ig') { ig = x; } else if (Array.isArray(x.messages)) threads.push(x); else if (x.kind) items.push(x); });
      threads.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      loaded = true; dbErr = '';
      if (cur && !threads.find(t => t.id === cur) && !busy) cur = null;
      if (isOpen() && !dlg) draw();
    }, () => { dbErr = 'Нет доступа к разделу в базе. Обновите правила firestore.rules (раздел marketing) в Firebase.'; loaded = true; if (isOpen()) draw(); });
  }
  const isOpen = () => { const p = $$('p-marketing'); return p && !p.hidden; };
  async function saveItem(kind, id, data) {
    const d = { ...data, kind, updatedAt: Date.now(), by: me() };
    if (id) { const old = items.find(i => i.id === id); if (old && old.createdAt) d.createdAt = old.createdAt; await col.doc(id).set(d); }
    else { d.createdAt = Date.now(); await col.doc().set(d); }
  }
  async function patchItem(id, patch) { const x = items.find(i => i.id === id); if (!x) return; const { id: _, ...rest } = x; try { await col.doc(id).set({ ...rest, ...patch, updatedAt: Date.now() }); } catch (_) { toastMsg('Не сохранилось'); } }
  async function delItem(id, what) { if (!confirm('Удалить ' + what + '?')) return; try { await col.doc(id).delete(); } catch (_) { toastMsg('Не удалось удалить'); } }
  async function saveThread(t) {
    const data = { role: t.role, title: t.title, messages: t.messages.slice(-60), updatedAt: Date.now(), createdAt: t.createdAt || Date.now(), by: me() };
    if (!t.id) { const ref = col.doc(); t.id = ref.id; await ref.set(data); } else await col.doc(t.id).set(data);
    return t.id;
  }

  /* ---------- диалог формы ---------- */
  function openForm(kind, id, preset) {
    const F = FORMS[kind], x = (id && items.find(i => i.id === id)) || {}, v = { ...x, ...(preset || {}) };
    if (kind === 'event' && !v.date) v.date = selDay || today();
    if (kind === 'event' && !v.type) v.type = 'strategy';
    if (kind === 'idea' && !v.status) v.status = 'new';
    if (kind === 'idea' && !v.cat) v.cat = 'other';
    if (kind === 'offer' && !v.status) v.status = 'draft';
    if (kind === 'offer' && !v.svc) v.svc = 'other';
    const field = ([k, l, t, ph]) => {
      const val = v[k] ?? '';
      if (t === 'textarea') return `<label>${E(l)}<textarea name="${k}" rows="3" placeholder="${E(ph || '')}">${E(val)}</textarea></label>`;
      if (t === 'select') return `<label>${E(l)}<select name="${k}">${Object.entries(ph).map(([o, ol]) => `<option value="${o}"${o === val ? ' selected' : ''}>${E(ol.l || ol)}</option>`).join('')}</select></label>`;
      if (t === 'file') return `<label>${E(l)}<input type="file" name="${k}" accept="image/*">${val ? `<img src="${E(val)}" alt="" style="max-width:160px;border-radius:12px;margin-top:6px">` : ''}</label>`;
      if (t === 'check') return `<label class="ck"><input type="checkbox" name="${k}"${val ? ' checked' : ''}> ${E(l)}</label>`;
      return `<label>${E(l)}<input name="${k}" type="${t}" value="${E(val)}" placeholder="${E(ph || '')}"${t === 'number' ? ' inputmode="numeric" min="0"' : ''}></label>`;
    };
    const short = f => f && ['date', 'select', 'number'].includes(f[2]);
    const html = [];
    for (let i = 0; i < F.f.length; i++) {
      if (short(F.f[i]) && short(F.f[i + 1])) { html.push('<div class="two">' + field(F.f[i]) + field(F.f[i + 1]) + '</div>'); i++; }
      else html.push(field(F.f[i]));
    }
    const title = kind === 'goal' ? F.h + ': ' + MONTHS[+id.slice(-2) - 1].toLowerCase() : (id ? '' : 'Новое: ') + F.h.toLowerCase();
    $$('mk-dform').innerHTML = `<h2>${E(title.charAt(0).toUpperCase() + title.slice(1))}</h2>${html.join('')}
      <div class="er" id="mk-derr" role="alert"></div>
      <div class="ft">${id && kind !== 'goal' ? '<button type="button" class="btn danger sm" data-mkdfdel>Удалить</button>' : ''}<button type="button" class="btn soft sm" data-mkdfx>Отмена</button><button type="submit" class="btn primary sm">Сохранить</button></div>`;
    dlg = { kind, id };
    $$('mk-dlg').showModal();
    const first = $$('mk-dform').querySelector('input:not([type=checkbox]),textarea');
    if (first) setTimeout(() => first.focus(), 30);
  }
  async function submitForm() {
    const { kind, id } = dlg, F = FORMS[kind], fd = new FormData($$('mk-dform')), d = {};
    const old = (id && items.find(i => i.id === id)) || {};
    const files = [];
    F.f.forEach(([k, , t]) => { if (t === 'file') { const f = fd.get(k); if (f && f.size) files.push([k, f]); else d[k] = old[k] || ''; } else d[k] = t === 'check' ? fd.get(k) === 'on' : t === 'number' ? (+fd.get(k) || 0) : String(fd.get(k) || '').trim(); });
    const req = F.f.find(f => f[1].endsWith('*') && !d[f[0]]);
    if (req) { $$('mk-derr').textContent = 'Заполните поле «' + req[1].replace(' *', '') + '».'; return; }
    const btn = $$('mk-dform').querySelector('[type=submit]'); btn.disabled = true;
    try {
      for (const [k, f] of files) {
        const assets = await window.claude.use('assets');
        if (!assets) throw new Error('Загрузка фото недоступна');
        btn.textContent = 'Загружаем фото…';
        d[k] = (await assets.upload(f)).url;
      }
      if (kind === 'goal') await col.doc(id).set({ ...d, kind: 'goal', updatedAt: Date.now(), by: me() });
      else await saveItem(kind, id, d);
      if (kind === 'event' && d.date) { calYM = d.date.slice(0, 7); selDay = d.date; }
      closeDlg(); toastMsg('Сохранено');
    } catch (e) { $$('mk-derr').textContent = (e && e.code === 'too_large' ? 'Фото слишком большое.' : 'Не сохранилось. Проверьте связь и правила базы.'); btn.disabled = false; btn.textContent = 'Сохранить'; }
  }
  function closeDlg() { dlg = null; $$('mk-dlg').classList.remove('wide'); try { $$('mk-dlg').close(); } catch (_) {} draw(); }

  /* план из ответа ИИ → события календаря */
  async function planToCalendar(text, btn) {
    const lbl = btn.textContent; btn.disabled = true; btn.textContent = 'Раскладываем…';
    try {
      const r = await ask('planner', [{ role: 'user', text: `Дата начала: ${today()} (${WDS[new Date().getDay()]}).\n\nПлан:\n${text}` }]);
      let j; try { j = JSON.parse(String(r.text).replace(/^\s*```(json)?/, '').replace(/```\s*$/, '').trim()); } catch (_) { throw new Error('ИИ вернул план в непонятном виде. Попробуйте ещё раз.'); }
      const evs = (j.events || []).filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.title).slice(0, 40);
      if (!evs.length) throw new Error('В ответе не нашлось пунктов с датами.');
      dlg = { kind: 'plan', evs };
      $$('mk-dform').innerHTML = `<h2>Разложить в календарь</h2><p style="margin:0;color:var(--muted);font-size:14px">Нашли ${evs.length} ${plural(evs.length, 'пункт', 'пункта', 'пунктов')}. Снимите галочки с лишних.</p>
        <div class="mk-pl">${evs.map((e, i) => { const T = ETYPES[e.type] || ETYPES.strategy; return `<label><input type="checkbox" name="e${i}" checked><span><b>${E(fmtShort(e.date))}</b> · ${E(e.title)}<small>${E(T.l)}${e.notes ? ' — ' + E(e.notes) : ''}</small></span></label>`; }).join('')}</div>
        <div class="er" id="mk-derr" role="alert"></div>
        <div class="ft"><button type="button" class="btn soft sm" data-mkdfx>Отмена</button><button type="submit" class="btn primary sm">Добавить в календарь</button></div>`;
      $$('mk-dlg').showModal();
    } catch (e) { toastMsg(e.message); err = e.message; draw(); }
    finally { btn.disabled = false; btn.textContent = lbl; }
  }
  async function submitPlan() {
    const fd = new FormData($$('mk-dform')), pick = dlg.evs.filter((_, i) => fd.get('e' + i) === 'on');
    const btn = $$('mk-dform').querySelector('[type=submit]'); btn.disabled = true;
    try {
      for (const e of pick) await saveItem('event', null, { title: String(e.title).slice(0, 120), date: e.date, type: ETYPES[e.type] ? e.type : 'strategy', notes: String(e.notes || ''), done: false });
      const first = pick.map(e => e.date).sort()[0];
      if (first) { tab = 'cal'; calYM = first.slice(0, 7); selDay = ''; save(); }
      closeDlg(); toastMsg('Добавлено в календарь: ' + pick.length);
    } catch (_) { $$('mk-derr').textContent = 'Не сохранилось.'; btn.disabled = false; }
  }

  /* ---------- переход в чат с готовой задачей ---------- */
  const save = () => { try { localStorage.setItem('mk-tab', tab); localStorage.setItem('mk-role', role); } catch (_) {} };
  function toChat(r, text) {
    tab = 'chat'; role = r; cur = null; err = ''; save(); draw();
    const t = $$('mk-in'); t.value = text; t.focus(); t.setSelectionRange(t.value.length, t.value.length);
    t.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* ---------- отправка в чат ---------- */
  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy || !col) return;
    err = '';
    let t = threads.find(x => x.id === cur);
    if (!t || t.role !== role) t = { role, title: text.slice(0, 70), messages: [], createdAt: Date.now() };
    else t = { ...t, messages: [...t.messages] };
    t.messages.push({ role: 'user', text, at: Date.now(), by: me() });
    $$('mk-in').value = '';
    const R = ROLES[role], steps = R.team ? TEAM_ORDER : [role];
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
            (s === 'smm' ? '\n\nТы выступаешь последним: переведи стратегию в контент и в конце дай общий итог планёрки — план на 2 недели с конкретными датами, кто что делает.' : '') }];
        } else msgs = t.messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text }));
        const r = await ask(s, msgs);
        const msg = { role: 'assistant', agent: s, text: r.text || '(пустой ответ)', sources: r.sources || [], at: Date.now(), engine: r.engine || '' };
        t.messages.push(msg); done.push({ role: s, text: msg.text });
        await saveThread(t);
      }
    } catch (e) {
      err = e.message || String(e);
      if (!t.id) { try { await saveThread(t); cur = t.id; } catch (_) {} }
    } finally { busy = null; draw(); }
  }

  /* ---------- отрисовка ---------- */
  function draw() {
    const fab = document.querySelector('.fab'); if (fab) fab.hidden = true;
    const cnt = { comp: of('competitor').length, ideas: of('idea').filter(x => x.status === 'new' || x.status === 'work').length, offers: of('offer').filter(x => x.status === 'active').length };
    $$('mk-tabs').innerHTML = TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === tab}" data-mktab="${k}">${l}${cnt[k] ? ` <em>${cnt[k]}</em>` : ''}</button>`).join('');
    { const tb = $$('mk-tabs'), a = tb.querySelector('[aria-selected="true"]'); if (a && (a.offsetLeft < tb.scrollLeft || a.offsetLeft + a.offsetWidth > tb.scrollLeft + tb.clientWidth)) tb.scrollLeft = a.offsetLeft - 12; }
    $$('mk-add').textContent = { cal: 'Добавить событие', ig: 'Добавить пост', create: 'Новый креатив', comp: 'Добавить конкурента', ideas: 'Добавить идею', offers: 'Новый оффер', about: 'Сохранить', chat: 'Новый разговор' }[tab];
    $$('mk-add').hidden = tab === 'about';
    $$('mk-chatv').hidden = tab !== 'chat'; $$('mk-view').hidden = tab === 'chat';
    if (tab === 'chat') return drawChat();
    let h = dbErr ? `<div class="note">${E(dbErr)}</div>` : '';
    if (!loaded) h += '<div class="mk-empty">Подключаемся к базе…</div>';
    else h += tab === 'cal' ? drawCal() : tab === 'ig' ? drawIG() : tab === 'create' ? drawCreate() : tab === 'about' ? drawAbout() : tab === 'comp' ? drawComp() : tab === 'ideas' ? drawIdeas() : drawOffers();
    if (tab === 'about' && $$('mk-about') && $$('mk-view').contains(document.activeElement) && document.activeElement.form === $$('mk-about')) return; // не мешаем печатать
    $$('mk-view').innerHTML = h;
    if (tab === 'ig') maybeAutoSync();
  }

  /* календарь */
  function drawCal() {
    const t = today(); if (!calYM) calYM = t.slice(0, 7);
    const [y, m] = calYM.split('-').map(Number);
    const from = calYM + '-01', to = monthEnd(calYM), pym = prevYM(calYM);
    const isCur = calYM === t.slice(0, 7);
    const pTo = isCur ? (() => { const e = monthEnd(pym); const d = pym + '-' + t.slice(8); return d > e ? e : d; })() : monthEnd(pym);
    const s = salesBy(from, isCur ? t : to), p = salesBy(pym + '-01', pTo);
    const g = goalOf(calYM) || {};
    const growth = p.rev ? Math.round((s.rev - p.rev) / p.rev * 100) : null;
    const evs = of('event').filter(e => e.date >= from && e.date <= to);
    const vis = evs.filter(e => !typeOff.has(etype(e)));
    const doneN = evs.filter(e => e.done).length;
    const pct = g.revenue ? Math.min(100, Math.round(s.rev / g.revenue * 100)) : 0;
    let h = `<div class="mk-mbar"><button class="mk-ib" type="button" data-mkmon="-1" aria-label="Предыдущий месяц">‹</button><h2>${MONTHS[m - 1]} ${y}</h2><button class="mk-ib" type="button" data-mkmon="1" aria-label="Следующий месяц">›</button>${isCur ? '' : '<button class="btn soft sm" type="button" data-mkmon="0">Сегодня</button>'}</div>`;
    h += `<div class="mk-kpis">
      <div class="mk-kpi"><span>Продажи за месяц</span><b>${money(s.rev)}</b><small>${s.n} ${plural(s.n, 'заказ', 'заказа', 'заказов')}${s.n ? ', средний чек ' + money(s.rev / s.n) : ''}</small></div>
      <div class="mk-kpi"><span>Рост к ${MDAT[(m + 10) % 12]}</span><b class="${growth === null ? '' : growth >= 0 ? 'up' : 'down'}">${growth === null ? '—' : (growth > 0 ? '+' : '') + growth + '%'}</b><small>${isCur ? 'те же дни прошлого месяца: ' : 'прошлый месяц: '}${money(p.rev)}</small></div>
      <button class="mk-kpi" type="button" data-mkgoal><span>Цель месяца${g.revenue ? '' : ' · задать'}</span><b>${g.revenue ? pct + '%' : '—'}</b>${g.revenue ? `<div class="mk-bar"><i style="width:${pct}%"></i></div><small>${money(s.rev)} из ${money(g.revenue)}${g.orders ? ', заказов ' + s.n + ' из ' + g.orders : ''}</small>` : '<small>нажмите, чтобы поставить цель по выручке</small>'}</button>
      <div class="mk-kpi"><span>План маркетинга</span><b>${doneN} из ${evs.length}</b><small>${evs.length ? 'событий выполнено' : 'событий пока нет'}</small></div>
    </div>`;
    if (g.note) h += `<div class="note"><b>Фокус месяца:</b> ${E(g.note)}</div>`;
    h += `<div class="mk-leg">${Object.entries(ETYPES).map(([k, e]) => `<button type="button" aria-pressed="${!typeOff.has(k)}" data-mktype="${k}" style="--ec:var(${e.c})"><i class="mk-dot"></i>${e.l} <em style="font-style:normal;opacity:.6">${evs.filter(x => etype(x) === k).length}</em></button>`).join('')}</div>`;
    const first = new Date(y, m - 1, 1), shift = (first.getDay() + 6) % 7, start = addDays(from, -shift);
    const weeks = Math.ceil((shift + +to.slice(8)) / 7);
    const daySales = new Map(); salesBy(from, to).list.forEach(([d, o]) => daySales.set(d, (daySales.get(d) || 0) + (+o.price || 0)));
    h += '<div class="mk-grid">' + ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(w => `<div class="mk-wd">${w}</div>`).join('');
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(start, i), out = d.slice(0, 7) !== calYM, L = vis.filter(e => e.date === d), sv = daySales.get(d) || 0;
      const lab = `${+d.slice(8)} ${MGEN[+d.slice(5, 7) - 1]}: ${L.length} ${plural(L.length, 'событие', 'события', 'событий')}${sv ? ', продажи ' + money(sv) : ''}`;
      h += `<button type="button" class="mk-day${out ? ' out' : ''}${d === t ? ' today' : ''}${d === selDay ? ' sel' : ''}" data-mkday="${d}" aria-label="${E(lab)}"><span class="n"><b>${+d.slice(8)}</b>${sv && !out ? `<small title="Продажи по учёту">${kShort(sv)}</small>` : ''}</span>${L.slice(0, 3).map(e => `<span class="mk-ev${e.done ? ' done' : ''}" style="--ec:var(${ETYPES[etype(e)].c})"><i class="mk-dot"></i><span>${E(e.title)}</span></span>`).join('')}${L.length > 3 ? `<span class="mk-more">ещё ${L.length - 3}</span>` : ''}<span class="mk-dots">${L.slice(0, 4).map(e => `<i class="mk-dot" style="--ec:var(${ETYPES[etype(e)].c})"></i>`).join('')}</span></button>`;
    }
    h += '</div>';
    const list = (selDay ? vis.filter(e => e.date === selDay) : vis).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
    h += `<div class="mk-agh"><h3>${selDay ? E(fmtDay(selDay)) : 'Все события месяца'}</h3><div class="mk-acts">${selDay ? `<button class="mk-a" type="button" data-mkday="">Весь месяц</button>` : ''}<button class="mk-a" type="button" data-mkaddev="${selDay || ''}">+ Событие${selDay ? ' на этот день' : ''}</button></div></div>`;
    if (selDay && daySales.get(selDay)) h += `<div class="note">Продажи в этот день по учёту: <b>${money(daySales.get(selDay))}</b></div>`;
    h += '<div class="mk-agenda">' + (list.length ? list.map(e => {
      const T = ETYPES[etype(e)];
      return `<div class="mk-it${e.done ? ' done' : ''}" style="--ec:var(${T.c})"><button type="button" class="mk-chk${e.done ? ' on' : ''}" data-mkdone="${E(e.id)}" aria-label="${e.done ? 'Отметить как не сделано' : 'Отметить как сделано'}" aria-pressed="${!!e.done}">✓</button>
        <div class="tx"><span class="tag"><i class="mk-dot"></i>${T.l}${selDay ? '' : ' · ' + E(fmtShort(e.date))}</span><b>${E(e.title)}</b>${e.notes ? `<small>${E(e.notes)}</small>` : ''}</div>
        <div class="mk-acts"><button class="mk-a" type="button" data-mkedit="event:${E(e.id)}">Изменить</button><button class="mk-a del" type="button" data-mkdel="${E(e.id)}" data-what="событие">Удалить</button></div></div>`;
    }).join('') : `<div class="mk-empty"><b>${selDay ? 'На этот день ничего не запланировано' : 'В этом месяце пока пусто'}</b>Добавьте событие вручную или попросите ИИ-команду составить план с датами — потом нажмите «Разложить в календарь» под ответом.</div>`) + '</div>';
    return h;
  }

  /* конкуренты */
  function drawComp() {
    const L = of('competitor').sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    let h = `<div class="mk-row"><small>Собирайте сюда конкурентов из 2ГИС, Instagram и OLX: что делают, цены, плюсы и минусы. Аналитик сравнит их с вами.</small>${L.length ? '<button class="btn outline sm" type="button" data-mkchat="analyst" data-q="Сравни нас со всеми конкурентами из раздела «Конкуренты»: таблица, где мы сильнее, где слабее, и 3 возможности.">Разобрать всех с аналитиком</button>' : ''}</div>`;
    if (!L.length) return h + `<div class="mk-empty"><b>Конкурентов пока нет</b>Начните с 3–5 студий в вашем городе: откройте 2ГИС по запросам «оклейка авто», «печать на футболках», «вывески» и перенесите сюда цены и отзывы.</div>`;
    const link = u => /^https?:\/\//.test(u) ? `<a href="${E(u)}" target="_blank" rel="noopener">${E(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50))}</a>` : E(u);
    return h + '<div class="mk-cards">' + L.map(c => `<div class="mk-card"><h3>${E(c.name)}</h3>${c.services ? `<span class="mk-pill">${E(c.services)}</span>` : ''}
      <dl>${c.link ? `<div><dt>Где смотреть</dt><dd>${link(c.link)}</dd></div>` : ''}${c.prices ? `<div><dt>Цены</dt><dd>${E(c.prices)}</dd></div>` : ''}${c.strong ? `<div><dt>Сильные стороны</dt><dd>${E(c.strong)}</dd></div>` : ''}${c.weak ? `<div><dt>Слабые места</dt><dd>${E(c.weak)}</dd></div>` : ''}${c.notes ? `<div><dt>Заметки</dt><dd>${E(c.notes)}</dd></div>` : ''}</dl>
      <div class="mk-acts"><button class="mk-a" type="button" data-mkchat="analyst" data-q="${E('Сравни нас с конкурентом «' + c.name + '»: цены, подача, что у них лучше и что можно забрать себе.')}">Сравнить с нами</button><button class="mk-a" type="button" data-mkedit="competitor:${E(c.id)}">Изменить</button><button class="mk-a del" type="button" data-mkdel="${E(c.id)}" data-what="конкурента">Удалить</button></div></div>`).join('') + '</div>';
  }

  /* идеи */
  function drawIdeas() {
    const all = of('idea').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const F = { open: ['Новые и в работе', x => x.status === 'new' || x.status === 'work'], done: ['Сделано', x => x.status === 'done'], drop: ['Отложили', x => x.status === 'drop'], all: ['Все', () => true] };
    const L = all.filter(F[ideaF][1]);
    let h = `<form class="mk-qadd" id="mk-qidea"><input name="t" placeholder="Новая идея — коротко, Enter чтобы добавить" aria-label="Новая идея" autocomplete="off"><select name="c" aria-label="Куда относится">${Object.entries(ICATS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><button class="btn primary sm" type="submit">Добавить</button></form>`;
    h += `<div class="mk-row"><div class="mk-filters">${Object.entries(F).map(([k, [l, f]]) => `<button type="button" aria-pressed="${k === ideaF}" data-mkif="${k}">${l} <em>${all.filter(f).length}</em></button>`).join('')}</div><button class="btn outline sm" type="button" data-mkchat="marketer" data-q="Предложи 10 идей, как без бюджета поднять продажи трёх главных услуг. Учти идеи, которые у нас уже есть в разделе «Идеи».">Идеи от маркетолога</button></div>`;
    if (!L.length) return h + `<div class="mk-empty"><b>${all.length ? 'Под этот фильтр идей нет' : 'Идей пока нет'}</b>Записывайте всё, что приходит в голову, — или сохраняйте идеи из ответов ИИ-команды кнопкой «В идеи».</div>`;
    return h + '<div class="mk-agenda">' + L.map(x => `<div class="mk-it${x.status === 'done' ? ' done' : ''}"><div class="tx"><span class="tag">${E(ICATS[x.cat] || 'Другое')}${x.createdAt ? ' · ' + fmtT(x.createdAt) : ''}${x.by ? ' · ' + E(x.by) : ''}</span><b>${E(x.title)}</b>${x.notes ? `<small>${E(x.notes.length > 400 ? x.notes.slice(0, 400) + '…' : x.notes)}</small>` : ''}</div>
      <div class="mk-acts"><select class="mk-st" data-mkist="${E(x.id)}" aria-label="Статус идеи">${Object.entries(ISTAT).map(([k, l]) => `<option value="${k}"${k === x.status ? ' selected' : ''}>${l}</option>`).join('')}</select><button class="mk-a" type="button" data-mkidcal="${E(x.id)}">В календарь</button><button class="mk-a" type="button" data-mkchat="marketer" data-q="${E('Как реализовать идею: «' + x.title + '»' + (x.notes ? ' (' + x.notes.slice(0, 300) + ')' : '') + '. Пошагово, с датами, и как понять, что сработало.')}">Обсудить</button><button class="mk-a" type="button" data-mkedit="idea:${E(x.id)}">Изменить</button><button class="mk-a del" type="button" data-mkdel="${E(x.id)}" data-what="идею">Удалить</button></div></div>`).join('') + '</div>';
  }

  /* офферы */
  function drawOffers() {
    const ord = { active: 0, draft: 1, archive: 2 };
    const all = of('offer').sort((a, b) => (ord[a.status] ?? 1) - (ord[b.status] ?? 1) || (b.updatedAt || 0) - (a.updatedAt || 0));
    const fit = k => x => k === 'all' ? x.status !== 'archive' : x.status === k;
    const L = all.filter(fit(offerF));
    let h = `<div class="mk-row"><div class="mk-filters">${[['all', 'Текущие'], ['active', 'Действуют'], ['draft', 'Черновики'], ['archive', 'Архив']].map(([k, l]) => `<button type="button" aria-pressed="${k === offerF}" data-mkof="${k}">${l} <em>${all.filter(fit(k)).length}</em></button>`).join('')}</div><button class="btn outline sm" type="button" data-mkchat="marketer" data-q="Придумай 3 оффера для трёх главных услуг с учётом нашего прайса и себестоимости: название, для кого, что входит, цена, почему выгодно клиенту и нам.">Офферы от маркетолога</button></div>`;
    if (!L.length) return h + `<div class="mk-empty"><b>${all.length ? 'Под этот фильтр офферов нет' : 'Офферов пока нет'}</b>Оффер — это готовое предложение: «набор табличек для кофейни за 25 000 ₸». Создайте свой или сохраните из ответа маркетолога кнопкой «В офферы».</div>`;
    const sc = { active: '--ok', draft: '--muted', archive: '--muted' };
    return h + '<div class="mk-cards">' + L.map(o => {
      const late = o.status === 'active' && o.until && o.until < today(), c = sc[o.status] || '--muted';
      return `<div class="mk-card"><span class="mk-pill" style="color:var(${late ? '--danger' : c})"><i class="mk-dot" style="--ec:var(${late ? '--danger' : c})"></i>${OSTAT[o.status] || 'Черновик'}${o.until ? ' · до ' + E(fmtShort(o.until)) : ''}${late ? ' · срок прошёл' : ''}</span><h3>${E(o.title)}</h3>
      <dl>${o.svc && o.svc !== 'other' ? `<div><dt>Услуга</dt><dd>${E(SVCS[o.svc] || '')}</dd></div>` : ''}${o.audience ? `<div><dt>Для кого</dt><dd>${E(o.audience)}</dd></div>` : ''}${o.includes ? `<div><dt>Что входит</dt><dd>${E(o.includes.length > 500 ? o.includes.slice(0, 500) + '…' : o.includes)}</dd></div>` : ''}${o.price ? `<div><dt>Цена</dt><dd><b>${E(o.price)}</b></dd></div>` : ''}</dl>
      <div class="mk-acts"><button class="mk-a" type="button" data-mkchat="marketer" data-q="${E('Напиши КП и короткое сообщение для WhatsApp по офферу «' + o.title + '».')}">КП</button><button class="mk-a" type="button" data-mkchat="smm" data-q="${E('Сделай пост, Reels и 3 сторис, чтобы продать оффер «' + o.title + '».')}">Контент</button><button class="mk-a" type="button" data-mkofcal="${E(o.id)}">В календарь</button><button class="mk-a" type="button" data-mkedit="offer:${E(o.id)}">Изменить</button></div></div>`;
    }).join('') + '</div>';
  }

  /* ИИ-команда */
  function msgHtml(m, i) {
    if (m.role === 'user') return `<div class="mk-m me"><div class="mk-b">${E(m.text)}</div></div>`;
    const R = ROLES[m.agent] || ROLES.marketer;
    const src = (m.sources || []).length ? `<div class="mk-src"><b>Источники</b>${m.sources.map(s => `<a href="${E(s.url)}" target="_blank" rel="noopener">${E(s.title || s.url)}</a>`).join('')}</div>` : '';
    return `<div class="mk-m" style="--rc:var(${R.c})"><div class="mk-ava" aria-hidden="true">${R.ini}</div><div class="mk-b">
      <div class="mk-who">${E(R.name)} <em>${m.at ? fmtT(m.at) : ''}</em></div>
      <div class="mk-md">${md(m.text)}</div>${src}
      ${busy ? '' : `<div class="mk-acts"><button class="mk-a" type="button" data-mkmsg="cal" data-i="${i}">Разложить в календарь</button><button class="mk-a" type="button" data-mkmsg="idea" data-i="${i}">В идеи</button><button class="mk-a" type="button" data-mkmsg="offer" data-i="${i}">В офферы</button><button class="mk-a" type="button" data-mkmsg="crt" data-i="${i}">Сделать креатив</button><button class="mk-a" type="button" data-mkmsg="copy" data-i="${i}">Копировать</button></div>`}</div></div>`;
  }
  const curThread = () => busy ? busy.thread : threads.find(x => x.id === cur && x.role === role);
  function drawChat() {
    $$('mk-team').innerHTML = Object.entries(ROLES).map(([k, r]) => `<button type="button" role="tab" aria-selected="${k === role}" class="mk-role${k === role ? ' on' : ''}" data-mkrole="${k}" style="--rc:var(${r.c})"><span class="mk-ava" aria-hidden="true">${r.ini}</span><div><b>${E(r.name)}</b><small>${E(r.sub)}</small></div></button>`).join('');
    const mine = threads.filter(t => t.role === role);
    $$('mk-hist').classList.toggle('empty', !mine.length);
    $$('mk-hist').innerHTML = `<h3>${E(ROLES[role].name)}: разговоры</h3>` + (mine.length ? mine.map(t => `<div class="mk-th${t.id === cur ? ' on' : ''}" data-mkopen="${E(t.id)}" role="button" tabindex="0" style="--rc:var(${ROLES[t.role].c})"><i class="d"></i><span>${E(t.title)}</span><em>${fmtT(t.updatedAt)}</em><button type="button" class="x" data-mkdelth="${E(t.id)}" aria-label="Удалить разговор">×</button></div>`).join('')
      : `<div class="w-empty">${loaded ? 'Разговоров пока нет' : 'Загружаем…'}</div>`);
    const t = curThread(), R = ROLES[role];
    let h = '';
    if (!t || !t.messages.length) h = `<div class="mk-intro"><b>${E(R.name)}</b> — ${E(R.sub)}. ${R.team ? 'На планёрке задачу разбирают по очереди: аналитик смотрит цифры и конкурентов, маркетолог строит стратегию, SMM-менеджер превращает её в контент и даёт план с датами.' : 'Видит прайс, продажи из учёта, ваших конкурентов, идеи, офферы и календарь.'}${brief ? '' : ' Заполните «Бриф студии» — так ответы будут точнее.'}<br><br>Готовый план с датами можно одной кнопкой разложить в календарь.</div>`;
    else h = t.messages.map(msgHtml).join('');
    if (busy) h += `<div class="mk-m" style="--rc:var(${ROLES[busy.step].c})"><div class="mk-ava" aria-hidden="true">${ROLES[busy.step].ini}</div><div class="mk-b mk-wait"><span class="mk-bl"><i></i><i></i><i></i></span>${E(ROLES[busy.step].name)} готовит ответ…</div></div>`;
    if (err) h += `<div class="mk-err" role="alert">${E(err)}</div>`;
    const box = $$('mk-msgs');
    box.innerHTML = h;
    $$('mk-quick').innerHTML = R.quick.map(q => `<button type="button" class="chip" data-mkq="${E(q)}">${E(q)}</button>`).join('');
    $$('mk-quick').hidden = !!(t && t.messages.length);
    $$('mk-send').disabled = !!busy;
    $$('mk-in').placeholder = R.team ? 'Задача для всей команды…' : 'Задача для: ' + R.name.toLowerCase() + '…';
    $$('mk-foot').textContent = (t && t.messages.length ? 'Специалист помнит этот разговор. ' : '') + 'Ответы ИИ бесплатные, но проверяйте цены и факты перед отправкой клиентам.';
    if (busy) setTimeout(() => box.lastElementChild && box.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
  }
  /* ======================= О студии ======================= */
  function aboutText() {
    const parts = ABOUT.filter(([k]) => String(about[k] || '').trim()).map(([k, l]) => `**${l}:** ${String(about[k]).trim()}`);
    if (brief && !about.notes) parts.push('**Заметки:** ' + brief);
    return parts.join('\n');
  }
  function drawAbout() {
    const filled = ABOUT.filter(([k]) => String(about[k] || '').trim()).length;
    const v = k => about[k] != null ? about[k] : (k === 'notes' ? brief : '');
    return `<div class="mk-row"><small>Всё, что ИИ-команда должна знать о студии. Чем подробнее, тем точнее советы, тексты и креативы. Заполнено ${filled} из ${ABOUT.length}.</small>${aboutAt ? `<small>Обновлено ${fmtT(aboutAt)}${about.by ? ', ' + E(about.by) : ''}</small>` : ''}</div>
      <form class="mk-about" id="mk-about">${ABOUT.map(([k, l, ph]) => `<label>${E(l)}<textarea name="${k}" rows="${k === 'services' || k === 'notes' ? 4 : 2}" placeholder="${E(ph)}">${E(v(k))}</textarea></label>`).join('')}
      <div class="mk-row mk-about-ft"><small>Instagram студии: @raz.brandstudio${ig && ig.profile ? ' · подключён' : ''}</small><button class="btn primary" type="submit">Сохранить</button></div></form>`;
  }
  async function saveAbout() {
    const fd = new FormData($$('mk-about')), d = { updatedAt: Date.now(), by: me() };
    ABOUT.forEach(([k]) => d[k] = String(fd.get(k) || '').trim());
    const b = $$('mk-about').querySelector('[type=submit]'); b.disabled = true;
    try { await col.doc('about').set(d); toastMsg('Сохранено. ИИ-команда теперь знает это о студии'); document.activeElement && document.activeElement.blur(); }
    catch (_) { toastMsg('Не сохранилось. Проверьте правила базы.'); }
    finally { b.disabled = false; draw(); }
  }

  /* ======================= Instagram ======================= */
  const igAll = () => {
    const tags = (ig && ig.tags) || {};
    const auto = ((ig && ig.posts) || []).map(p => ({ ...p, src: 'ig', date: (p.ts || '').slice(0, 10), rubric: tags[p.id] || '' }));
    const man = of('igpost').map(p => ({ id: p.id, src: 'manual', date: p.date, type: p.type || 'photo', caption: p.caption || '', link: p.link || '', likes: p.likes || null, comments: p.comments || null, reach: p.reach || null, thumb: p.photo || '', rubric: p.rubric || '' }));
    return [...auto, ...man].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  };
  const daysAgo = d => d ? Math.round((new Date(today()) - new Date(d)) / 864e5) : null;
  function coverage(posts) {
    return Object.entries(SVC_RX).map(([k, rx]) => {
      const L = posts.filter(p => rx.test(p.caption || ''));
      return { k, l: SVCS[k], n: L.length, last: L[0] ? L[0].date : '', n90: L.filter(p => daysAgo(p.date) <= 90).length };
    });
  }
  async function loadStatus() {
    if (status) return status;
    try { status = await (await fetch(MKT_API + '/api/status')).json(); } catch (_) { status = {}; }
    if (isOpen()) draw();
    return status;
  }
  function maybeAutoSync() {
    if (igAuto || igSyncing || !status) return;
    if (status.instagram && (!ig || !ig.syncedAt || Date.now() - ig.syncedAt > 6 * 36e5)) { igAuto = true; syncIG(true); }
  }
  async function syncIG(quiet) {
    if (igSyncing) return; igSyncing = true; if (!quiet) draw();
    try {
      const u = window.firebase && firebase.auth && firebase.auth().currentUser;
      if (!u) throw new Error('Войдите на сайт заново.');
      const res = await fetch(MKT_API + '/api/instagram', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await u.getIdToken() }, body: '{}' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Сервер ответил ' + res.status);
      await col.doc('ig').set({ profile: j.profile, posts: j.posts.slice(0, 200), syncedAt: Date.now(), tags: (ig && ig.tags) || {} });
      if (!quiet) toastMsg('Instagram обновлён: ' + j.posts.length + ' ' + plural(j.posts.length, 'публикация', 'публикации', 'публикаций'));
    } catch (e) { toastMsg(e.message); if (!quiet) err = e.message; }
    finally { igSyncing = false; if (isOpen()) draw(); }
  }
  async function setRubric(id, r) {
    const man = items.find(i => i.id === id && i.kind === 'igpost');
    if (man) return patchItem(id, { rubric: r });
    if (!ig) return;
    try { await col.doc('ig').set({ ...ig, tags: { ...(ig.tags || {}), [id]: r } }); } catch (_) { toastMsg('Не сохранилось'); }
  }
  function drawIG() {
    const all = igAll(), p = ig && ig.profile, on = status && status.instagram;
    let h = '';
    // профиль
    h += `<div class="mk-igp">${p && p.avatar ? `<img class="mk-av" src="${E(p.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<span class="mk-av ph">RAZ</span>'}
      <div class="tx"><b>@${E((p && p.username) || 'raz.brandstudio')}</b><small>${p ? [p.followers != null ? p.followers.toLocaleString('ru-RU') + ' подписчиков' : '', p.media != null ? p.media + ' публикаций' : ''].filter(Boolean).join(' · ') : 'Профиль ещё не подключён'}${ig && ig.syncedAt ? ' · обновлено ' + fmtT(ig.syncedAt) : ''}</small></div>
      <div class="mk-acts">${on ? `<button class="btn white sm" type="button" data-mkigsync ${igSyncing ? 'disabled' : ''}>${igSyncing ? 'Обновляем…' : 'Обновить из Instagram'}</button>` : ''}${all.length ? '<button class="btn outline sm" type="button" data-mkchat="smm" data-q="Разбери наш Instagram: что публикуем, что заходит лучше всего, каких услуг и рубрик не хватает, и дай план публикаций на 2 недели с датами.">Разобрать с SMM</button>' : ''}</div></div>`;
    if (!on) h += `<details class="mk-how"${all.length ? '' : ' open'}><summary>Подключить Instagram автоматически</summary>
      <ol><li>В приложении Instagram переключите аккаунт студии на профессиональный: Настройки → Тип аккаунта и инструменты → «Бизнес» или «Автор».</li>
      <li>Откройте <b>developers.facebook.com</b> → Мои приложения → Создать приложение → тип «Бизнес».</li>
      <li>В приложении добавьте продукт <b>Instagram</b> → «Настройка API с бизнес-входом через Instagram» → «Сгенерировать токен» рядом с @raz.brandstudio → войдите и скопируйте токен.</li>
      <li>В Cloudflare, воркер raz-marketing → Settings → Variables and Secrets → Add: тип Secret, имя <b>IG_TOKEN</b>, значение — токен → Deploy.</li>
      <li>Чтобы токен продлевался сам (иначе он живёт 60 дней): Storage & Databases → KV → создайте хранилище, затем в воркере Settings → Bindings → KV namespace, имя <b>IG_KV</b>.</li></ol>
      <p>Пока не подключили — добавляйте посты вручную кнопкой «Добавить пост».</p></details>`;
    if (!all.length) return h + `<div class="mk-empty"><b>Публикаций пока нет</b>${on ? 'Нажмите «Обновить из Instagram».' : 'Подключите Instagram или добавьте посты вручную — SMM-менеджер и дизайнер увидят, что у вас уже есть.'}</div>`;
    // цифры
    const m30 = all.filter(x => daysAgo(x.date) <= 30), last = all[0];
    const byType = Object.keys(IGTYPES).map(k => [k, all.filter(x => x.type === k).length]).filter(x => x[1]);
    const recent = all.slice(0, 30).filter(x => x.likes != null), avgL = recent.length ? Math.round(recent.reduce((s, x) => s + (+x.likes || 0), 0) / recent.length) : null;
    const best = [...all].filter(x => x.likes != null).sort((a, b) => (b.likes || 0) - (a.likes || 0))[0];
    h += `<div class="mk-kpis">
      <div class="mk-kpi"><span>Публикаций за 30 дней</span><b class="${m30.length < 8 ? 'down' : ''}">${m30.length}</b><small>${m30.length < 8 ? 'мало: цель 3–4 в неделю' : 'хороший ритм'}</small></div>
      <div class="mk-kpi"><span>Последняя публикация</span><b class="${daysAgo(last.date) > 7 ? 'down' : ''}">${daysAgo(last.date) === 0 ? 'сегодня' : daysAgo(last.date) + ' дн. назад'}</b><small>${E(fmtShort(last.date))}</small></div>
      <div class="mk-kpi"><span>Форматы</span><b>${byType.map(([k, n]) => n).join(' / ') || '—'}</b><small>${byType.map(([k]) => IGTYPES[k]).join(' / ')}</small></div>
      <div class="mk-kpi"><span>Средние лайки</span><b>${avgL ?? '—'}</b><small>${best ? 'лучший: ' + (best.likes || 0) + ' ❤ · ' + E(fmtShort(best.date)) : 'по последним 30'}</small></div></div>`;
    // что есть и чего нет
    const cov = coverage(all);
    h += `<div class="w mk-cov"><div class="w-h"><h2>Что есть и чего нет</h2><span class="c">по подписям постов</span></div>${cov.map(c => {
      const d = daysAgo(c.last), st = !c.n ? ['нет ни одного поста', '--danger'] : d > 30 ? ['давно: ' + d + ' дн. назад', '--st-prod'] : ['есть, последний ' + fmtShort(c.last), '--ok'];
      return `<div class="mk-covr"><i class="mk-dot" style="--ec:var(${st[1]})"></i><b>${E(c.l)}</b><small>${c.n} ${plural(c.n, 'пост', 'поста', 'постов')} · ${E(st[0])}</small><button class="mk-a" type="button" data-mkcrt="${c.k}">Сделать креатив</button></div>`;
    }).join('')}</div>`;
    // фильтры и сетка
    const rubN = Object.keys(RUBR).map(k => [k, all.filter(x => x.rubric === k).length]);
    const F = [['all', 'Все', all.length], ...Object.keys(IGTYPES).map(k => [k, IGTYPES[k], all.filter(x => x.type === k).length]).filter(x => x[2]), ['norub', 'Без рубрики', all.filter(x => !x.rubric).length], ...rubN.filter(x => x[1]).map(([k, n]) => ['r:' + k, RUBR[k], n])];
    if (!F.some(f => f[0] === igF)) igF = 'all';
    const L = all.filter(x => igF === 'all' ? true : igF === 'norub' ? !x.rubric : igF.startsWith('r:') ? x.rubric === igF.slice(2) : x.type === igF).slice(0, 120);
    h += `<div class="mk-filters">${F.map(([k, l, n]) => `<button type="button" aria-pressed="${k === igF}" data-mkigf="${k}">${E(l)} <em>${n}</em></button>`).join('')}</div>`;
    h += '<div class="mk-igrid">' + L.map(x => `<div class="mk-igc"><div class="mk-igi">${x.thumb ? `<img src="${E(x.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span>${E(IGTYPES[x.type] || 'Пост')}</span></div>
      <div class="mk-igt"><small>${E(fmtShort(x.date))}${x.likes != null ? ' · ❤ ' + x.likes : ''}${x.comments != null ? ' · 💬 ' + x.comments : ''}${x.reach ? ' · охват ' + x.reach : ''}${x.src === 'manual' ? ' · вручную' : ''}</small>
      <p>${E((x.caption || 'Без подписи').slice(0, 220))}</p>
      <div class="mk-acts"><select class="mk-st" data-mkrub="${E(x.id)}" aria-label="Рубрика"><option value="">Рубрика…</option>${Object.entries(RUBR).map(([k, l]) => `<option value="${k}"${k === x.rubric ? ' selected' : ''}>${l}</option>`).join('')}</select>${x.link ? `<a class="mk-a" href="${E(x.link)}" target="_blank" rel="noopener">Открыть</a>` : ''}${x.src === 'manual' ? `<button class="mk-a" type="button" data-mkedit="igpost:${E(x.id)}">Изменить</button>` : ''}</div></div></div>`).join('') + '</div>';
    return h;
  }
  function igContext() {
    const all = igAll(); if (!all.length) return '### Instagram @raz.brandstudio\nДанных пока нет.';
    const p = ig && ig.profile;
    const cov = coverage(all).map(c => `${c.l}: ${c.n} постов${c.last ? ', последний ' + c.last : ''}`).join('; ');
    return '### Instagram @raz.brandstudio\n' + (p ? `Подписчиков: ${p.followers ?? '—'}, публикаций: ${p.media ?? '—'}\n` : '') +
      `Публикаций за 30 дней: ${all.filter(x => daysAgo(x.date) <= 30).length}\nПо услугам: ${cov}\nПоследние публикации:\n` +
      all.slice(0, 30).map(x => `- ${x.date} ${IGTYPES[x.type] || 'пост'}${x.rubric ? ' [' + RUBR[x.rubric] + ']' : ''}${x.likes != null ? ' ❤' + x.likes : ''}${x.comments != null ? ' 💬' + x.comments : ''}: ${String(x.caption || '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
  }

  /* ======================= Креативы ======================= */
  const C = () => window.RAZCreative;
  function toCreate(topic, svc) {
    tab = 'create'; save();
    crt = { ...crt, topic: topic || crt.topic, svc: svc || crt.svc, variants: [], previews: [], caption: '', err: '', note: '' };
    draw(); const x = $$('mk-ct'); if (x) { x.focus(); x.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  function drawCreate() {
    if (!C()) return '<div class="mk-empty">Модуль креативов не загрузился. Обновите страницу.</div>';
    const F = C().FORMATS;
    let h = `<form class="w mk-cform" id="mk-cform">
      <div class="w-h"><h2>Дизайнер креативов</h2><span class="c">3 варианта за раз, бесплатно</span></div>
      <label class="mk-lab">О чём креатив<textarea id="mk-ct" rows="3" placeholder="Например: акция на наклейку логотипа на заднее стекло, сделаем за 1 день">${E(crt.topic)}</textarea></label>
      <div class="mk-crow">
        <label class="mk-lab">Услуга<select id="mk-csvc">${Object.entries(SVCS).map(([k, l]) => `<option value="${k}"${k === crt.svc ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="mk-lab">Формат<div class="mk-seg">${Object.entries(F).map(([k, f]) => `<button type="button" aria-pressed="${k === crt.format}" data-mkfmt="${k}">${f.l}</button>`).join('')}</div></div>
      </div>
      <div class="mk-crow">
        <div class="mk-lab">Фото<div class="mk-photo">${crt.photoUrl ? `<img src="${crt.photoUrl}" alt="Загруженное фото"><button type="button" class="mk-a del" data-mkcphx>Убрать</button>` : '<label class="btn white sm" for="mk-cphoto" style="cursor:pointer">Загрузить своё фото</label>'}<input type="file" id="mk-cphoto" accept="image/*" hidden></div></div>
        <label class="mk-ck"><input type="checkbox" id="mk-cai"${crt.useAI ? ' checked' : ''}${status && status.images === false ? ' disabled' : ''}> Нет фото — нарисовать фон ИИ${status && status.images === false ? ' (подключите Workers AI)' : ''}</label>
      </div>
      <div class="mk-row"><small>${E(crt.note || 'Своё фото работы всегда смотрится сильнее ИИ-фона. Тексты и цены дизайнер берёт из прайса и раздела «О студии».')}</small><button class="btn primary" type="submit" ${crt.busy ? 'disabled' : ''}>${crt.busy ? E(crt.busy) : crt.variants.length ? 'Придумать заново' : 'Придумать креативы'}</button></div>
      ${crt.err ? `<div class="mk-err" role="alert">${E(crt.err)}</div>` : ''}
    </form>`;
    if (crt.variants.length) {
      h += `${crt.caption ? `<div class="w mk-cap"><div class="w-h"><h2>Подпись к посту</h2><button class="mk-a" type="button" data-mkcapcopy>Копировать</button></div><p>${E(crt.caption)}</p></div>` : ''}
      <div class="mk-cgrid">${crt.variants.map((v, i) => `<div class="mk-cc"><div class="mk-cimg fmt-${crt.format}">${crt.previews[i] ? `<img src="${crt.previews[i]}" alt="${E(v.headline)}">` : '<span class="mk-bl"><i></i><i></i><i></i></span>'}</div>
        <div class="mk-acts"><button class="mk-a" type="button" data-mkcedit="${i}">Изменить</button><button class="mk-a" type="button" data-mkcdl="${i}">Скачать PNG</button><button class="mk-a" type="button" data-mkcsave="${i}">Сохранить</button></div></div>`).join('')}</div>`;
    }
    const saved = of('creative').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    h += `<div class="mk-agh"><h3>Сохранённые креативы</h3><small style="color:var(--muted)">${saved.length}</small></div>`;
    h += saved.length ? '<div class="mk-cgrid sm">' + saved.map(x => `<div class="mk-cc"><div class="mk-cimg fmt-${E(x.format || 'post')}"><img src="${E(x.img)}" alt="${E(x.title)}"></div><b class="mk-ct">${E(x.title)}</b>
      <div class="mk-acts"><a class="mk-a" href="${E(x.img)}" download="raz-${E((x.title || 'креатив').slice(0, 30))}.jpg">Скачать</a>${x.caption ? `<button class="mk-a" type="button" data-mkscap="${E(x.id)}">Подпись</button>` : ''}<button class="mk-a" type="button" data-mkscal="${E(x.id)}">В календарь</button><button class="mk-a del" type="button" data-mkdel="${E(x.id)}" data-what="креатив">Удалить</button></div></div>`).join('') + '</div>'
      : '<div class="mk-empty">Здесь будут креативы, которые вы сохраните. Их видит вся команда.</div>';
    return h;
  }
  async function paintPreviews() {
    if (!C() || !crt.variants.length) return;
    const img = crt.photo || crt.bg;
    for (let i = 0; i < crt.variants.length; i++) {
      if (crt.previews[i]) continue;
      try { const c = await C().render(crt.variants[i], { format: crt.format, img }); crt.previews[i] = c.toDataURL('image/jpeg', 0.86); }
      catch (_) { crt.previews[i] = ''; }
      if (tab === 'create' && isOpen()) { const box = document.querySelectorAll('.mk-cimg')[i]; if (box && crt.previews[i]) box.innerHTML = `<img src="${crt.previews[i]}" alt="">`; }
    }
  }
  async function crtGenerate() {
    const topic = ($$('mk-ct') && $$('mk-ct').value.trim()) || crt.topic;
    if (!topic) { crt.err = 'Напишите, о чём креатив.'; draw(); return; }
    crt.topic = topic; crt.err = ''; crt.note = ''; crt.busy = 'Дизайнер придумывает…'; crt.variants = []; crt.previews = []; draw();
    try {
      const fmt = C().FORMATS[crt.format].l;
      const r = await ask('designer', [{ role: 'user', text: `Креатив для Instagram, формат: ${fmt}. Услуга: ${SVCS[crt.svc]}.\nЗадача: ${topic}\n${crt.photo ? 'Есть своё фото работы — используй шаблоны с фото.' : crt.useAI ? 'Своего фото нет, фон нарисует ИИ по bg_prompt.' : 'Фото нет — лучше шаблоны bold и list.'}` }]);
      let j; try { j = JSON.parse(String(r.text).replace(/^\s*```(json)?/, '').replace(/```\s*$/, '').trim()); } catch (_) { throw new Error('Дизайнер ответил в непонятном виде. Нажмите ещё раз.'); }
      const tpl = Object.keys(C().TEMPLATES), th = Object.keys(C().THEMES);
      crt.variants = (j.variants || []).filter(v => v && v.headline).slice(0, 4).map((v, i) => ({
        template: tpl.includes(v.template) ? v.template : tpl[i % tpl.length], theme: th.includes(v.theme) ? v.theme : 'blue',
        headline: String(v.headline).slice(0, 90), sub: String(v.sub || '').slice(0, 160), bullets: (Array.isArray(v.bullets) ? v.bullets : []).map(String).slice(0, 5),
        price: String(v.price || '').slice(0, 30), cta: String(v.cta || 'Пиши в Direct').slice(0, 30), badge: String(v.badge || '').slice(0, 20), bg_prompt: String(v.bg_prompt || '')
      }));
      if (!crt.variants.length) throw new Error('Дизайнер не прислал вариантов. Нажмите ещё раз.');
      crt.caption = String(j.caption || '');
      if (!crt.photo && crt.useAI && !(status && status.images === false)) {
        crt.busy = 'ИИ рисует фон…'; draw();
        try { crt.bg = await C().loadImg(await aiImage(crt.variants[0].bg_prompt || topic)); }
        catch (e) { crt.bg = null; crt.note = 'Фон от ИИ не получился (' + e.message + '). Креативы собраны без фото — можно загрузить своё.'; }
      } else if (crt.photo) crt.bg = null;
    } catch (e) { crt.err = e.message; }
    finally { crt.busy = ''; draw(); paintPreviews(); }
  }
  async function aiImage(prompt) {
    const u = window.firebase && firebase.auth && firebase.auth().currentUser;
    if (!u) throw new Error('Войдите на сайт заново.');
    const res = await fetch(MKT_API + '/api/image', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await u.getIdToken() }, body: JSON.stringify({ prompt }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.image) throw new Error(j.error || 'сервер ответил ' + res.status);
    return j.image;
  }
  async function crtCanvas(i) { return C().render(crt.variants[i], { format: crt.format, img: crt.photo || crt.bg }); }
  async function download(canvas, name) {
    const b = await C().toBlob(canvas), u = URL.createObjectURL(b), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  }
  async function crtSave(i, btn) {
    const lbl = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…'; }
    try {
      const assets = await window.claude.use('assets'); if (!assets) throw new Error('Загрузка картинок недоступна');
      const c = await crtCanvas(i), b = await C().toBlob(c);
      const up = await assets.upload(new File([b], 'raz-creative.png', { type: 'image/png' }));
      const v = crt.variants[i];
      await saveItem('creative', null, { title: v.headline, img: up.url, caption: crt.caption, format: crt.format, svc: crt.svc, spec: v, topic: crt.topic.slice(0, 500) });
      toastMsg('Креатив сохранён');
    } catch (e) { toastMsg('Не сохранилось: ' + (e.message || 'ошибка')); }
    finally { if (btn) { btn.disabled = false; btn.textContent = lbl; } }
  }
  /* редактор варианта */
  let liveT = null;
  function crtOpen(i) {
    const v = crt.variants[i], C_ = C();
    const sel = (n, o, cur) => `<select name="${n}">${Object.entries(o).map(([k, x]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${E(x.l || x)}</option>`).join('')}</select>`;
    $$('mk-dform').innerHTML = `<h2>Креатив</h2><div class="mk-ced"><div class="mk-cprev fmt-${crt.format}"><canvas id="mk-ccv"></canvas></div><div class="mk-cfields">
      <div class="two"><label>Шаблон${sel('template', C_.TEMPLATES, v.template)}</label><label>Цвета${sel('theme', C_.THEMES, v.theme)}</label></div>
      <label>Заголовок<textarea name="headline" rows="2">${E(v.headline)}</textarea></label>
      <label>Подзаголовок<textarea name="sub" rows="2">${E(v.sub)}</textarea></label>
      <label>Пункты списка (каждый с новой строки)<textarea name="bullets" rows="3">${E(v.bullets.join('\n'))}</textarea></label>
      <div class="two"><label>Цена<input name="price" value="${E(v.price)}"></label><label>Плашка<input name="badge" value="${E(v.badge)}"></label></div>
      <label>Кнопка-призыв<input name="cta" value="${E(v.cta)}"></label></div></div>
      <div class="ft"><button type="button" class="btn soft sm" data-mkdfx>Закрыть</button><button type="button" class="btn outline sm" data-mkcdl2>Скачать PNG</button><button type="button" class="btn outline sm" data-mkcsave2>Сохранить</button><button type="submit" class="btn primary sm">Готово</button></div>`;
    dlg = { kind: 'crt', i };
    $$('mk-dlg').classList.add('wide'); $$('mk-dlg').showModal();
    crtLive();
  }
  function crtApply(close) {
    if (!dlg || dlg.kind !== 'crt') return;
    const fd = new FormData($$('mk-dform')), v = crt.variants[dlg.i];
    ['template', 'theme', 'headline', 'sub', 'price', 'badge', 'cta'].forEach(k => v[k] = String(fd.get(k) || '').trim());
    v.bullets = String(fd.get('bullets') || '').split('\n').map(x => x.trim()).filter(Boolean);
    crt.previews[dlg.i] = '';
    if (close) { $$('mk-dlg').classList.remove('wide'); closeDlg(); paintPreviews(); }
  }
  function crtLive() {
    clearTimeout(liveT);
    liveT = setTimeout(async () => { if (!dlg || dlg.kind !== 'crt') return; crtApply(false); const cv = $$('mk-ccv'); if (cv) await C().render(crt.variants[dlg.i], { format: crt.format, img: crt.photo || crt.bg, canvas: cv }); }, 150);
  }

  /* ======================= клики новых разделов ======================= */
  function onExtraClick(t, e) {
    const g = (sel, fn) => { const el = t.closest(sel); if (el) { fn(el); return true; } return false; };
    return g('[data-mkigsync]', () => syncIG(false))
      || g('[data-mkigf]', el => { igF = el.dataset.mkigf; draw(); })
      || g('[data-mkcrt]', el => toCreate('Пост про услугу «' + SVCS[el.dataset.mkcrt] + '»: покажем результат и позовём заказать', el.dataset.mkcrt))
      || g('[data-mkfmt]', el => { crt.format = el.dataset.mkfmt; crt.previews = []; draw(); paintPreviews(); })
      || g('[data-mkcphx]', () => { if (crt.photoUrl) URL.revokeObjectURL(crt.photoUrl); crt.photo = null; crt.photoUrl = ''; crt.previews = []; draw(); paintPreviews(); })
      || g('[data-mkcedit]', el => crtOpen(+el.dataset.mkcedit))
      || g('[data-mkcdl]', async el => download(await crtCanvas(+el.dataset.mkcdl), 'raz-креатив-' + (+el.dataset.mkcdl + 1) + '.png'))
      || g('[data-mkcsave]', el => crtSave(+el.dataset.mkcsave, el))
      || g('[data-mkcapcopy]', async el => { try { await navigator.clipboard.writeText(crt.caption); el.textContent = 'Скопировано'; } catch (_) {} })
      || g('[data-mkscap]', async el => { const x = items.find(i => i.id === el.dataset.mkscap); try { await navigator.clipboard.writeText(x.caption); el.textContent = 'Скопировано'; } catch (_) {} })
      || g('[data-mkscal]', el => { const x = items.find(i => i.id === el.dataset.mkscal); if (x) openForm('event', null, { title: 'Публикация: ' + x.title, type: 'content', notes: x.caption ? x.caption.slice(0, 600) : '' }); });
  }
  /* кнопки внутри окна редактора креатива */
  document.addEventListener('click', async e => {
    if (!dlg || dlg.kind !== 'crt' || !e.target.closest) return;
    if (e.target.closest('[data-mkcdl2]')) { crtApply(false); download(await crtCanvas(dlg.i), 'raz-креатив.png'); }
    if (e.target.closest('[data-mkcsave2]')) { crtApply(false); crtSave(dlg.i, e.target.closest('[data-mkcsave2]')); }
  });
  loadStatus();

  /* стили новых разделов */
  const st2 = document.createElement('style');
  st2.textContent = `
  .mk-about{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .mk-about label,.mk-lab{display:flex;flex-direction:column;gap:6px;font:600 13px var(--f);color:var(--muted);min-width:0}
  .mk-about textarea,.mk-cform textarea,.mk-cform select{width:100%;border:0;background:var(--tile);border-radius:14px;padding:11px 14px;line-height:1.45;resize:vertical;color:var(--ink);font:400 15px/1.45 var(--fb)}
  .mk-cform textarea,.mk-cform select{background:var(--paper)}
  .mk-about-ft{grid-column:1/-1}
  .mk-igp{display:flex;align-items:center;gap:14px;background:var(--tile);border-radius:22px;padding:14px 16px;flex-wrap:wrap}
  .mk-av{width:64px;height:64px;border-radius:50%;object-fit:cover;flex:none;background:var(--blue)}
  .mk-av.ph{display:grid;place-items:center;color:#fff;font:800 16px var(--f)}
  .mk-igp .tx{flex:1;min-width:160px}.mk-igp b{display:block;font:800 20px/1.2 var(--f)}.mk-igp small{color:var(--muted)}
  .mk-how{background:var(--tile);border-radius:22px;padding:14px 18px;font-size:14.5px}
  .mk-how summary{cursor:pointer;font:700 15px var(--f);color:var(--blue)}.mk-how ol{margin:10px 0;padding-left:22px;display:grid;gap:6px}.mk-how p{margin:0;color:var(--muted)}
  .mk-cov{gap:8px}.mk-covr{display:flex;align-items:center;gap:10px;background:var(--paper);border-radius:14px;padding:10px 12px;flex-wrap:wrap}
  .mk-covr b{font:700 14.5px var(--f)}.mk-covr small{color:var(--muted);flex:1;min-width:140px}
  .mk-igrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
  .mk-igc{background:var(--tile);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;min-width:0}
  .mk-igi{position:relative;aspect-ratio:4/5;background:linear-gradient(135deg,var(--tile-2),var(--line));display:grid;place-items:center}
  .mk-igi img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .mk-igi span{position:absolute;left:8px;top:8px;background:rgba(10,11,20,.7);color:#fff;font:600 11.5px var(--f);padding:3px 8px;border-radius:99px}
  .mk-igt{padding:10px 12px 12px;display:flex;flex-direction:column;gap:6px;flex:1}.mk-igt small{color:var(--muted);font-size:12px}
  .mk-igt p{margin:0;font-size:13.5px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;flex:1}
  .mk-igt .mk-acts{justify-content:flex-start}
  .mk-cform{gap:12px}.mk-crow{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:end}
  .mk-seg{display:flex;gap:4px;background:var(--paper);border-radius:999px;padding:4px;flex-wrap:wrap}
  .mk-seg button{flex:1;min-height:38px;padding:0 12px;border-radius:999px;font:600 13px var(--f);color:var(--muted);white-space:nowrap}
  .mk-seg button[aria-pressed="true"]{background:var(--ink);color:#fff}
  .mk-photo{display:flex;align-items:center;gap:10px;min-height:46px}.mk-photo img{width:46px;height:46px;border-radius:12px;object-fit:cover}
  .mk-ck{display:flex;align-items:center;gap:10px;font:600 14px var(--f);min-height:46px}.mk-ck input{width:20px;height:20px}
  .mk-cap p{margin:0;white-space:pre-wrap;font-size:14.5px;background:var(--paper);border-radius:14px;padding:12px 14px}
  .mk-cgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.mk-cgrid.sm{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
  .mk-cc{background:var(--tile);border-radius:22px;padding:10px;display:flex;flex-direction:column;gap:8px;min-width:0}
  .mk-cc .mk-acts{justify-content:flex-start}.mk-cc .mk-ct{font:700 14px/1.3 var(--f);padding:0 4px}
  .mk-cimg{border-radius:14px;overflow:hidden;background:var(--paper);display:grid;place-items:center;aspect-ratio:4/5}
  .mk-cimg.fmt-story{aspect-ratio:9/16}.mk-cimg.fmt-square{aspect-ratio:1}
  .mk-cimg img{width:100%;height:100%;object-fit:cover;display:block}
  .mk-dlg.wide{width:min(980px,calc(100vw - 24px))}
  .mk-ced{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:16px;align-items:start}
  .mk-cprev{border-radius:16px;overflow:hidden;background:var(--tile);position:sticky;top:0}.mk-cprev canvas{width:100%;height:auto;display:block}
  .mk-cfields{display:flex;flex-direction:column;gap:10px}
  @media(max-width:860px){.mk-cgrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:700px){.mk-about{grid-template-columns:1fr}.mk-crow{grid-template-columns:1fr}.mk-cgrid,.mk-cgrid.sm{grid-template-columns:1fr 1fr}.mk-igrid{grid-template-columns:1fr 1fr}.mk-igt p{-webkit-line-clamp:2}
    .mk-ced{grid-template-columns:1fr}.mk-cprev{position:static;max-width:260px;margin:0 auto}.mk-dlg.wide{width:100vw}}`;
  document.head.appendChild(st2);

  window.renderMarketing = draw;

  /* заголовок из ответа ИИ */
  const firstLine = txt => (String(txt).split('\n').map(l => l.replace(/^[#>*\-\d.)\s]+/, '').replace(/\*\*/g, '').trim()).find(l => l.length > 3) || 'Из ответа ИИ').slice(0, 90);

  /* ---------- события ---------- */
  document.addEventListener('click', async e => {
    const t = e.target;
    if (!t.closest) return;
    if (t.closest('#mk-dlg')) {
      if (t.closest('[data-mkdfx]')) closeDlg();
      else if (t.closest('[data-mkdfdel]')) { const id = dlg.id; closeDlg(); delItem(id, 'запись'); }
      else if (t === $$('mk-dlg')) closeDlg();
      return;
    }
    if (!t.closest('#p-marketing')) return;
    const g = (sel, fn) => { const el = t.closest(sel); if (el) { fn(el); return true; } return false; };
    if (g('[data-mktab]', el => { tab = el.dataset.mktab; err = ''; save(); draw(); })) return;
    if (t.closest('#mk-add')) {
      if (tab === 'chat') { cur = null; err = ''; draw(); $$('mk-in').focus(); }
      else if (tab === 'create') { crt = { ...crt, topic: '', variants: [], previews: [], caption: '', err: '', note: '' }; draw(); const x = $$('mk-ct'); if (x) x.focus(); }
      else openForm({ cal: 'event', ig: 'igpost', comp: 'competitor', ideas: 'idea', offers: 'offer' }[tab]);
      return;
    }
    if (onExtraClick(t, e)) return;
    // календарь
    if (g('[data-mkmon]', el => { const v = +el.dataset.mkmon; calYM = v === 0 ? today().slice(0, 7) : v < 0 ? prevYM(calYM) : nextYM(calYM); selDay = ''; draw(); })) return;
    if (g('[data-mkday]', el => { const d = el.dataset.mkday; selDay = d && selDay !== d ? d : ''; draw(); if (selDay && window.innerWidth < 700) setTimeout(() => { const a = document.querySelector('.mk-agh'); if (a) a.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 30); })) return;
    if (g('[data-mktype]', el => { const k = el.dataset.mktype; typeOff.has(k) ? typeOff.delete(k) : typeOff.add(k); draw(); })) return;
    if (g('[data-mkgoal]', () => openForm('goal', 'goal-' + calYM))) return;
    if (g('[data-mkaddev]', el => openForm('event', null, { date: el.dataset.mkaddev || (calYM === today().slice(0, 7) ? today() : calYM + '-01') }))) return;
    if (g('[data-mkdone]', el => { const x = items.find(i => i.id === el.dataset.mkdone); if (x) patchItem(x.id, { done: !x.done }); })) return;
    if (g('[data-mkedit]', el => { const [k, id] = el.dataset.mkedit.split(':'); openForm(k, id); })) return;
    if (g('[data-mkdel]', el => delItem(el.dataset.mkdel, el.dataset.what || 'запись'))) return;
    // идеи и офферы
    if (g('[data-mkif]', el => { ideaF = el.dataset.mkif; draw(); })) return;
    if (g('[data-mkof]', el => { offerF = el.dataset.mkof; draw(); })) return;
    if (g('[data-mkidcal]', el => { const x = items.find(i => i.id === el.dataset.mkidcal); if (x) openForm('event', null, { title: x.title.slice(0, 120), notes: x.notes || '', type: x.cat === 'content' ? 'content' : x.cat === 'offer' ? 'offer' : x.cat === 'channel' || x.cat === 'partner' ? 'sales' : 'strategy' }); })) return;
    if (g('[data-mkofcal]', el => { const x = items.find(i => i.id === el.dataset.mkofcal); if (x) openForm('event', null, { title: 'Запуск оффера: ' + x.title, type: 'offer', notes: [x.audience, x.price].filter(Boolean).join(', ') }); })) return;
    if (g('[data-mkchat]', el => toChat(el.dataset.mkchat, el.dataset.q || ''))) return;
    // чат
    if (g('[data-mkrole]', el => { role = el.dataset.mkrole; save(); const last = threads.find(x => x.role === role); cur = last ? last.id : null; err = ''; draw(); })) return;
    const dt = t.closest('[data-mkdelth]'); if (dt) { e.stopPropagation(); if (!confirm('Удалить этот разговор?')) return; try { await col.doc(dt.dataset.mkdelth).delete(); if (cur === dt.dataset.mkdelth) cur = null; } catch (_) { toastMsg('Не удалось удалить'); } return; }
    if (g('[data-mkopen]', el => { cur = el.dataset.mkopen; err = ''; draw(); })) return;
    if (g('[data-mkq]', el => send(el.dataset.mkq))) return;
    const mb = t.closest('[data-mkmsg]');
    if (mb) {
      const th = curThread(), m = th && th.messages[+mb.dataset.i]; if (!m) return;
      const a = mb.dataset.mkmsg;
      if (a === 'copy') { try { await navigator.clipboard.writeText(m.text); mb.textContent = 'Скопировано'; setTimeout(() => (mb.textContent = 'Копировать'), 1500); } catch (_) {} }
      if (a === 'cal') planToCalendar(m.text, mb);
      if (a === 'idea') openForm('idea', null, { title: firstLine(m.text), notes: m.text.slice(0, 4000), cat: m.agent === 'smm' ? 'content' : 'other' });
      if (a === 'offer') openForm('offer', null, { title: firstLine(m.text), includes: m.text.slice(0, 4000) });
      if (a === 'crt') toCreate(m.text.slice(0, 1500));
    }
  });
  document.addEventListener('input', e => { if (dlg && dlg.kind === 'crt' && e.target.closest && e.target.closest('#mk-dform')) crtLive(); if (e.target && e.target.id === 'mk-ct') crt.topic = e.target.value; });
  document.addEventListener('change', e => {
    if (dlg && dlg.kind === 'crt' && e.target.closest && e.target.closest('#mk-dform')) crtLive();
    if (e.target && e.target.id === 'mk-cphoto' && e.target.files[0]) { const f = e.target.files[0]; if (crt.photoUrl) URL.revokeObjectURL(crt.photoUrl); crt.photoUrl = URL.createObjectURL(f); RAZCreative.loadImg(crt.photoUrl).then(i => { crt.photo = i; crt.previews = []; draw(); paintPreviews(); }); }
    if (e.target && e.target.id === 'mk-csvc') crt.svc = e.target.value;
    if (e.target && e.target.id === 'mk-cai') crt.useAI = e.target.checked;
    const rb = e.target.closest && e.target.closest('[data-mkrub]'); if (rb) setRubric(rb.dataset.mkrub, rb.value);
    const s = e.target.closest && e.target.closest('[data-mkist]');
    if (s) patchItem(s.dataset.mkist, { status: s.value });
  });
  document.addEventListener('keydown', e => {
    if (e.target && e.target.matches && e.target.matches('[data-mkopen]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.target.click(); }
    if (e.target && e.target.id === 'mk-in' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(e.target.value); }
  });
  document.addEventListener('submit', async e => {
    const id = e.target.id;
    if (id === 'mk-form') { e.preventDefault(); send($$('mk-in').value); }
    if (id === 'mk-dform') { e.preventDefault(); if (dlg && dlg.kind === 'plan') submitPlan(); else if (dlg && dlg.kind === 'crt') crtApply(true); else if (dlg) submitForm(); }
    if (id === 'mk-about') { e.preventDefault(); saveAbout(); }
    if (id === 'mk-cform') { e.preventDefault(); crtGenerate(); }
    if (id === 'mk-qidea') {
      e.preventDefault(); const f = e.target, v = f.t.value.trim(); if (!v || !col) return;
      f.t.value = '';
      try { await saveItem('idea', null, { title: v.slice(0, 200), cat: f.c.value, status: 'new', notes: '' }); if (ideaF !== 'open' && ideaF !== 'all') ideaF = 'open'; } catch (_) { toastMsg('Не сохранилось'); }
      setTimeout(() => { const n = document.querySelector('#mk-qidea input'); if (n) n.focus(); }, 50);
    }
  });
  /* Esc закрывает окно: убираем состояние диалога */
  document.addEventListener('close', e => { if (e.target && e.target.id === 'mk-dlg' && dlg) { dlg = null; draw(); } }, true);

  init();
})();
