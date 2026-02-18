// js/panels/parent-panel.js
import { db } from '../config/firebase.js';
import { 
    collection, doc, query, where, onSnapshot, 
    getDoc, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { escapeHtml, showToast, confirmAction } from '../utils/helpers.js';
import { computeEtaForStudentFromDocs } from '../utils/eta-calculator.js';
import { todayISO, formatTime, defaultSession } from '../utils/date-time.js';
import { StudentService, NotificationService } from '../services/firestore.js';
import { requestNotificationPermission } from '../services/notifications.js';

// State
let childrenList = [];
let currentChildId = null;
let currentUserUid = null;
let routesList = [];
let driverMap = {};
let unsubscribers = {};

export function renderParent(target, uid, routes, drivers) {
    console.log('🎯 renderParent called with uid:', uid);
    console.log('Routes received:', routes);
    console.log('Drivers received:', drivers);
    
    currentUserUid = uid;
    routesList = routes;
    driverMap = drivers;
    
    // Initial render
    target.innerHTML = getParentHTML();
    
    // Load children for this parent
    loadChildren();
    
    // Load notifications
    loadNotifications();
    
    // Check notification permission
    checkNotificationPermission();
}

function getParentHTML() {
    return `
        <div class="parent-header">
            <h2><i class="fas fa-users"></i> My Children</h2>
            <div class="notification-badge" id="notificationBell" onclick="window.openNotifications()">
                <i class="fas fa-bell"></i>
                <span class="count" id="notificationCount">0</span>
            </div>
        </div>

        <!-- Notification Permission Banner -->
        <div id="notificationBanner" class="alert alert-warning" style="display:none; margin-bottom:20px;">
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                <span><i class="fas fa-bell"></i> Get real-time updates about your child's transportation</span>
                <button onclick="window.enableNotifications()" class="btn-primary btn-sm">
                    Enable Notifications
                </button>
            </div>
        </div>

        <!-- Child Selector -->
        <div id="childSelector" class="child-selector">
            <div style="text-align:center; width:100%; padding:20px;">
                <i class="fas fa-spinner fa-spin"></i> Loading children...
            </div>
        </div>

        <!-- Child Details Container -->
        <div id="childDetailsContainer"></div>

        <!-- Notification Center -->
        <div class="card" style="margin-top:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h4><i class="fas fa-bell"></i> Recent Notifications</h4>
                <button onclick="window.markAllNotificationsRead()" class="btn-outline btn-sm">
                    Mark all read
                </button>
            </div>
            <div id="notificationList" style="max-height:400px; overflow-y:auto;"></div>
        </div>
    `;
}

function loadChildren() {
    console.log('Loading children for parent:', currentUserUid);
    
    const childrenQuery = query(
        collection(db, "students"), 
        where("parentUid", "==", currentUserUid)
    );
    
    onSnapshot(childrenQuery, (snap) => {
        console.log('Children loaded:', snap.size);
        
        childrenList = snap.docs.map(d => ({ 
            id: d.id, 
            ...d.data() 
        }));
        
        if (childrenList.length === 0) {
            document.getElementById('childSelector').innerHTML = `
                <div class="card" style="text-align:center; padding:30px; width:100%;">
                    <i class="fas fa-child" style="font-size:48px; color:var(--gray-400);"></i>
                    <h3 style="margin-top:16px;">No Children Found</h3>
                    <p class="text-muted">Please contact the school to link your children.</p>
                </div>
            `;
            document.getElementById('childDetailsContainer').innerHTML = '';
            return;
        }
        
        // Render child selector
        renderChildSelector();
        
        // Select first child by default
        if (!currentChildId || !childrenList.find(c => c.id === currentChildId)) {
            selectChild(childrenList[0].id);
        }
        
        // Update notification badge
        updateNotificationBadge();
        
    }, (error) => {
        console.error('Error loading children:', error);
        document.getElementById('childSelector').innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle"></i>
                Error loading children: ${error.message}
            </div>
        `;
    });
}

function renderChildSelector() {
    const selector = document.getElementById('childSelector');
    
    selector.innerHTML = childrenList.map((child) => {
        const isActive = child.id === currentChildId;
        const leaveIcon = child.status === 'LEAVE' ? '🚫' : '';
        
        return `
            <div class="child-tab ${isActive ? 'active' : ''}" 
                 onclick="window.selectChild('${child.id}')">
                <i class="fas fa-child"></i> 
                ${escapeHtml(child.name)}
                ${leaveIcon ? `<span class="badge bg-danger" style="margin-left:5px;">${leaveIcon}</span>` : ''}
                ${child.status === 'LEAVE' ? '<small>(On Leave)</small>' : ''}
            </div>
        `;
    }).join('');
}

function selectChild(childId) {
    console.log('Selecting child:', childId);
    currentChildId = childId;
    
    // Update active tab
    document.querySelectorAll('.child-tab').forEach(el => {
        el.classList.remove('active');
    });
    const activeTab = Array.from(document.querySelectorAll('.child-tab')).find(
        el => el.getAttribute('onclick')?.includes(childId)
    );
    if (activeTab) activeTab.classList.add('active');
    
    // Find child data
    const child = childrenList.find(c => c.id === childId);
    if (child) {
        renderChildDetails(child);
    }
}

function renderChildDetails(child) {
    console.log('Rendering details for child:', child);
    
    const container = document.getElementById('childDetailsContainer');
    const route = routesList.find(r => r.id === child.routeId);
    
    container.innerHTML = `
        <div class="live-status-card">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px;">
                <div>
                    <span class="status-label">${escapeHtml(child.name)}</span>
                    <div class="status-time" id="currentStatus_${child.id}">
                        ${child.status || 'AWAITING'}
                    </div>
                </div>
                <div style="display:flex; gap:10px;">
                    <select id="sessionSelect_${child.id}" class="form-select" style="width:auto; min-width:120px;">
                        <option value="AM" ${defaultSession() === 'AM' ? 'selected' : ''}>☀️ AM Trip</option>
                        <option value="PM" ${defaultSession() === 'PM' ? 'selected' : ''}>🌙 PM Trip</option>
                    </select>
                    <button class="btn-outline btn-sm" onclick="window.refreshChildStatus('${child.id}')">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>
            </div>
            
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:15px; margin-top:20px;">
                <div class="stat-box">
                    <div class="label">ETA / Status</div>
                    <div class="value" id="eta_${child.id}">--:--</div>
                </div>
                <div class="stat-box">
                    <div class="label">Trip</div>
                    <div class="value" id="tripStatus_${child.id}">Not Started</div>
                </div>
                <div class="stat-box">
                    <div class="label">Route</div>
                    <div class="value" id="routeName_${child.id}">${route ? escapeHtml(route.name) : 'Not Assigned'}</div>
                </div>
            </div>
        </div>

        <!-- Driver Information Card -->
        <div class="card" style="margin:20px 0; background:linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);">
            <h5 style="margin-bottom:15px;"><i class="fas fa-user"></i> Driver Information</h5>
            <div id="driverInfo_${child.id}" style="display:grid; grid-template-columns:repeat(3,1fr); gap:15px;">
                <div style="text-align:center;">
                    <i class="fas fa-user-circle" style="font-size:24px; color:var(--gray-500);"></i>
                    <div class="text-muted small">Name</div>
                    <div id="driverName_${child.id}" class="fw-bold">Loading...</div>
                </div>
                <div style="text-align:center;">
                    <i class="fas fa-phone" style="font-size:24px; color:var(--gray-500);"></i>
                    <div class="text-muted small">Contact</div>
                    <div id="driverPhone_${child.id}" class="fw-bold">Loading...</div>
                </div>
                <div style="text-align:center;">
                    <i class="fas fa-bus" style="font-size:24px; color:var(--gray-500);"></i>
                    <div class="text-muted small">Vehicle</div>
                    <div id="driverVehicle_${child.id}" class="fw-bold">Loading...</div>
                </div>
            </div>
        </div>

        <!-- Location Cards -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin:20px 0;">
            <div class="card" style="background:#f0f9ff;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-map-marker-alt" style="color:var(--admin); font-size:1.2rem;"></i>
                    <div>
                        <div class="text-muted small">PICKUP LOCATION</div>
                        <div id="pickupLoc_${child.id}" style="font-weight:500;">${escapeHtml(child.pickupLoc || child.address || '-')}</div>
                        ${child.pickupLoc !== child.address ? 
                            '<span class="badge bg-info" style="margin-top:4px;">Custom Location</span>' : ''}
                    </div>
                </div>
            </div>
            
            <div class="card" style="background:#fef2e0;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-flag-checkered" style="color:var(--parent); font-size:1.2rem;"></i>
                    <div>
                        <div class="text-muted small">DROPOFF LOCATION</div>
                        <div id="dropoffLoc_${child.id}" style="font-weight:500;">${escapeHtml(child.dropoffLoc || child.address || '-')}</div>
                        ${child.dropoffLoc !== child.address ? 
                            '<span class="badge bg-info" style="margin-top:4px;">Custom Location</span>' : ''}
                    </div>
                </div>
            </div>
        </div>

        <!-- Timeline -->
        <div class="card">
            <h5 style="margin-bottom:15px;"><i class="fas fa-history"></i> Today's Journey</h5>
            <div class="timeline" id="timeline_${child.id}">
                <div class="timeline-item">
                    <div class="timeline-time">--:--</div>
                    <div class="timeline-title">Waiting for trip to start</div>
                </div>
            </div>
        </div>

        <!-- Action Buttons -->
        <div style="display:flex; gap:10px; margin-top:20px; flex-wrap:wrap;">
            <button class="btn-leave" onclick="window.requestLeave('${child.id}', '${escapeHtml(child.name)}')">
                <i class="fas fa-calendar-times"></i> Apply Leave
            </button>
            <button class="btn-outline" onclick="window.requestCustomLocation('${child.id}')">
                <i class="fas fa-map-pin"></i> Request Change
            </button>
            <button class="btn-outline" onclick="window.contactDriver('${child.id}')">
                <i class="fas fa-phone"></i> Contact Driver
            </button>
        </div>
    `;
    
    // Start real-time updates for this child
    setupChildListeners(child);
}

function setupChildListeners(child) {
    const sid = child.id;
    const sessionSelect = document.getElementById(`sessionSelect_${sid}`);
    
    if (!sessionSelect) {
        console.error('Session select not found for child:', sid);
        return;
    }
    
    // Clear existing listeners for this child
    if (unsubscribers[sid]) {
        Object.values(unsubscribers[sid]).forEach(unsub => {
            if (unsub) unsub();
        });
    }
    unsubscribers[sid] = {};
    
    // Function to load trip data for selected session
    const loadSessionData = (session) => {
        console.log(`Loading ${session} data for child:`, child.name);
        
        const routeId = child.routeId;
        if (!routeId) {
            console.log('No route assigned to child');
            updateDriverInfo(sid, null, session);
            return;
        }
        
        const tripId = `${routeId}_${todayISO()}_${session}`;
        console.log('Trip ID:', tripId);
        
        // Listen to trip document
        unsubscribers[sid].trip = onSnapshot(doc(db, "trips", tripId), (snap) => {
            const statusEl = document.getElementById(`tripStatus_${sid}`);
            if (statusEl) {
                if (snap.exists()) {
                    const data = snap.data();
                    statusEl.textContent = data.status || 'LIVE';
                    
                    // Update ETA when trip starts
                    if (data.tripStartHM) {
                        updateETA(sid, session, data.tripStartHM);
                    }
                    
                    // Update driver info when trip starts
                    updateDriverInfo(sid, routeId, session);
                } else {
                    statusEl.textContent = 'Not Started';
                }
            }
        }, (error) => {
            console.error('Trip listener error:', error);
        });
        
        // Listen to events for timeline
        unsubscribers[sid].events = onSnapshot(
            query(collection(db, "trips", tripId, "events"), orderBy("timestamp", "asc")),
            (snap) => {
                console.log(`Events loaded for ${session}:`, snap.size);
                updateTimeline(sid, snap.docs.map(d => d.data()));
            },
            (error) => {
                console.error('Events listener error:', error);
            }
        );
        
        // Listen to overrides for ETA
        unsubscribers[sid].overrides = onSnapshot(
            collection(db, "trips", tripId, "overrides"),
            (oSnap) => {
                const overrides = {};
                oSnap.forEach(d => {
                    overrides[d.id] = d.data()?.mins ?? null;
                });
                
                // Recalculate ETA when overrides change
                getDoc(doc(db, "trips", tripId)).then(tripSnap => {
                    if (tripSnap.exists() && tripSnap.data().tripStartHM) {
                        updateETAWithOverrides(sid, session, tripSnap.data().tripStartHM, overrides);
                    }
                });
            }
        );
        
        // Initial driver info load
        updateDriverInfo(sid, routeId, session);
    };
    
    // Load initial session
    loadSessionData(sessionSelect.value);
    
    // Handle session change
    sessionSelect.addEventListener('change', (e) => {
        console.log('Session changed to:', e.target.value);
        loadSessionData(e.target.value);
    });
}

async function updateETA(sid, session, tripStartHM) {
    // Get all students on the same route to calculate ETA
    const child = childrenList.find(c => c.id === sid);
    if (!child?.routeId) return;
    
    const studentsQuery = query(
        collection(db, "students"), 
        where("routeId", "==", child.routeId)
    );
    
    const snap = await getDocs(studentsQuery);
    const docs = snap.docs;
    
    const eta = computeEtaForStudentFromDocs(
        session,
        sid,
        tripStartHM,
        docs,
        {}, // overrides
        [], // pickupEvents
        []  // dropoffEvents
    );
    
    const etaEl = document.getElementById(`eta_${sid}`);
    if (etaEl) etaEl.textContent = eta;
}

async function updateETAWithOverrides(sid, session, tripStartHM, overrides) {
    const child = childrenList.find(c => c.id === sid);
    if (!child?.routeId) return;
    
    const studentsQuery = query(
        collection(db, "students"), 
        where("routeId", "==", child.routeId)
    );
    
    const snap = await getDocs(studentsQuery);
    const docs = snap.docs;
    
    const eta = computeEtaForStudentFromDocs(
        session,
        sid,
        tripStartHM,
        docs,
        overrides,
        [], // pickupEvents
        []  // dropoffEvents
    );
    
    const etaEl = document.getElementById(`eta_${sid}`);
    if (etaEl) etaEl.textContent = eta;
}

async function updateDriverInfo(sid, routeId, session) {
    console.log('Updating driver info for:', { sid, routeId, session });
    
    if (!routeId) {
        document.getElementById(`driverName_${sid}`).textContent = 'No Route';
        document.getElementById(`driverPhone_${sid}`).textContent = 'N/A';
        document.getElementById(`driverVehicle_${sid}`).textContent = 'N/A';
        return;
    }
    
    try {
        // Get route info
        const routeDoc = await getDoc(doc(db, "routes", routeId));
        if (!routeDoc.exists()) {
            console.log('Route not found');
            return;
        }
        
        const route = routeDoc.data();
        const driverUid = session === 'AM' ? route.driverUidAM : route.driverUidPM;
        
        console.log('Driver UID for this session:', driverUid);
        
        if (!driverUid) {
            document.getElementById(`driverName_${sid}`).textContent = 'Not Assigned';
            document.getElementById(`driverPhone_${sid}`).textContent = 'N/A';
            document.getElementById(`driverVehicle_${sid}`).textContent = 'N/A';
            return;
        }
        
        // Get driver info from driverMap or Firestore
        let driver = driverMap[driverUid];
        
        if (!driver) {
            // Try to fetch from Firestore
            const driverQuery = query(collection(db, "users"), where("uid", "==", driverUid));
            const driverSnap = await getDocs(driverQuery);
            
            if (!driverSnap.empty) {
                driver = driverSnap.docs[0].data();
            }
        }
        
        if (driver) {
            console.log('Driver found:', driver);
            document.getElementById(`driverName_${sid}`).textContent = driver.fullName || 'Unknown';
            document.getElementById(`driverPhone_${sid}`).textContent = driver.phone || 'N/A';
            document.getElementById(`driverVehicle_${sid}`).textContent = driver.assignedCar || 'N/A';
        } else {
            document.getElementById(`driverName_${sid}`).textContent = 'Unknown';
            document.getElementById(`driverPhone_${sid}`).textContent = 'N/A';
            document.getElementById(`driverVehicle_${sid}`).textContent = 'N/A';
        }
    } catch (error) {
        console.error('Error loading driver info:', error);
    }
}

function updateTimeline(sid, events) {
    const timelineEl = document.getElementById(`timeline_${sid}`);
    if (!timelineEl) return;
    
    if (events.length === 0) {
        timelineEl.innerHTML = `
            <div class="timeline-item">
                <div class="timeline-time">--:--</div>
                <div class="timeline-title">No events yet today</div>
            </div>
        `;
        return;
    }
    
    timelineEl.innerHTML = events.map(event => {
        const time = event.timestamp?.toDate ? 
            formatTime(event.timestamp.toDate()) : '--:--';
        
        let title = event.type;
        let icon = '🔔';
        
        switch(event.type) {
            case 'BUS_STARTED':
                icon = '🚌';
                title = 'Bus started';
                break;
            case 'BUS_ARRIVED_SCHOOL':
                icon = '🏫';
                title = 'Bus arrived at school';
                break;
            case 'PICKED_AM':
                icon = '✅';
                title = 'Picked up from home';
                break;
            case 'DROPPED_SCHOOL_AM':
                icon = '🏫';
                title = 'Dropped at school';
                break;
            case 'PICKED_SCHOOL_PM':
                icon = '🚐';
                title = 'Picked up from school';
                break;
            case 'DROPPED_PM':
                icon = '🏠';
                title = 'Dropped home';
                break;
            case 'BUS_ENDED':
                icon = '🏁';
                title = 'Trip completed';
                break;
        }
        
        const isForThisChild = event.studentId === sid;
        
        return `
            <div class="timeline-item ${isForThisChild ? 'highlight' : ''}">
                <div class="timeline-time">${time}</div>
                <div class="timeline-title">
                    ${icon} ${title} 
                    ${event.studentName && !isForThisChild ? `- ${escapeHtml(event.studentName)}` : ''}
                    ${isForThisChild ? ' (Your Child)' : ''}
                </div>
            </div>
        `;
    }).join('');
}

function loadNotifications() {
    const notifQuery = query(
        collection(db, "notifications"),
        where("uid", "==", currentUserUid),
        orderBy("timestamp", "desc"),
        limit(50)
    );
    
    onSnapshot(notifQuery, (snap) => {
        renderNotifications(snap.docs);
        updateNotificationBadge();
    }, (error) => {
        console.error('Error loading notifications:', error);
    });
}

function renderNotifications(docs) {
    const listEl = document.getElementById('notificationList');
    if (!listEl) return;
    
    if (docs.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center; padding:30px; color:var(--gray-500);">
                <i class="fas fa-bell-slash" style="font-size:2rem; margin-bottom:10px;"></i>
                <p>No notifications yet</p>
            </div>
        `;
        return;
    }
    
    listEl.innerHTML = docs.map(doc => {
        const notif = doc.data();
        const time = notif.timestamp?.toDate ? 
            formatTime(notif.timestamp.toDate()) : '';
        
        return `
            <div class="notification-item ${!notif.read ? 'unread' : ''}" 
                 onclick="window.markNotificationRead('${doc.id}')">
                <div style="display:flex; justify-content:space-between;">
                    <strong>${escapeHtml(notif.title || 'Update')}</strong>
                    <small class="text-muted">${time}</small>
                </div>
                <div style="margin-top:5px;">${escapeHtml(notif.body || '')}</div>
                ${!notif.read ? '<small class="badge bg-primary" style="margin-top:5px;">New</small>' : ''}
            </div>
        `;
    }).join('');
}

async function updateNotificationBadge() {
    const notifQuery = query(
        collection(db, "notifications"),
        where("uid", "==", currentUserUid),
        where("read", "==", false)
    );
    
    const snap = await getDocs(notifQuery);
    document.getElementById('notificationCount').textContent = snap.size;
}

function checkNotificationPermission() {
    const banner = document.getElementById('notificationBanner');
    if (banner && Notification.permission !== 'granted') {
        banner.style.display = 'block';
    }
}

// ============== GLOBAL FUNCTIONS ==============

window.selectChild = (childId) => {
    selectChild(childId);
};

window.refreshChildStatus = (childId) => {
    const child = childrenList.find(c => c.id === childId);
    if (child) {
        showToast("Refreshing...", "info");
        renderChildDetails(child);
    }
};

window.enableNotifications = async () => {
    const success = await requestNotificationPermission({ uid: currentUserUid });
    if (success) {
        document.getElementById('notificationBanner').style.display = 'none';
        showToast("✅ Notifications enabled!", "success");
    }
};

window.openNotifications = () => {
    document.getElementById('notificationList').scrollIntoView({ behavior: 'smooth' });
};

window.requestLeave = async (studentId, studentName) => {
    if (!await confirmAction(`Apply leave for ${studentName} today?`)) return;
    
    try {
        await StudentService.markLeave(studentId);
        showToast(`✅ Leave request submitted for ${studentName}`, "success");
    } catch (error) {
        console.error("Leave request error:", error);
        showToast("Failed to submit leave request", "error");
    }
};

window.requestCustomLocation = async (studentId) => {
    const newLocation = prompt("Enter special pickup/dropoff location for today:");
    if (newLocation) {
        try {
            const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
            const today = todayISO();
            await setDoc(doc(db, "students", studentId, "overrides", today), {
                pickupLoc: newLocation,
                dropoffLoc: newLocation,
                requestedAt: new Date(),
                approved: false
            });
            showToast("✅ Location change request submitted", "success");
        } catch (error) {
            console.error("Location request error:", error);
            showToast("Failed to submit request", "error");
        }
    }
};

window.contactDriver = async (studentId) => {
    const child = childrenList.find(c => c.id === studentId);
    if (!child?.routeId) {
        showToast("Driver information not available", "error");
        return;
    }
    
    const session = document.getElementById(`sessionSelect_${studentId}`)?.value || defaultSession();
    
    try {
        const routeDoc = await getDoc(doc(db, "routes", child.routeId));
        if (!routeDoc.exists()) {
            showToast("Route information not found", "error");
            return;
        }
        
        const route = routeDoc.data();
        const driverUid = session === 'AM' ? route.driverUidAM : route.driverUidPM;
        
        if (!driverUid) {
            showToast("No driver assigned for this session", "error");
            return;
        }
        
        // Try to get from driverMap first
        let driver = driverMap[driverUid];
        
        if (!driver) {
            const driverQuery = query(collection(db, "users"), where("uid", "==", driverUid));
            const driverSnap = await getDocs(driverQuery);
            if (!driverSnap.empty) {
                driver = driverSnap.docs[0].data();
            }
        }
        
        if (driver?.phone) {
            window.location.href = `tel:${driver.phone}`;
        } else {
            showToast("Driver phone number not available", "error");
        }
    } catch (error) {
        console.error("Error contacting driver:", error);
        showToast("Error contacting driver", "error");
    }
};

window.markNotificationRead = async (notificationId) => {
    await NotificationService.markAsRead(notificationId);
    updateNotificationBadge();
};

window.markAllNotificationsRead = async () => {
    await NotificationService.markAllAsRead(currentUserUid);
    showToast("All notifications marked as read", "success");
};
