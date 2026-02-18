// Firestore service layer
import { db } from '../config/firebase.js';
import { 
    collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
    query, where, orderBy, limit, writeBatch, serverTimestamp,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ============== STUDENT SERVICES ==============
export const StudentService = {
    // Get all students
    getAll: () => collection(db, "students"),
    
    // Get students by route
    getByRoute: (routeId) => 
        query(collection(db, "students"), where("routeId", "==", routeId)),
    
    // Get students by parent
    getByParent: (parentUid) => 
        query(collection(db, "students"), where("parentUid", "==", parentUid)),
    
    // Get student by ID
    getById: (studentId) => doc(db, "students", studentId),
    
    // Create student
    create: async (studentData) => {
        const data = {
            ...studentData,
            status: "AWAITING",
            stopOrder: null,
            minsAM: null,
            minsPM: null,
            doneAM: false,
            donePM: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        return await addDoc(collection(db, "students"), data);
    },
    
    // Update student
    update: async (studentId, updates) => {
        const data = {
            ...updates,
            updatedAt: serverTimestamp()
        };
        return await updateDoc(doc(db, "students", studentId), data);
    },
    
    // Delete student
    delete: async (studentId) => {
        return await deleteDoc(doc(db, "students", studentId));
    },
    
    // Mark leave
    markLeave: async (studentId) => {
        return await updateDoc(doc(db, "students", studentId), {
            status: "LEAVE",
            leaveAppliedAt: serverTimestamp()
        });
    }
};

// ============== ROUTE SERVICES ==============
export const RouteService = {
    // Get all routes
    getAll: () => collection(db, "routes"),
    
    // Get route by ID
    getById: (routeId) => doc(db, "routes", routeId),
    
    // Create route
    create: async (name) => {
        return await addDoc(collection(db, "routes"), {
            name,
            driverUidAM: "",
            driverUidPM: "",
            createdAt: serverTimestamp()
        });
    },
    
    // Update route
    update: async (routeId, updates) => {
        return await updateDoc(doc(db, "routes", routeId), updates);
    },
    
    // Delete route
    delete: async (routeId) => {
        return await deleteDoc(doc(db, "routes", routeId));
    },
    
    // Set driver
    setDriver: async (routeId, session, driverUid) => {
        const field = session === "AM" ? "driverUidAM" : "driverUidPM";
        return await updateDoc(doc(db, "routes", routeId), { [field]: driverUid });
    }
};

// ============== TRIP SERVICES ==============
export const TripService = {
    // Get trip ID
    getId: (routeId, date, session) => `${routeId}_${date}_${session}`,
    
    // Get trip document
    get: (routeId, date, session) => 
        doc(db, "trips", TripService.getId(routeId, date, session)),
    
    // Start trip
    start: async (routeId, driverUid, session, startHM) => {
        const tid = TripService.getId(routeId, new Date().toLocaleDateString('en-CA'), session);
        
        await setDoc(doc(db, "trips", tid), {
            routeId,
            driverUid,
            date: new Date().toLocaleDateString('en-CA'),
            session,
            status: "LIVE",
            tripStartHM: startHM,
            startedAt: serverTimestamp()
        }, { merge: true });
        
        // Add event
        await addDoc(collection(db, "trips", tid, "events"), {
            type: "BUS_STARTED",
            timestamp: serverTimestamp(),
            routeId,
            driverUid,
            session
        });
        
        return tid;
    },
    
    // End trip
    end: async (routeId, driverUid, session) => {
        const tid = TripService.getId(routeId, new Date().toLocaleDateString('en-CA'), session);
        
        await updateDoc(doc(db, "trips", tid), {
            status: "ENDED",
            endedAt: serverTimestamp()
        });
        
        await addDoc(collection(db, "trips", tid, "events"), {
            type: "BUS_ENDED",
            timestamp: serverTimestamp(),
            routeId,
            driverUid,
            session
        });
    },
    
    // Add event
    addEvent: async (routeId, driverUid, session, studentId, studentName, type, extra = {}) => {
        const tid = TripService.getId(routeId, new Date().toLocaleDateString('en-CA'), session);
        
        return await addDoc(collection(db, "trips", tid, "events"), {
            type,
            studentId,
            studentName,
            timestamp: serverTimestamp(),
            routeId,
            driverUid,
            session,
            ...extra
        });
    },
    
    // Get events
    getEvents: (routeId, date, session) => 
        collection(db, "trips", TripService.getId(routeId, date, session), "events"),
    
    // Set override
    setOverride: async (routeId, session, studentId, mins) => {
        const tid = TripService.getId(routeId, new Date().toLocaleDateString('en-CA'), session);
        return await setDoc(doc(db, "trips", tid, "overrides", studentId), {
            mins: mins === null ? null : mins,
            updatedAt: serverTimestamp()
        }, { merge: true });
    }
};

// ============== USER SERVICES ==============
export const UserService = {
    // Get users by role
    getByRole: (role) => 
        query(collection(db, "users"), where("role", "==", role)),
    
    // Get user by ID
    getById: (uid) => 
        query(collection(db, "users"), where("uid", "==", uid)),
    
    // Create user
    create: async (userData) => {
        return await addDoc(collection(db, "users"), {
            ...userData,
            createdAt: serverTimestamp()
        });
    },
    
    // Update user
    update: async (userId, updates) => {
        return await updateDoc(doc(db, "users", userId), updates);
    },
    
    // Save FCM token
    saveFcmToken: async (userId, token) => {
        const userRef = doc(db, "users", userId);
        const userDoc = await getDoc(userRef);
        const existingTokens = userDoc.data()?.fcmTokens || [];
        
        if (!existingTokens.includes(token)) {
            return await updateDoc(userRef, {
                fcmTokens: [...existingTokens, token],
                notificationsEnabled: true,
                lastTokenUpdate: serverTimestamp()
            });
        }
    }
};

// ============== HISTORY SERVICES ==============
export const HistoryService = {
    // Get today's history for student
    getToday: (studentId) => {
        const today = new Date().toLocaleDateString('en-CA');
        return doc(db, "history", `${studentId}_${today}`);
    },
    
    // Update history
    update: async (studentId, studentName, field, time) => {
        const today = new Date().toLocaleDateString('en-CA');
        return await setDoc(doc(db, "history", `${studentId}_${today}`), {
            date: today,
            studentName,
            [field]: time,
            timestamp: serverTimestamp()
        }, { merge: true });
    }
};

// ============== NOTIFICATION SERVICES ==============
export const NotificationService = {
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
