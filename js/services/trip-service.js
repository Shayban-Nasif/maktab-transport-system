// js/services/trip-service.js
import { db } from '../config/firebase.js';
import { 
    collection, doc, setDoc, updateDoc, addDoc, getDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ============== TRIP SERVICES ==============
export const TripService = {
    // Get trip ID
    getId: (routeId, date, session) => `${routeId}_${date}_${session}`,
    
    // Get trip document reference
    getRef: (routeId, date, session) => 
        doc(db, "trips", TripService.getId(routeId, date, session)),
    
    // Start trip
    start: async (routeId, driverUid, session, startHM) => {
        const date = new Date().toLocaleDateString('en-CA');
        const tid = TripService.getId(routeId, date, session);
        const tripRef = doc(db, "trips", tid);
        
        console.log('Starting trip:', { routeId, driverUid, session, startHM, tid });
        
        // Create trip document
        await setDoc(tripRef, {
            routeId,
            driverUid,
            date,
            session,
            status: "LIVE",
            tripStartHM: startHM,
            startedAt: serverTimestamp(),
            createdAt: serverTimestamp()
        }, { merge: true });
        
        // Add start event
        await addDoc(collection(db, "trips", tid, "events"), {
            type: "BUS_STARTED",
            timestamp: serverTimestamp(),
            routeId,
            driverUid,
            session,
            timeStr: startHM
        });
        
        return tid;
    },
    
    // End trip
    end: async (routeId, driverUid, session) => {
        const date = new Date().toLocaleDateString('en-CA');
        const tid = TripService.getId(routeId, date, session);
        const tripRef = doc(db, "trips", tid);
        
        console.log('Ending trip:', { routeId, driverUid, session, tid });
        
        await updateDoc(tripRef, {
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
        const date = new Date().toLocaleDateString('en-CA');
        const tid = TripService.getId(routeId, date, session);
        
        console.log('Adding event:', { routeId, session, type, studentId, studentName });
        
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
    
    // Get trip by ID
    get: async (routeId, date, session) => {
        const tid = TripService.getId(routeId, date, session);
        return await getDoc(doc(db, "trips", tid));
    },
    
    // Set override minutes
    setOverride: async (routeId, session, studentId, mins) => {
        const date = new Date().toLocaleDateString('en-CA');
        const tid = TripService.getId(routeId, date, session);
        const overrideRef = doc(db, "trips", tid, "overrides", studentId);
        
        console.log('Setting override:', { routeId, session, studentId, mins });
        
        await setDoc(overrideRef, {
            mins: mins === null ? null : mins,
            updatedAt: serverTimestamp()
        }, { merge: true });
    },
    
    // Get all trips for a route on a date
    getTripsForRoute: (routeId, date) => {
        return collection(db, "trips");
    }
};
