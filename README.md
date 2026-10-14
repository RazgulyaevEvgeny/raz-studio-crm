# Учёт студии брендирования Разгуляев

Веб-приложение для сотрудников студии: заказы и ведомость, календарь с задачами, поручения от начальства, расходы офиса, закупка расходников, проекты и прайс.

Сайт работает на GitHub Pages, данные хранятся в Firebase (Google) в базе Firestore на бесплатном тарифе Spark. Фото сжимаются в браузере примерно до 300 КБ и тоже хранятся в Firestore, поэтому Storage и привязка карты не нужны. Можно прикреплять фото и PDF до 700 КБ, видео не поддерживается. Сотрудники входят по почте и паролю.

## Файлы

| Файл | Что это |
|---|---|
| `index.html` | Сама страница учёта |
| `firebase-bridge.js` | Связка страницы с Firebase и экран входа |
| `firebase-config.js` | Настройки вашего проекта Firebase (заполнить один раз) |
| `firestore.rules` | Правила доступа к базе: только вошедшие сотрудники |
| `storage.rules` | Правила для Storage, если когда-нибудь включите его (сейчас не используется) |

## Настройка Firebase (один раз, около 15 минут)

1. Откройте [console.firebase.google.com](https://console.firebase.google.com), нажмите «Создать проект», назовите его, например, `raz-studio`. Google Analytics можно выключить.
2. **Вход сотрудников.** Слева Security → Authentication → Get started → вкладка Sign-in method → Email/Password → включить → Save. Затем вкладка Users → Add user: добавьте почту и пароль для себя и каждого сотрудника.
3. **База.** Databases & Storage → Firestore Database → Create database → редакция Standard, регион `europe-west3 (Frankfurt)` → Start in production mode. Затем вкладка Rules: замените текст содержимым файла `firestore.rules` → Publish.
4. **Настройки для сайта.** Шестерёнка → Project settings → General → внизу «Your apps» → значок `</>` (Web) → назовите приложение → Register. Скопируйте значения из блока `firebaseConfig` в файл `firebase-config.js` вместо надписей «ВСТАВЬТЕ».
5. **Разрешить домен.** Authentication → Settings → Authorized domains → Add domain → `razgulyaevevgeny.github.io`.

## Публикация на GitHub Pages

Репозиторий → Settings → Pages → Source: Deploy from a branch → Branch: `main`, папка `/ (root)` → Save. Через минуту сайт откроется по адресу `https://razgulyaevevgeny.github.io/<имя-репозитория>/`.

## Новые сотрудники

Добавляются в Firebase: Authentication → Users → Add user. Удалить или сменить пароль можно там же.

## Сколько места

Бесплатно Firestore даёт 1 ГБ. Записи заказов почти не занимают места, основное — фото: примерно 3 000 сжатых фото. Если места станет мало, можно включить Storage (нужен тариф Blaze) и перенести файлы туда.

## Маркетинговый отдел (ИИ)

Раздел «Маркетинг» на сайте — три ИИ-специалиста и планёрка:

| Кто | Чем занимается |
|---|---|
| Маркетолог | стратегия, офферы и пакеты, анализ цен и наценки из прайса, КП, поиск клиентов без бюджета |
| SMM-менеджер | контент-план Instagram, сценарии Reels, посты, сторис |
| Аналитик | ищет в интернете конкурентов, их цены и отзывы, даёт ссылки на источники |
| Планёрка | задачу разбирают по очереди: аналитик → маркетолог → SMM с общим итогом |

Специалисты видят прайс, себестоимость, продажи по услугам и источники заказов из учёта (без имён и телефонов клиентов) и «Бриф студии», который заполняется на той же странице. Разговоры хранятся в Firestore, коллекция `marketing`.

Файлы: `marketing.js` — страница раздела, `marketing-worker/worker.js` — сервер-посредник с ключом Claude и ролями специалистов (тексты ролей правятся там).

### Запуск (один раз, около 10 минут)

1. **Ключ Claude.** [console.anthropic.com](https://console.anthropic.com) → Billing: пополните баланс (от 5 $) → API Keys → Create Key, скопируйте ключ.
2. **Сервер.** [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Worker → имя `raz-marketing` → Deploy → Edit code: замените код содержимым `marketing-worker/worker.js` → Deploy.
3. **Настройки сервера.** Worker → Settings → Variables and Secrets:
   - `ANTHROPIC_API_KEY` — тип Secret, ключ из шага 1;
   - `FIREBASE_PROJECT` = `raz-studio-5a486`;
   - `ALLOWED_ORIGIN` = `https://razgulyaevevgeny.github.io`.
4. **Адрес.** Если адрес воркера не `https://raz-marketing.design-onegin.workers.dev`, поменяйте `MKT_API` в начале `marketing.js`.
5. **Правила базы.** Firebase → Firestore Database → Rules: вставьте обновлённый `firestore.rules` (добавлен раздел `marketing`) → Publish.

Стоимость: платите только за запросы к Claude, по факту. Ориентир: ответ маркетолога или SMM — десятки тенге, разбор аналитика с поиском в интернете (10 $ за 1000 поисков, до 8 поисков на ответ) и планёрка — порядка 100–300 ₸. Точный расход видно в console.anthropic.com → Usage. Модель меняется переменной `MODEL`.
