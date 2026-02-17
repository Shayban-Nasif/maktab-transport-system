// Import Firebase SDKs
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCS163x5b5-MJXxJGwbjE0IlO7R58CkJMg",
  authDomain: "maktab-transport.firebaseapp.com",
  projectId: "maktab-transport",
  storageBucket: "maktab-transport.firebasestorage.app",
  messagingSenderId: "575357634901",
  appId: "1:575357634901:web:4918fb77b0c21965af07dc"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize messaging
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('Received background message:', payload);
  
  const notificationTitle = payload.notification?.title || 'Transport Update';
  const notificationOptions = {
    body: payload.notification?.body || 'Your child\'s transport status has changed',
    icon: 'https://cdn-icons-png.flaticon.com/512/3774/3774278.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/3774/3774278.png',
    vibrate: [200, 100, 200],
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
