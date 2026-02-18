// Main application controller
import { auth, db } from './config/firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { initAuth } from './auth/auth.js';
import { renderAdmin } from './panels/admin-panel.js';
import { renderDriver } from './panels/driver-panel.js';
import { renderParent } from './panels/parent-panel.js';
import { showToast } from './utils/helpers.js';
// In your app.js, add this near the bottom where you define global functions
import { TripService } from './services/trip-service.js';
import { StudentService } from './services/student-service.js';

// Make services available globally for onclick handlers
window.TripService = TripService;
window.StudentService = StudentService;
// Global state
let routesList = [];
let driverMap = {};
let currentUser = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Transport System Initializing...');
    
    // Initialize authentication
    initAuth();
    
    // Listen to auth state
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            showLoginScreen();
            return;
        }

        try {
            // Get user profile
            const userQuery = query(collection(db, "users"), where("uid", "==", user.uid));
            const userSnap = await getDocs(userQuery);
            
            if (userSnap.empty) {
                showToast("User profile not found", "error");
                return;
            }

            currentUser = userSnap.docs[0].data();
            currentUser.id = userSnap.docs[0].id;
            
            // Update UI with user info
            updateUserInfo(currentUser);
            
            // Load routes and drivers in parallel
            await loadRoutesAndDrivers();
            
            // Render appropriate dashboard
            renderDashboard(currentUser);
            
        } catch (error) {
            console.error("Auth error:", error);
            showToast("Login failed", "error");
        }
    });
});

// Show login screen
function showLoginScreen() {
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('dashboardSection').classList.add('hidden');
    document.getElementById('userInfo').classList.add('hidden');
}

// Update user info in header
function updateUserInfo(user) {
    document.getElementById('userDisplayName').innerText = user.fullName;
    const portalLabel = document.getElementById('portalLabel');
    portalLabel.innerText = user.role.charAt(0).toUpperCase() + user.role.slice(1);
    portalLabel.className = `portal-tag bg-${user.role}`;
    document.getElementById('userInfo').classList.remove('hidden');
}

// Load routes and drivers
async function loadRoutesAndDrivers() {
    return new Promise((resolve) => {
        // Load routes
        onSnapshot(collection(db, "routes"), (rSnap) => {
            routesList = rSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            // Load drivers
            onSnapshot(query(collection(db, "users"), where("role", "==", "driver")), (dSnap) => {
                driverMap = {};
                dSnap.forEach(d => { driverMap[d.data().uid] = d.data(); });
                resolve();
            });
        });
    });
}

// In your app.js, update the renderDashboard function:

function renderDashboard(user) {
    document.getElementById('loginSection').classList.add('hidden');
    document.getElementById('dashboardSection').classList.remove('hidden');
    
    const target = document.getElementById('dynamicContent');
    
    console.log('Rendering dashboard for role:', user.role);
    console.log('Routes loaded:', routesList.length);
    console.log('Drivers loaded:', Object.keys(driverMap).length);
    
    switch(user.role) {
        case 'admin':
            renderAdmin(target, routesList, driverMap);
            break;
        case 'driver':
            renderDriver(target, user.uid, routesList, driverMap);
            break;
        case 'parent':
            renderParent(target, user.uid, routesList, driverMap);
            break;
        default:
            showToast("Invalid user role", "error");
    }
}

// Export for use in other modules
export { routesList, driverMap, currentUser };
