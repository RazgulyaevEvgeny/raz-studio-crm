/* Настройки проекта Firebase.
   Где взять: консоль Firebase → шестерёнка «Project settings» → вкладка General →
   внизу блок «Your apps» → веб-приложение → «SDK setup and configuration» → вариант Config.
   Скопируйте значения сюда вместо надписей ВСТАВЬТЕ.
   Эти ключи не секретные: доступ к данным закрыт правилами в firestore.rules и storage.rules. */
window.FIREBASE_CONFIG = {
  apiKey: "ВСТАВЬТЕ apiKey",
  authDomain: "ВСТАВЬТЕ authDomain",
  projectId: "ВСТАВЬТЕ projectId",
  storageBucket: "ВСТАВЬТЕ storageBucket",
  messagingSenderId: "ВСТАВЬТЕ messagingSenderId",
  appId: "ВСТАВЬТЕ appId"
};
