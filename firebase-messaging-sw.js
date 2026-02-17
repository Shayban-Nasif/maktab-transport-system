// Simplified service worker for Firebase Messaging
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Initialize Firebase in the service worker
firebase.initializeApp({
  apiKey: "AIzaSyCS163x5b5-MJXxJGwbjE0IlO7R58CkJMg",
  authDomain: "maktab-transport.firebaseapp.com",
  projectId: "maktab-transport",
  storageBucket: "maktab-transport.firebasestorage.app",
  messagingSenderId: "575357634901",
  appId: "1:575357634901:web:4918fb77b0c21965af07dc"
});

// Get messaging instance
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[service-worker] Background message:', payload);
  
  // Show notification
  self.registration.showNotification(
    payload.notification?.title || 'Transport Update',
    {
      body: payload.notification?.body || 'Your child\'s transport status has changed',
      icon: 'https://cdn-icons-png.flaticon.com/512/3774/3774278.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/3774/3774278.png',
      vibrate: [200, 100, 200],
      data: payload.data
    }
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
