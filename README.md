# Учёт студии брендирования Разгуляев

Веб-приложение для сотрудников студии: заказы и ведомость, календарь с задачами, поручения от начальства, расходы офиса, закупка расходников, проекты и прайс.

Сайт работает на GitHub Pages, данные хранятся в Firebase (Google): записи в Firestore, фото и файлы в Storage. Сотрудники входят по почте и паролю.

## Файлы

| Файл | Что это |
|---|---|
| `index.html` | Сама страница учёта |
| `firebase-bridge.js` | Связка страницы с Firebase и экран входа |
| `firebase-config.js` | Настройки вашего проекта Firebase (заполнить один раз) |
| `firestore.rules` | Правила доступа к базе: только вошедшие сотрудники |
| `storage.rules` | Правила доступа к файлам: только вошедшие сотрудники, до 20 МБ |

## Настройка Firebase (один раз, около 15 минут)

1. Откройте [console.firebase.google.com](https://console.firebase.google.com), нажмите «Создать проект», назовите его, например, `raz-studio`. Google Analytics можно выключить.
2. **Вход сотрудников.** Слева Build → Authentication → Get started → вкладка Sign-in method → Email/Password → включить → Save. Затем вкладка Users → Add user: добавьте почту и пароль для себя и каждого сотрудника.
3. **База.** Build → Firestore Database → Create database → регион `eur3 (europe-west)` → Start in production mode. Затем вкладка Rules: замените текст содержимым файла `firestore.rules` → Publish.
4. **Файлы и фото.** Build → Storage → Get started. Firebase попросит перейти на тариф Blaze и привязать карту. В пределах бесплатного лимита (5 ГБ) списаний не будет. Советуем сразу поставить бюджет-уведомление на 1 $ в разделе Billing. Затем вкладка Rules: вставьте содержимое `storage.rules` → Publish.
5. **Настройки для сайта.** Шестерёнка → Project settings → General → внизу «Your apps» → значок `</>` (Web) → назовите приложение → Register. Скопируйте значения из блока `firebaseConfig` в файл `firebase-config.js` вместо надписей «ВСТАВЬТЕ».
6. **Разрешить домен.** Authentication → Settings → Authorized domains → Add domain → `razgulyaevevgeny.github.io`.

## Публикация на GitHub Pages

Репозиторий → Settings → Pages → Source: Deploy from a branch → Branch: `main`, папка `/ (root)` → Save. Через минуту сайт откроется по адресу `https://razgulyaevevgeny.github.io/<имя-репозитория>/`.

## Новые сотрудники

Добавляются в Firebase: Authentication → Users → Add user. Удалить или сменить пароль можно там же.
