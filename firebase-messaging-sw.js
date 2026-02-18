// Service worker for Firebase Cloud Messaging
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase configuration
firebase.initializeApp({
  apiKey: "AIzaSyCS163x5b5-MJXxJGwbjE0IlO7R58CkJMg",
  authDomain: "maktab-transport.firebaseapp.com",
  projectId: "maktab-transport",
  storageBucket: "maktab-transport.firebasestorage.app",
  messagingSenderId: "575357634901",
  appId: "1:575357634901:web:4918fb77b0c21965af07dc"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[service-worker] Background message:', payload);
  
  const notificationTitle = payload.notification?.title || 'Transport Update';
  const notificationOptions = {
    body: payload.notification?.body || 'Your child\'s transport status has changed',
    icon: '/assets/icons/icon-192x192.png',
    badge: '/assets/icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: payload.data,
    actions: [
      { action: 'open', title: 'View Details' }
    ]
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(clients.openWindow('/'));
  }
});
