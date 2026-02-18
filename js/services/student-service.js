// js/services/student-service.js
import { db } from '../config/firebase.js';
import { 
    collection, 
    doc, 
    setDoc, 
    updateDoc, 
    getDoc, 
    getDocs, 
    query, 
    where, 
    serverTimestamp,
    addDoc,
    deleteDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export const StudentService = {
    // Update student
    update: async (studentId, updates) => {
        const studentRef = doc(db, "students", studentId);
        const data = {
            ...updates,
            updatedAt: serverTimestamp()
        };
        return await updateDoc(studentRef, data);
    },
    
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
    
    // Get student by ID
    get: async (studentId) => {
        return await getDoc(doc(db, "students", studentId));
    },
    
    // Get students by parent
    getByParent: async (parentUid) => {
        const q = query(collection(db, "students"), where("parentUid", "==", parentUid));
        return await getDocs(q);
    },
    
    // Get students by route
    getByRoute: async (routeId) => {
        const q = query(collection(db, "students"), where("routeId", "==", routeId));
        return await getDocs(q);
    },
    
    // Mark student on leave
    markLeave: async (studentId) => {
        const studentRef = doc(db, "students", studentId);
        return await updateDoc(studentRef, {
            status: "LEAVE",
            leaveAppliedAt: serverTimestamp()
        });
    },
    
    // Set custom location override
    setLocationOverride: async (studentId, location) => {
        const today = new Date().toLocaleDateString('en-CA');
        const overrideRef = doc(db, "students", studentId, "overrides", today);
        
        return await setDoc(overrideRef, {
            pickupLoc: location,
            dropoffLoc: location,
            requestedAt: serverTimestamp(),
            approved: false
        });
    },
    
    // Delete student
    delete: async (studentId) => {
        return await deleteDoc(doc(db, "students", studentId));
    },
    
    // Reset all students for new day
    resetAll: async () => {
        const batch = writeBatch(db);
        const snap = await getDocs(collection(db, "students"));
        snap.forEach(d => batch.update(d.ref, { 
            status: "AWAITING", 
            doneAM: false, 
            donePM: false,
            updatedAt: serverTimestamp()
        }));
        return await batch.commit();
    }
};
