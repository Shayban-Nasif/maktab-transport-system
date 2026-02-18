// js/services/notification-service.js
import { db } from '../config/firebase.js';
import { 
    collection, 
    doc, 
    setDoc, 
    updateDoc, 
    addDoc, 
    getDocs, 
    query, 
    where, 
    orderBy, 
    limit,
    writeBatch,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export const NotificationService = {
    // Save FCM token
    saveFcmToken: async (userId, token) => {
        const userRef = doc(db, "users", userId);
        const userDoc = await getDoc(userRef);
        const existingTokens = userDoc.data()?.fcmTokens || [];
        
        if (!existingTokens.includes(token)) {
            await updateDoc(userRef, {
                fcmTokens: [...existingTokens, token],
                notificationsEnabled: true,
                lastTokenUpdate: serverTimestamp()
            });
        }
    },
    
    // Create notification
    create: async (uid, title, body, data = {}) => {
        return await addDoc(collection(db, "notifications"), {
            uid,
            title,
            body,
            data,
            read: false,
            timestamp: serverTimestamp()
        });
    },
    
    // Get user notifications
    getUserNotifications: (uid) => 
        query(collection(db, "notifications"), 
              where("uid", "==", uid), 
              orderBy("timestamp", "desc"), 
              limit(50)),
    
    // Mark as read
    markAsRead: async (notificationId) => {
        return await updateDoc(doc(db, "notifications", notificationId), { read: true });
    },
    
    // Mark all as read
    markAllAsRead: async (uid) => {
        const q = query(collection(db, "notifications"), 
                        where("uid", "==", uid), 
                        where("read", "==", false));
        const snap = await getDocs(q);
        
        const batch = writeBatch(db);
        snap.forEach(d => batch.update(d.ref, { read: true }));
        return await batch.commit();
    }
};
