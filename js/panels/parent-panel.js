// Parent panel module
import { db } from '../config/firebase.js';
import { 
    collection, query, where, onSnapshot, doc, 
    updateDoc, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { escapeHtml, showToast, confirmAction } from '../utils/helpers.js';
import { computeEtaForStudentFromDocs } from '../utils/eta-calculator.js';
import { todayISO, formatTime, defaultSession } from '../utils/date-time.js';
import { StudentService, NotificationService } from '../services/firestore.js';
import { requestNotificationPermission } from '../services/notifications.js';

// State for current parent view
let childrenList = [];
let currentChildId = null;
let unsubscribers = [];
let currentUser = null;

export function renderParent(target, uid, routesList, driverMap) {
    currentUser = { uid };
    
    // Clear any existing listeners
    clearParentSubs();
    
    // Initial render
    target.innerHTML = getParentHTML();
    
    // Load children for this parent
    loadChildren(uid, routesList, driverMap);
    
    // Load notifications
    loadNotifications(uid);
    
    // Check notification permission
    checkNotificationPermission();
}

function getParentHTML() {
    return `
        <div class="parent-header">
            <h2><i class="fas fa-users"></i> My Children</h2>
            <div class="notification-badge" id="notificationBell">
                <i class="fas fa-bell"></i>
                <span class="count" id="notificationCount">0</span>
            </div>
        </div>

        <!-- Notification Permission Banner -->
        <div id="notificationBanner" class="alert alert-warning" style="display:none; margin-bottom:20px;">
            <div style="display:flex; align-items:center; justify-content:space-between;">
                <span>📱 Get real-time updates about your child's transportation</span>
                <button onclick="window.enableNotifications()" class="btn-primary">
                    Enable Notifications
                </button>
            </div>
        </div>

        <!-- Child Selector -->
        <div id="childSelector" class="child-selector"></div>

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

function loadChildren(uid, routesList, driverMap) {
    const childrenQuery = query(
        collection(db, "students"), 
        where("parentUid", "==", uid)
    );
    
    onSnapshot(childrenQuery, (snap) => {
        childrenList = snap.docs.map(d => ({ 
            id: d.id, 
            ...d.data() 
        }));
        
        if (childrenList.length === 0) {
            document.getElementById('childDetailsContainer').innerHTML = `
                <div class="card" style="text-align:center; padding:40px;">
                    <div class="empty-state">
                        <div class="icon">👶</div>
                        <h3>No Children Found</h3>
                        <p class="text-muted">Please contact the school to link your children.</p>
                    </div>
                </div>
            `;
            return;
        }
        
        // Render child selector
        renderChildSelector(childrenList);
        
        // Select first child by default
        if (!currentChildId || !childrenList.find(c => c.id === currentChildId)) {
            selectChild(childrenList[0].id);
        }
        
        // Update notification badge with unread count
        updateNotificationBadge();
    });
}

function renderChildSelector(children) {
    const selector = document.getElementById('childSelector');
    
    selector.innerHTML = children.map((child, index) => {
        const isActive = child.id === currentChildId;
        const leaveIcon = child.status === 'LEAVE' ? '🚫' : '';
        
        return `
            <div class="child-tab ${isActive ? 'active' : ''}" 
                 onclick="window.selectChild('${child.id}')">
                <i class="fas fa-child"></i> 
                ${escapeHtml(child.name)}
                ${leaveIcon ? `<span class="badge bg-danger">${leaveIcon}</span>` : ''}
                ${child.status === 'LEAVE' ? '<small>(On Leave)</small>' : ''}
            </div>
        `;
    }).join('');
}

function selectChild(childId) {
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
    const container = document.getElementById('childDetailsContainer');
    
    container.innerHTML = `
        <div class="live-status-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <span class="status-label">${escapeHtml(child.name)}</span>
                    <div class="status-time" id="currentStatus_${child.id}">
                        ${child.status || 'AWAITING'}
                    </div>
                </div>
                <div style="display:flex; gap:10px;">
                    <select id="sessionSelect_${child.id}" class="form-select" style="width:auto;">
                        <option value="AM" ${defaultSession() === 'AM' ? 'selected' : ''}>☀️ AM Trip</option>
                        <option value="PM" ${defaultSession() === 'PM' ? 'selected' : ''}>🌙 PM Trip</option>
                    </select>
                    <button class="btn-outline btn-sm" onclick="window.refreshChildStatus('${child.id}')">
                        🔄 Refresh
                    </button>
                </div>
            </div>
            
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:15px; margin-top:20px;">
                <div class="stat-box">
                    <div class="label">ETA</div>
                    <div class="value" id="eta_${child.id}">--:--</div>
                </div>
                <div class="stat-box">
                    <div class="label">Trip Status</div>
                    <div class="value" id="tripStatus_${child.id}">Not Started</div>
                </div>
                <div class="stat-box">
                    <div class="label">Driver</div>
                    <div class="value" id="driverInfo_${child.id}">Loading...</div>
                </div>
            </div>
        </div>

        <!-- Location Cards -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin:20px 0;">
            <div class="card" style="background:#f0f9ff;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-map-marker-alt" style="color:#1a73e8; font-size:1.2rem;"></i>
                    <div>
                        <div class="text-muted small">PICKUP LOCATION</div>
                        <div id="pickupLoc_${child.id}">${escapeHtml(child.pickupLoc || child.address || '-')}</div>
                        ${child.pickupLoc !== child.address ? 
                            '<span class="badge bg-info">Custom</span>' : ''}
                    </div>
                </div>
            </div>
            
            <div class="card" style="background:#fef2e0;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-flag-checkered" style="color:#ff9800; font-size:1.2rem;"></i>
                    <div>
                        <div class="text-muted small">DROPOFF LOCATION</div>
                        <div id="dropoffLoc_${child.id}">${escapeHtml(child.dropoffLoc || child.address || '-')}</div>
                        ${child.dropoffLoc !== child.address ? 
                            '<span class="badge bg-info">Custom</span>' : ''}
                    </div>
                </div>
            </div>
        </div>

        <!-- Timeline -->
        <div class="card">
            <h5><i class="fas fa-history"></i> Today's Journey</h5>
            <div class="timeline" id="timeline_${child.id}">
                <!-- Timeline will be populated dynamically -->
                <div class="timeline-item">
                    <div class="timeline-time">--:--</div>
                    <div class="timeline-title">Waiting for trip to start</div>
                </div>
            </div>
        </div>

        <!-- Action Buttons -->
        <div style="display:flex; gap:10px; margin-top:20px;">
            <button class="btn-leave" onclick="window.requestLeave('${child.id}', '${escapeHtml(child.name)}')">
                📅 Apply Leave
            </button>
            <button class="btn-outline" onclick="window.requestCustomLocation('${child.id}')">
                📍 Request Change
            </button>
            <button class="btn-outline" onclick="window.contactDriver('${child.id}')">
                📞 Contact Driver
            </button>
        </div>
    `;
    
    // Start real-time updates for this child
    setupChildListeners(child);
}

function setupChildListeners(child) {
    const sid = child.id;
    const sessionSelect = document.getElementById(`sessionSelect_${sid}`);
    
    // Clear existing listeners for this child
    if (unsubscribers[sid]) {
        unsubscribers[sid].forEach(u => u());
    }
    unsubscribers[sid] = [];
    
    // Function to load trip data for selected session
    const loadSessionData = (session) => {
        const routeId = child.routeId;
        if (!routeId) return;
        
        const tripId = `${routeId}_${todayISO()}_${session}`;
        
        // Listen to trip document
        const unsubTrip = onSnapshot(doc(db, "trips", tripId), (snap) => {
            const statusEl = document.getElementById(`tripStatus_${sid}`);
            if (statusEl) {
                if (snap.exists()) {
                    const data = snap.data();
                    statusEl.textContent = data.status || 'LIVE';
                    
                    // Update ETA when trip starts
                    if (data.tripStartHM) {
                        updateETA(sid, session, data.tripStartHM);
                    }
                } else {
                    statusEl.textContent = 'Not Started';
                }
            }
        });
        
        // Listen to events for timeline
        const unsubEvents = onSnapshot(
            query(collection(db, "trips", tripId, "events"), orderBy("timestamp", "asc")),
            (snap) => {
                updateTimeline(sid, snap.docs.map(d => d.data()));
                
                // Also update driver info
                updateDriverInfo(sid, session);
            }
        );
        
        // Listen to overrides for ETA
        const unsubOverrides = onSnapshot(
            collection(db, "trips", tripId, "overrides"),
            () => {
                const tripDoc = doc(db, "trips", tripId);
                getDoc(tripDoc).then(tripSnap => {
                    if (tripSnap.exists() && tripSnap.data().tripStartHM) {
                        updateETA(sid, session, tripSnap.data().tripStartHM);
                    }
                });
            }
        );
        
        unsubscribers[sid].push(unsubTrip, unsubEvents, unsubOverrides);
    };
    
    // Load initial session
    loadSessionData(sessionSelect.value);
    
    // Handle session change
    sessionSelect.addEventListener('change', (e) => {
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
        window.overridesMap || {},
        [], // pickupEvents - would need to be passed
        []  // dropoffEvents - would need to be passed
    );
    
    const etaEl = document.getElementById(`eta_${sid}`);
    if (etaEl) etaEl.textContent = eta;
}

async function updateDriverInfo(sid, session) {
    const child = childrenList.find(c => c.id === sid);
    if (!child?.routeId) return;
    
    // Get route info
    const routeDoc = await getDoc(doc(db, "routes", child.routeId));
    if (!routeDoc.exists()) return;
    
    const route = routeDoc.data();
    const driverUid = session === 'AM' ? route.driverUidAM : route.driverUidPM;
    
    if (!driverUid) {
        document.getElementById(`driverInfo_${sid}`).textContent = 'Not Assigned';
        return;
    }
    
    // Get driver info
    const driverQuery = query(collection(db, "users"), where("uid", "==", driverUid));
    const driverSnap = await getDocs(driverQuery);
    
    if (!driverSnap.empty) {
        const driver = driverSnap.docs[0].data();
        document.getElementById(`driverInfo_${sid}`).innerHTML = `
            ${escapeHtml(driver.fullName)}<br>
            <small>📞 ${escapeHtml(driver.phone || 'N/A')}</small><br>
            <small>🚐 ${escapeHtml(driver.assignedCar || 'N/A')}</small>
        `;
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
        
        return `
            <div class="timeline-item ${event.studentId === sid ? 'highlight' : ''}">
                <div class="timeline-time">${time}</div>
                <div class="timeline-title">
                    ${icon} ${title} 
                    ${event.studentName ? `- ${escapeHtml(event.studentName)}` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function loadNotifications(uid) {
    const notifQuery = query(
        collection(db, "notifications"),
        where("uid", "==", uid),
        orderBy("timestamp", "desc"),
        limit(50)
    );
    
    onSnapshot(notifQuery, (snap) => {
        renderNotifications(snap.docs);
        updateNotificationBadge();
    });
}

function renderNotifications(docs) {
    const listEl = document.getElementById('notificationList');
    if (!listEl) return;
    
    if (docs.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center; padding:30px; color:#64748b;">
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
                ${!notif.read ? '<small class="badge bg-primary">New</small>' : ''}
            </div>
        `;
    }).join('');
}

function updateNotificationBadge() {
    const notifQuery = query(
        collection(db, "notifications"),
        where("uid", "==", currentUser.uid),
        where("read", "==", false)
    );
    
    getDocs(notifQuery).then(snap => {
        const count = snap.size;
        document.getElementById('notificationCount').textContent = count;
    });
}

function checkNotificationPermission() {
    const banner = document.getElementById('notificationBanner');
    if (banner && Notification.permission !== 'granted') {
        banner.style.display = 'block';
    }
}

function clearParentSubs() {
    Object.values(unsubscribers).forEach(list => {
        list.forEach(unsub => unsub());
    });
    unsubscribers = [];
}

// ============== GLOBAL FUNCTIONS FOR PARENT ==============

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
    const success = await requestNotificationPermission(currentUser);
    if (success) {
        document.getElementById('notificationBanner').style.display = 'none';
        showToast("✅ Notifications enabled!", "success");
    }
};

window.requestLeave = async (studentId, studentName) => {
    if (!await confirmAction(`Apply leave for ${studentName} today?`)) return;
    
    try {
        await StudentService.markLeave(studentId);
        showToast(`Leave request submitted for ${studentName}`, "success");
    } catch (error) {
        console.error("Leave request error:", error);
        showToast("Failed to submit leave request", "error");
    }
};

window.requestCustomLocation = (studentId) => {
    const newLocation = prompt("Enter special pickup/dropoff location for today:");
    if (newLocation) {
        // Store in temporary overrides
        const today = todayISO();
        setDoc(doc(db, "students", studentId, "overrides", today), {
            pickupLoc: newLocation,
            dropoffLoc: newLocation,
            requestedAt: new Date(),
            approved: false
        });
        showToast("Location change request submitted", "success");
    }
};

window.contactDriver = async (studentId) => {
    const child = childrenList.find(c => c.id === studentId);
    if (!child?.routeId) {
        showToast("Driver information not available", "error");
        return;
    }
    
    const session = document.getElementById(`sessionSelect_${studentId}`)?.value || defaultSession();
    
    const routeDoc = await getDoc(doc(db, "routes", child.routeId));
    if (!routeDoc.exists()) return;
    
    const route = routeDoc.data();
    const driverUid = session === 'AM' ? route.driverUidAM : route.driverUidPM;
    
    if (!driverUid) {
        showToast("No driver assigned for this session", "error");
        return;
    }
    
    const driverQuery = query(collection(db, "users"), where("uid", "==", driverUid));
    const driverSnap = await getDocs(driverQuery);
    
    if (!driverSnap.empty) {
        const driver = driverSnap.docs[0].data();
        if (driver.phone) {
            window.location.href = `tel:${driver.phone}`;
        } else {
            showToast("Driver phone number not available", "error");
        }
    }
};

window.markNotificationRead = async (notificationId) => {
    await NotificationService.markAsRead(notificationId);
    updateNotificationBadge();
};

window.markAllNotificationsRead = async () => {
    await NotificationService.markAllAsRead(currentUser.uid);
    showToast("All notifications marked as read", "success");
};
