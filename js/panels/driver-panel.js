// Driver panel module
import { db } from '../config/firebase.js';
import { 
    collection, doc, query, where, onSnapshot, 
    updateDoc, getDocs, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { escapeHtml, showToast, confirmAction, tripIdFor, btnId } from '../utils/helpers.js';
import { computeEtaForStudentFromDocs } from '../utils/eta-calculator.js';
import { todayISO, nowHM, hmToMinutes, formatTime } from '../utils/date-time.js';
import { TripService, StudentService } from '../services/firestore.js';

// State for current driver view
let currentRouteId = null;
let currentSession = null;
let unsubTrip = null;
let unsubOverrides = null;
let unsubStudents = null;
let unsubEvents = null;
let pickupEvents = [];
let dropoffEvents = [];

export function renderDriver(target, uid, routesList, driverMap) {
    // Clear any existing listeners
    clearDriverSubs();
    
    // Find assigned routes for this driver
    const assigned = routesList
        .map(r => {
            const am = (r.driverUidAM || "") === uid;
            const pm = (r.driverUidPM || "") === uid;
            const sessions = [];
            if (am) sessions.push("AM");
            if (pm) sessions.push("PM");
            return sessions.length ? { route: r, sessions } : null;
        })
        .filter(Boolean);

    if (assigned.length === 0) {
        target.innerHTML = `
            <div class="card" style="text-align:center; padding:40px;">
                <div class="empty-state">
                    <div class="icon">🚌</div>
                    <h3>No Route Assigned</h3>
                    <p class="text-muted">Please contact the administrator to assign you a route.</p>
                </div>
            </div>
        `;
        return;
    }

    // Render driver header
    target.innerHTML = getDriverHTML(assigned);
    
    // Initialize route and session selectors
    initDriverControls(assigned, uid);
    
    // Set up real-time updates for clock
    startClock();
}

function getDriverHTML(assigned) {
    return `
        <div class="driver-header">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
                <div>
                    <h2 style="margin:0;"><i class="fas fa-bus"></i> Driver Console</h2>
                    <div class="text-light" style="margin-top:4px;">
                        📅 ${todayISO()} | 🕐 <span id="currentTime"></span>
                    </div>
                </div>
                
                <div style="display:flex; gap:12px; margin-top:10px;">
                    <select id="drvRoute" class="form-select">
                        ${assigned.map(x => `<option value="${x.route.id}">${escapeHtml(x.route.name)}</option>`).join('')}
                    </select>
                    
                    <select id="drvSession" class="form-select"></select>
                    
                    <button class="btn-ready" onclick="window.startTripNow()">
                        🚀 Start Trip
                    </button>
                    
                    <button class="btn-gray" onclick="window.endTripNow()">
                        🏁 End Trip
                    </button>
                </div>
            </div>

            <!-- Quick Stats -->
            <div class="driver-stats">
                <div class="driver-stat-item">
                    <div class="small">Total Students</div>
                    <div class="large" id="totalStudents">0</div>
                </div>
                <div class="driver-stat-item">
                    <div class="small">Picked Up</div>
                    <div class="large" id="pickedCount">0</div>
                </div>
                <div class="driver-stat-item">
                    <div class="small">Dropped</div>
                    <div class="large" id="droppedCount">0</div>
                </div>
                <div class="driver-stat-item">
                    <div class="small">Remaining</div>
                    <div class="large" id="remainingCount">0</div>
                </div>
            </div>

            <!-- Progress Bar -->
            <div style="margin-top:15px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <span>Route Progress</span>
                    <span id="progressPercent">0%</span>
                </div>
                <div class="progress-container">
                    <div id="progressBar" class="progress-bar" style="width:0%;"></div>
                </div>
            </div>
        </div>

        <!-- Trip Status Card -->
        <div class="card" style="margin-bottom:20px; background:#f8fafc;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:16px;">
                    <span class="badge bg-primary">TRIP</span>
                    <div>
                        <span id="tripBadge" class="fw-bold">Not Started</span>
                        <span id="tripState" class="text-muted" style="margin-left:8px;"></span>
                    </div>
                </div>
                
                <!-- School Arrival Button (for PM) -->
                <button id="schoolArrivalBtn" class="btn-school" style="display:none;" onclick="window.markSchoolArrival()">
                    🏫 Bus Arrived at School
                </button>
            </div>
        </div>

        <!-- Quick Tips -->
        <div class="alert alert-info" style="margin-bottom:20px;">
            💡 <strong>Quick Tip:</strong> Click the 🗺️ Map button to navigate to student location. 
            Use duration presets for quick ETA adjustments.
        </div>

        <!-- Students List -->
        <div id="dList" class="student-list"></div>
    `;
}

function initDriverControls(assigned, uid) {
    const routeSelect = document.getElementById('drvRoute');
    const sessionSelect = document.getElementById('drvSession');
    
    // Set session options based on selected route
    const updateSessionOptions = () => {
        const routeId = routeSelect.value;
        const item = assigned.find(x => x.route.id === routeId);
        
        sessionSelect.innerHTML = item.sessions.map(s => 
            `<option value="${s}">${s} Trip ${s === 'AM' ? '☀️' : '🌙'}</option>`
        ).join('');
        
        // Set default session
        const defaultSess = new Date().getHours() < 12 ? 'AM' : 'PM';
        sessionSelect.value = item.sessions.includes(defaultSess) ? defaultSess : item.sessions[0];
    };
    
    updateSessionOptions();
    
    // Add event listeners
    routeSelect.addEventListener('change', () => {
        updateSessionOptions();
        loadTripData(uid);
    });
    
    sessionSelect.addEventListener('change', () => {
        loadTripData(uid);
    });
    
    // Load initial data
    loadTripData(uid);
}

function loadTripData(uid) {
    currentRouteId = document.getElementById('drvRoute').value;
    currentSession = document.getElementById('drvSession').value;
    
    if (!currentRouteId || !currentSession) return;
    
    const tid = tripIdFor(currentRouteId, todayISO(), currentSession);
    
    // Update trip badge
    document.getElementById('tripBadge').innerText = tid;
    
    // Clear old listeners
    clearDriverSubs();
    
    // Show/hide school arrival button based on session
    const schoolBtn = document.getElementById('schoolArrivalBtn');
    if (schoolBtn) {
        schoolBtn.style.display = currentSession === 'PM' ? 'block' : 'none';
    }
    
    // Listen to trip document
    unsubTrip = onSnapshot(doc(db, "trips", tid), (snap) => {
        const stateEl = document.getElementById('tripState');
        if (stateEl) {
            if (snap.exists()) {
                const data = snap.data();
                stateEl.innerText = `(${data.status || 'LIVE'}) Started at ${data.tripStartHM || '--:--'}`;
            } else {
                stateEl.innerText = "(Not started - click Start Trip)";
            }
        }
    });
    
    // Listen to overrides
    unsubOverrides = onSnapshot(collection(db, "trips", tid, "overrides"), (oSnap) => {
        window.overridesMap = {};
        oSnap.forEach(d => {
            const data = d.data();
            window.overridesMap[d.id] = data?.mins ?? null;
        });
    });
    
    // Listen to events
    unsubEvents = onSnapshot(
        query(collection(db, "trips", tid, "events"), orderBy("timestamp", "asc")),
        (eSnap) => {
            pickupEvents = eSnap.docs
                .map(d => d.data())
                .filter(e => e.type?.includes('PICKED'));
            
            dropoffEvents = eSnap.docs
                .map(d => d.data())
                .filter(e => e.type?.includes('DROPPED'));
        }
    );
    
    // Listen to students
    loadStudentsList();
}

function loadStudentsList() {
    unsubStudents = onSnapshot(
        query(collection(db, "students"), where("routeId", "==", currentRouteId)),
        (snap) => {
            const list = document.getElementById('dList');
            if (!list) return;
            
            const docs = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(s => s.stopOrder != null)
                .sort((a, b) => (a.stopOrder ?? 9999) - (b.stopOrder ?? 9999));
            
            // Update stats
            updateStats(docs);
            
            // Get trip start time
            const tid = tripIdFor(currentRouteId, todayISO(), currentSession);
            getDoc(doc(db, "trips", tid)).then(tripSnap => {
                const tripStartHM = tripSnap.exists() ? tripSnap.data().tripStartHM : null;
                renderStudentsList(list, docs, tripStartHM);
            });
        }
    );
}

function updateStats(docs) {
    const total = docs.length;
    const picked = docs.filter(s => 
        currentSession === 'AM' ? 
            pickupEvents.some(e => e.studentId === s.id && e.type === 'PICKED_AM') :
            pickupEvents.some(e => e.studentId === s.id && e.type === 'PICKED_SCHOOL_PM')
    ).length;
    
    const dropped = docs.filter(s => 
        currentSession === 'AM' ? s.doneAM : s.donePM
    ).length;
    
    document.getElementById('totalStudents').textContent = total;
    document.getElementById('pickedCount').textContent = picked;
    document.getElementById('droppedCount').textContent = dropped;
    document.getElementById('remainingCount').textContent = total - dropped;
    
    const progress = total ? Math.round((dropped / total) * 100) : 0;
    document.getElementById('progressPercent').textContent = `${progress}%`;
    document.getElementById('progressBar').style.width = `${progress}%`;
}

function renderStudentsList(container, docs, tripStartHM) {
    container.innerHTML = '';
    
    const completedCount = docs.filter(s => currentSession === 'AM' ? s.doneAM : s.donePM).length;
    
    docs.forEach((st, index) => {
        const sid = st.id;
        const isLeave = st.status === 'LEAVE';
        const isDone = currentSession === 'AM' ? st.doneAM : st.donePM;
        const isNext = !isDone && !isLeave && index === completedCount;
        
        const pickup = st.pickupLoc || st.address || '';
        const dropoff = st.dropoffLoc || st.address || '';
        
        const eta = tripStartHM
            ? computeEtaForStudentFromDocs(
                currentSession, 
                sid, 
                tripStartHM, 
                docs, 
                window.overridesMap || {}, 
                pickupEvents, 
                dropoffEvents
              )
            : '--:--';
        
        // Determine status class and icon
        let statusClass = '';
        let statusIcon = '🕒';
        
        if (eta.includes('PICKED:')) {
            statusClass = 'picked';
            statusIcon = '✅';
        } else if (eta.includes('SCHOOL:')) {
            statusClass = 'at-school';
            statusIcon = '🏫';
        } else if (eta.includes('HOME:')) {
            statusClass = 'at-home';
            statusIcon = '🏠';
        } else if (eta === 'NOT AT SCHOOL') {
            statusClass = 'not-at-school';
            statusIcon = '❌';
        } else if (eta.includes('(at school)')) {
            statusClass = 'info';
            statusIcon = '🚌';
        }
        
        const field = currentSession === 'AM' ? 'minsAM' : 'minsPM';
        const baseMins = parseInt(st[field] ?? '0', 10);
        const overrideMins = window.overridesMap?.[sid];
        const minsValue = (overrideMins !== undefined && overrideMins !== null)
            ? overrideMins
            : (Number.isFinite(baseMins) ? baseMins : 0);
        
        container.innerHTML += `
            <div class="student-card ${isLeave ? 'leave' : ''} ${isNext ? 'next-stop' : ''} ${isDone ? 'completed' : ''}">
                <!-- Header -->
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <span class="badge bg-secondary">#${st.stopOrder}</span>
                        <div>
                            <strong style="font-size:1.1rem;">${escapeHtml(st.name)}</strong>
                            ${isLeave ? '<span class="badge bg-danger">ON LEAVE</span>' : ''}
                            ${isDone ? '<span class="badge bg-success">COMPLETED</span>' : ''}
                            ${isNext && !isLeave && !isDone ? '<span class="badge bg-warning">NEXT STOP</span>' : ''}
                        </div>
                    </div>
                    
                    <div class="status-chip ${statusClass}">
                        ${statusIcon} ${eta}
                    </div>
                </div>

                <!-- Location Info -->
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:12px 0; background:#f8fafc; padding:12px; border-radius:12px;">
                    <div>
                        <small>📍 PICKUP</small>
                        <div>${escapeHtml(pickup)}</div>
                    </div>
                    <div>
                        <small>🏁 DROPOFF</small>
                        <div>${escapeHtml(dropoff)}</div>
                    </div>
                </div>

                <!-- Duration Controls -->
                <div style="margin:12px 0;">
                    <small>⏱️ Stop Duration:</small>
                    <div class="duration-presets">
                        <span class="duration-btn" onclick="window.updateStopMins('${sid}', 2)">2min</span>
                        <span class="duration-btn" onclick="window.updateStopMins('${sid}', 5)">5min</span>
                        <span class="duration-btn" onclick="window.updateStopMins('${sid}', 10)">10min</span>
                        <span class="duration-btn" onclick="window.updateStopMins('${sid}', 15)">15min</span>
                        <span class="duration-btn" onclick="window.updateStopMins('${sid}', 20)">20min</span>
                        <span class="duration-btn" onclick="window.updateStopMins('${sid}', 25)">25min</span>
                        
                        <input type="number" min="0" step="1" 
                               value="${minsValue}" 
                               onchange="window.updateStopMins('${sid}', this.value)"
                               style="width:70px; padding:6px;"
                               placeholder="Custom">
                        
                        <button class="btn-outline" onclick="window.clearStopMins('${sid}')">
                            ↩️ Reset
                        </button>
                    </div>
                </div>

                ${!isLeave ? `
                    <!-- Action Buttons -->
                    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
                        <button class="btn-outline" onclick="window.openMapTo('${escapeHtml(pickup)}')">
                            🗺️ Navigate
                        </button>
                        
                        ${renderActionButtons(st, sid, isDone)}
                    </div>
                ` : `
                    <div class="alert alert-warning" style="margin-top:12px;">
                        ⚠️ Student is on leave today. No actions required.
                    </div>
                `}
            </div>
        `;
    });
}

function renderActionButtons(student, sid, isDone) {
    if (currentSession === 'AM') {
        return `
            <button id="${btnId(sid, 'morn_pick')}" 
                    class="${isDone ? 'btn-done' : 'btn-ready'}" 
                    onclick="window.markEvent('${sid}', '${escapeHtml(student.name)}', 'PICKED_AM', 'morn_pick')"
                    ${isDone ? 'disabled' : ''}>
                ✅ Pick Up
            </button>
            
            <button id="${btnId(sid, 'morn_drop')}" 
                    class="${isDone ? 'btn-done' : 'btn-school'}" 
                    onclick="window.markEvent('${sid}', '${escapeHtml(student.name)}', 'DROPPED_SCHOOL_AM', 'morn_drop')"
                    ${isDone ? 'disabled' : ''}>
                🏫 Drop at School
            </button>
        `;
    } else {
        const canPick = student.doneAM && !student.donePM;
        const isPicked = pickupEvents.some(e => 
            e.studentId === sid && e.type === 'PICKED_SCHOOL_PM'
        );
        
        return `
            <button id="${btnId(sid, 'ret_pick')}" 
                    class="${!canPick ? 'btn-disabled' : (isPicked ? 'btn-done' : 'btn-ready')}" 
                    onclick="window.markEvent('${sid}', '${escapeHtml(student.name)}', 'PICKED_SCHOOL_PM', 'ret_pick')"
                    ${!canPick || isPicked ? 'disabled' : ''}>
                🏫 Pick from School
            </button>
            
            <button id="${btnId(sid, 'ret_drop')}" 
                    class="${isDone ? 'btn-done' : 'btn-home'}" 
                    onclick="window.markEvent('${sid}', '${escapeHtml(student.name)}', 'DROPPED_PM', 'ret_drop')"
                    ${isDone ? 'disabled' : ''}>
                🏠 Drop Home
            </button>
        `;
    }
}

function startClock() {
    const updateClock = () => {
        const timeEl = document.getElementById('currentTime');
        if (timeEl) {
            timeEl.textContent = new Date().toLocaleTimeString();
        }
    };
    updateClock();
    setInterval(updateClock, 1000);
}

function clearDriverSubs() {
    if (unsubTrip) { unsubTrip(); unsubTrip = null; }
    if (unsubOverrides) { unsubOverrides(); unsubOverrides = null; }
    if (unsubStudents) { unsubStudents(); unsubStudents = null; }
    if (unsubEvents) { unsubEvents(); unsubEvents = null; }
}

// ============== GLOBAL FUNCTIONS FOR DRIVER ==============

window.startTripNow = async () => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) {
        showToast("Please select route and session", "error");
        return;
    }
    
    const startHM = prompt("Enter trip start time (HH:MM)", nowHM());
    if (!startHM) return;
    
    if (hmToMinutes(startHM) === null) {
        showToast("Invalid time format", "error");
        return;
    }
    
    try {
        const auth = (await import('../config/firebase.js')).auth;
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");
        
        await TripService.start(routeId, user.uid, session, startHM);
        showToast(`🚌 Trip started at ${startHM}`, "success");
    } catch (error) {
        console.error("Start trip error:", error);
        showToast("Failed to start trip", "error");
    }
};

