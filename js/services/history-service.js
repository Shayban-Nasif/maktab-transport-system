// js/services/history-service.js
import { db } from '../config/firebase.js';
import { 
    doc, 
    setDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export const HistoryService = {
    // Update student history
    update: async (studentId, studentName, field, time) => {
        const today = new Date().toLocaleDateString('en-CA');
        const historyRef = doc(db, "history", `${studentId}_${today}`);
        
        console.log('Updating history:', { studentId, studentName, field, time });
        
        await setDoc(historyRef, {
            date: today,
            studentName,
            [field]: time,
            timestamp: serverTimestamp()
        }, { merge: true });
    },
    
    // Get today's history for student
    getToday: (studentId) => {
        const today = new Date().toLocaleDateString('en-CA');
        return doc(db, "history", `${studentId}_${today}`);
    }
};
