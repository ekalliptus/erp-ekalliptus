/* Service worker FCM untuk web push MyEkalliptus. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCLGHKEV1cw7mwuomjCk_y2s0E6_1_epE0',
  authDomain: 'myekalliptus.firebaseapp.com',
  projectId: 'myekalliptus',
  storageBucket: 'myekalliptus.firebasestorage.app',
  messagingSenderId: '45369135397',
  appId: '1:45369135397:web:0b138963fdffaac5d24acc',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? 'MyEkalliptus';
  const body = payload.notification?.body ?? '';
  self.registration.showNotification(title, {
    body,
    icon: '/logo.webp',
    badge: '/favicon.ico',
    tag: payload.data?.entity_id ?? undefined,
  });
});
