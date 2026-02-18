// Push notification service
import { messaging } from '../config/firebase.js';
import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js";
import { UserService } from './firestore.js';
import { showToast } from '../utils/helpers.js';

// VAPID key - REPLACE WITH YOUR ACTUAL KEY FROM FIREBASE CONSOLE
const VAPID_KEY = "BKagOny0KF_2pCJQ3m....moL0ewzQ8rZu";

let messagingInitialized = false;

// Initialize notifications
export async function initNotifications(currentUser) {
    if (!messaging) {
        console.log("❌ Firebase Messaging not available");
        return false;
    }
    
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.log("❌ Push notifications not supported in this browser");
        return false;
    }
    
    try {
        // Register service worker
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        console.log("✅ Service Worker registered");
        
        // Get FCM token
        const token = await getToken(messaging, { 
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration 
        });
        
        console.log("✅ FCM Token:", token);
        
        // Save token to user document
        if (currentUser?.id) {
            await UserService.saveFcmToken(currentUser.id, token);
            console.log("✅ Token saved to user profile");
        }
        
        // Listen for foreground messages
        onMessage(messaging, (payload) => {
            console.log("📨 Foreground message:", payload);
            showNotification(payload);
        });
        
        messagingInitialized = true;
        return true;
        
    } catch (error) {
        console.error("❌ Notification initialization failed:", error);
        return false;
    }
}

// Request notification permission
export async function requestNotificationPermission(currentUser) {
    try {
        const permission = await Notification.requestPermission();
        
        if (permission === 'granted') {
            return await initNotifications(currentUser);
        } else {
            showToast("Notification permission denied", "warning");
            return false;
        }
    } catch (error) {
        console.error("Permission error:", error);
        return false;
    }
}

// Show notification in foreground
function showNotification(payload) {
    const title = payload.notification?.title || 'Transport Update';
    const options = {
        body: payload.notification?.body || 'Your child\'s status has changed',
        icon: '/assets/icons/icon-192x192.png',
        badge: '/assets/icons/icon-72x72.png',
        vibrate: [200, 100, 200],
        data: payload.data
    };
    
    if (Notification.permission === 'granted') {
        new Notification(title, options);
    }
}

// Check notification status
export function getNotificationStatus() {
    return {
        supported: messaging !== null && 'serviceWorker' in navigator,
        permission: Notification.permission,
        initialized: messagingInitialized
    };
}
