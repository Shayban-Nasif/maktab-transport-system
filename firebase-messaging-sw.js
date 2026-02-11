// firebase-messaging-sw.js - MUST BE IN YOUR WEBSITE ROOT DIRECTORY
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// 🔴 IMPORTANT: Replace this with your EXACT Firebase config from your main code
firebase.initializeApp({
  apiKey: "AIzaSyCS163x5b5-MJXxJGwbjE0IlO7R58CkJMg",
  authDomain: "maktab-transport.firebaseapp.com",
  projectId: "maktab-transport",
  storageBucket: "maktab-transport.firebasestorage.app",
  messagingSenderId: "575357634901",
  appId: "1:575357634901:web:4918fb77b0c21965af07dc"
});

const messaging = firebase.messaging();

// 🔴 Handle background notifications (when app is closed)
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message:', payload);
  
  const notificationTitle = payload.notification?.title || 'Transport Update';
  const notificationOptions = {
    body: payload.notification?.body || 'Your child\'s transport status has changed',
    icon: '/bus-icon.png', // Optional: add a bus icon
    badge: '/badge-icon.png', // Optional: add a badge icon
    data: payload.data,
    actions: [
      {
        action: 'open',
        title: 'View Details'
      }
    ]
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// 🔴 Handle notification click events
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open') {
    // Open your app when notification is clicked
    event.waitUntil(clients.openWindow('/'));
  }
});
