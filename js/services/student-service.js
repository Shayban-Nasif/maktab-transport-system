// js/services/student-service.js
import { db } from '../config/firebase.js';
import { 
    collection, doc, updateDoc, getDoc, getDocs,
    query, where, serverTimestamp 
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
    }
};
