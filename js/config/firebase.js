// Firebase configuration and initialization
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getMessaging } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyCS163x5b5-MJXxJGwbjE0IlO7R58CkJMg",
  authDomain: "maktab-transport.firebaseapp.com",
  projectId: "maktab-transport",
  storageBucket: "maktab-transport.firebasestorage.app",
  messagingSenderId: "575357634901",
  appId: "1:575357634901:web:4918fb77b0c21965af07dc"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Initialize messaging only in browser environment
export let messaging = null;
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  try {
    messaging = getMessaging(app);
    console.log('✅ Firebase Messaging initialized');
  } catch (e) {
    console.log('❌ Firebase Messaging not available:', e);
  }
}