window.endTripNow = async () => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) {
        showToast("Please select route and session", "error");
        return;
    }
    
    if (!await confirmAction(`End ${session} trip?`)) return;
    
    try {
        const auth = (await import('../config/firebase.js')).auth;
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");
        
        await TripService.end(routeId, user.uid, session);
        showToast(`🏁 Trip ended`, "success");
    } catch (error) {
        console.error("End trip error:", error);
        showToast("Failed to end trip", "error");
    }
};

window.markSchoolArrival = async () => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) {
        showToast("Please select route and session", "error");
        return;
    }
    
    try {
        const auth = (await import('../config/firebase.js')).auth;
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");
        
        await TripService.addEvent(
            routeId, 
            user.uid, 
            session, 
            null, 
            null, 
            'BUS_ARRIVED_SCHOOL'
        );
        showToast("🏫 Bus arrived at school", "success");
    } catch (error) {
        console.error("School arrival error:", error);
        showToast("Failed to record arrival", "error");
    }
};

window.markEvent = async (sid, sName, eventType, historyField) => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) {
        showToast("Please select route and session", "error");
        return;
    }
    
    try {
        const auth = (await import('../config/firebase.js')).auth;
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");
        
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Update student status
        const updates = { status: historyField.replace('_', ' ').toUpperCase() };
        
        if (eventType === 'DROPPED_SCHOOL_AM') updates.doneAM = true;
        if (eventType === 'DROPPED_PM') updates.donePM = true;
        
        await StudentService.update(sid, updates);
        
        // Update history
        await import('../services/firestore.js').then(({ HistoryService }) => {
            return HistoryService.update(sid, sName, historyField, timeStr);
        });
        
        // Add event
        await TripService.addEvent(routeId, user.uid, session, sid, sName, eventType, { timeStr });
        
        // Update button
        const btn = document.getElementById(btnId(sid, historyField));
        if (btn) {
            btn.classList.add('btn-done');
            btn.disabled = true;
            btn.innerHTML = '✅ DONE';
        }
        
        showToast(`✅ ${sName} ${eventType.replace('_', ' ')}`, "success");
    } catch (error) {
        console.error("Mark event error:", error);
        showToast("Failed to record event", "error");
    }
};

window.updateStopMins = async (sid, val) => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) {
        showToast("Please select route and session", "error");
        return;
    }
    
    const v = val === "" ? null : parseInt(val, 10);
    if (v != null && (!Number.isFinite(v) || v < 0)) {
        showToast("Invalid minutes", "error");
        return;
    }
    
    await TripService.setOverride(routeId, session, sid, v);
    showToast("Duration updated", "success");
};

window.clearStopMins = async (sid) => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) return;
    
    await TripService.setOverride(routeId, session, sid, null);
    showToast("Reset to default", "success");
};

window.openMapTo = (destination) => {
    if (!destination) {
        showToast("No destination found", "error");
        return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    window.open(url, "_blank");
};
