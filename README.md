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
