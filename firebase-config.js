/* Настройки проекта Firebase raz-studio.
   Эти ключи не секретные: доступ к данным закрыт правилами в firestore.rules
   и разрешён только сотрудникам, вошедшим по почте и паролю. */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCNpsnF-9swN11uS2L22-w9cXF45G54Hj0",
  authDomain: "raz-studio-5a486.firebaseapp.com",
  // Realtime Database: сигналы (Аня, Даулет, задания боту) и страницы заказов для клиентов — квоту Firestore не тратят
  databaseURL: "https://raz-studio-5a486-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "raz-studio-5a486",
  storageBucket: "raz-studio-5a486.firebasestorage.app",
  messagingSenderId: "661085467003",
  appId: "1:661085467003:web:2c896e473b214266c24dde"
};
