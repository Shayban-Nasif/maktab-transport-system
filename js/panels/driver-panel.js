// js/panels/driver-panel.js
import { db } from '../config/firebase.js';
import { 
    collection, doc, query, where, onSnapshot, 
    getDoc, orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { escapeHtml, showToast, confirmAction, tripIdFor, btnId } from '../utils/helpers.js';
import { computeEtaForStudentFromDocs } from '../utils/eta-calculator.js';
import { todayISO, nowHM, hmToMinutes } from '../utils/date-time.js';
import { TripService, StudentService } from '../services/firestore.js';

// State
let currentRouteId = null;
let currentSession = null;
let currentDriverUid = null;
let routesList = [];
let driverMap = {};
let unsubscribers = {
    trip: null,
    overrides: null,
    students: null,
    events: null
};
let pickupEvents = [];
let dropoffEvents = [];
let overridesMap = {};

export function renderDriver(target, uid, routes, drivers) {
    console.log('🎯 renderDriver called with uid:', uid);
    console.log('Routes received:', routes);
    console.log('Drivers received:', drivers);
    
    currentDriverUid = uid;
    routesList = routes;
    driverMap = drivers;
    
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

    console.log('Assigned routes:', assigned);

    if (assigned.length === 0) {
        target.innerHTML = `
            <div class="card" style="text-align:center; padding:40px;">
                <div class="empty-state">
                    <i class="fas fa-bus" style="font-size:48px; color:var(--gray-400);"></i>
                    <h3 style="margin-top:16px;">No Route Assigned</h3>
                    <p class="text-muted">Please contact the administrator to assign you a route.</p>
                </div>
            </div>
        `;
        return;
    }

    // Render the driver panel
    target.innerHTML = getDriverHTML(assigned);
    
    // Initialize controls
    initDriverControls(assigned);
    
    // Start clock
    startClock();
}

function getDriverHTML(assigned) {
    return `
        <div class="driver-header">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
                <div>
                    <h2 style="margin:0;"><i class="fas fa-bus"></i> Driver Console</h2>
                    <div style="margin-top:4px; opacity:0.9;">
                        📅 ${todayISO()} | 🕐 <span id="currentTime"></span>
                    </div>
                </div>
                
                <div style="display:flex; gap:12px; margin-top:10px; flex-wrap:wrap;">
                    <select id="drvRoute" class="form-select" style="min-width:200px;">
                        ${assigned.map(x => `<option value="${x.route.id}">${escapeHtml(x.route.name)}</option>`).join('')}
                    </select>
                    
                    <select id="drvSession" class="form-select" style="min-width:120px;"></select>
                    
                    <button class="btn-ready" onclick="window.startTripNow()">
                        <i class="fas fa-play"></i> Start Trip
                    </button>
                    
                    <button class="btn-gray" onclick="window.endTripNow()">
                        <i class="fas fa-stop"></i> End Trip
                    </button>
                </div>
            </div>

            <!-- Quick Stats -->
            <div class="driver-stats" style="margin-top:20px;">
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
                        <span id="tripBadge" style="font-weight:bold;">Not Started</span>
                        <span id="tripState" style="margin-left:8px; color:var(--gray-500);"></span>
                    </div>
                </div>
                
                <!-- School Arrival Button (for PM) -->
                <button id="schoolArrivalBtn" class="btn-school" style="display:none;" onclick="window.markSchoolArrival()">
                    <i class="fas fa-school"></i> Bus Arrived at School
                </button>
            </div>
        </div>

        <!-- Quick Tips -->
        <div class="alert alert-info" style="margin-bottom:20px;">
            <i class="fas fa-lightbulb"></i> 
            <strong>Quick Tip:</strong> Click the <i class="fas fa-map"></i> Map button to navigate to student location. 
            Use duration presets for quick ETA adjustments.
        </div>

        <!-- Students List -->
        <div id="dList" class="student-list">
            <div class="card" style="text-align:center; padding:40px;">
                <i class="fas fa-spinner fa-spin" style="font-size:24px;"></i>
                <p style="margin-top:16px;">Loading students...</p>
            </div>
        </div>
    `;
}

function initDriverControls(assigned) {
    const routeSelect = document.getElementById('drvRoute');
    const sessionSelect = document.getElementById('drvSession');
    
    if (!routeSelect || !sessionSelect) {
        console.error('Driver controls not found');
        return;
    }
    
    // Set session options based on selected route
    const updateSessionOptions = () => {
        const routeId = routeSelect.value;
        const item = assigned.find(x => x.route.id === routeId);
        
        if (!item) return;
        
        sessionSelect.innerHTML = item.sessions.map(s => 
            `<option value="${s}">${s} Trip ${s === 'AM' ? '☀️' : '🌙'}</option>`
        ).join('');
        
        // Set default session based on time of day
        const defaultSess = new Date().getHours() < 12 ? 'AM' : 'PM';
        sessionSelect.value = item.sessions.includes(defaultSess) ? defaultSess : item.sessions[0];
        
        // Load data for this route/session
        loadTripData();
    };
    
    updateSessionOptions();
    
    // Add event listeners
    routeSelect.addEventListener('change', updateSessionOptions);
    sessionSelect.addEventListener('change', loadTripData);
}

function loadTripData() {
    // Clear existing listeners
    Object.values(unsubscribers).forEach(unsub => {
        if (unsub) unsub();
    });
    
    currentRouteId = document.getElementById('drvRoute')?.value;
    currentSession = document.getElementById('drvSession')?.value;
    
    if (!currentRouteId || !currentSession) {
        console.error('Route or session not selected');
        return;
    }
    
    console.log('Loading trip data for:', { route: currentRouteId, session: currentSession });
    
    const tid = tripIdFor(currentRouteId, todayISO(), currentSession);
    
    // Update trip badge
    const tripBadge = document.getElementById('tripBadge');
    if (tripBadge) tripBadge.innerText = tid;
    
    // Show/hide school arrival button based on session
    const schoolBtn = document.getElementById('schoolArrivalBtn');
    if (schoolBtn) {
        schoolBtn.style.display = currentSession === 'PM' ? 'block' : 'none';
    }
    
    // Listen to trip document
    unsubscribers.trip = onSnapshot(doc(db, "trips", tid), (snap) => {
        const stateEl = document.getElementById('tripState');
        if (stateEl) {
            if (snap.exists()) {
                const data = snap.data();
                stateEl.innerText = `(${data.status || 'LIVE'}) Started at ${data.tripStartHM || '--:--'}`;
            } else {
                stateEl.innerText = "(Not started - click Start Trip)";
            }
        }
    }, (error) => {
        console.error('Trip listener error:', error);
    });
    
    // Listen to overrides
    unsubscribers.overrides = onSnapshot(collection(db, "trips", tid, "overrides"), (oSnap) => {
        overridesMap = {};
        oSnap.forEach(d => {
            const data = d.data();
            overridesMap[d.id] = data?.mins ?? null;
        });
        console.log('Overrides updated:', overridesMap);
    });
    
    // Listen to events
    unsubscribers.events = onSnapshot(
        query(collection(db, "trips", tid, "events"), orderBy("timestamp", "asc")),
        (eSnap) => {
            pickupEvents = eSnap.docs
                .map(d => d.data())
                .filter(e => e.type?.includes('PICKED'));
            
            dropoffEvents = eSnap.docs
                .map(d => d.data())
                .filter(e => e.type?.includes('DROPPED'));
            
            console.log('Events loaded:', { pickup: pickupEvents.length, dropoff: dropoffEvents.length });
        }
    );
    
    // Load students
    loadStudentsList();
}

function loadStudentsList() {
    console.log('Loading students for route:', currentRouteId);
    
    const studentsQuery = query(
        collection(db, "students"), 
        where("routeId", "==", currentRouteId)
    );
    
    unsubscribers.students = onSnapshot(studentsQuery, (snap) => {
        console.log('Students loaded:', snap.size);
        
        const list = document.getElementById('dList');
        if (!list) return;
        
        if (snap.empty) {
            list.innerHTML = `
                <div class="card" style="text-align:center; padding:40px;">
                    <i class="fas fa-users-slash" style="font-size:48px; color:var(--gray-400);"></i>
                    <h3 style="margin-top:16px;">No Students Found</h3>
                    <p class="text-muted">No students assigned to this route.</p>
                </div>
            `;
            return;
        }
        
        const docs = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(s => s.stopOrder != null)
            .sort((a, b) => (a.stopOrder ?? 9999) - (b.stopOrder ?? 9999));
        
        console.log('Sorted students:', docs.map(s => ({ name: s.name, stopOrder: s.stopOrder })));
        
        // Update stats
        updateStats(docs);
        
        // Get trip start time
        const tid = tripIdFor(currentRouteId, todayISO(), currentSession);
        getDoc(doc(db, "trips", tid)).then(tripSnap => {
            const tripStartHM = tripSnap.exists() ? tripSnap.data().tripStartHM : null;
            renderStudentsList(list, docs, tripStartHM);
        });
        
    }, (error) => {
        console.error('Students listener error:', error);
        document.getElementById('dList').innerHTML = `
            <div class="card" style="text-align:center; padding:40px; color:var(--danger);">
                <i class="fas fa-exclamation-triangle" style="font-size:48px;"></i>
                <p style="margin-top:16px;">Error loading students: ${error.message}</p>
            </div>
        `;
    });
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
                overridesMap, 
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
        const overrideMins = overridesMap?.[sid];
        const minsValue = (overrideMins !== undefined && overrideMins !== null)
            ? overrideMins
            : (Number.isFinite(baseMins) ? baseMins : 0);
        
        const card = document.createElement('div');
        card.className = `driver-student-card ${isLeave ? 'leave' : ''} ${isNext ? 'next-stop' : ''} ${isDone ? 'completed' : ''}`;
        
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <span class="stop-badge">#${st.stopOrder}</span>
                    <div>
                        <strong style="font-size:1.1rem;">${escapeHtml(st.name)}</strong>
                        ${isLeave ? '<span class="badge bg-danger" style="margin-left:8px;">ON LEAVE</span>' : ''}
                        ${isDone ? '<span class="badge bg-success" style="margin-left:8px;">COMPLETED</span>' : ''}
                        ${isNext && !isLeave && !isDone ? '<span class="badge bg-warning" style="margin-left:8px;">NEXT STOP</span>' : ''}
                    </div>
                </div>
                
                <div class="status-chip ${statusClass}">
                    ${statusIcon} ${eta}
                </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:12px 0; background:var(--gray-50); padding:12px; border-radius:12px;">
                <div>
                    <small class="text-muted"><i class="fas fa-map-marker-alt"></i> PICKUP</small>
                    <div style="font-size:0.9rem;">${escapeHtml(pickup)}</div>
                </div>
                <div>
                    <small class="text-muted"><i class="fas fa-flag-checkered"></i> DROPOFF</small>
                    <div style="font-size:0.9rem;">${escapeHtml(dropoff)}</div>
                </div>
            </div>

            <div style="margin:12px 0;">
                <small class="text-muted"><i class="fas fa-hourglass-half"></i> Stop Duration:</small>
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
                           style="width:70px; padding:4px; border:1px solid var(--gray-200); border-radius:20px;"
                           placeholder="Custom">
                    
                    <button class="btn-outline btn-sm" onclick="window.clearStopMins('${sid}')" style="padding:4px 12px;">
                        <i class="fas fa-undo"></i> Reset
                    </button>
                </div>
            </div>

            ${!isLeave ? `
                <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-top:12px;">
                    <button class="btn-outline" onclick="window.openMapTo('${escapeHtml(pickup)}')">
                        <i class="fas fa-map"></i> Navigate
                    </button>
                    
                    ${renderActionButtons(st, sid, isDone)}
                </div>
            ` : `
                <div class="alert alert-warning" style="margin-top:12px;">
                    <i class="fas fa-exclamation-triangle"></i>
                    Student is on leave today. No actions required.
                </div>
            `}
        `;
        
        container.appendChild(card);
    });
}

function renderActionButtons(student, sid, isDone) {
    if (currentSession === 'AM') {
        return `
            <button id="${btnId(sid, 'morn_pick')}" 
                    class="${isDone ? 'btn-done' : 'btn-ready'}" 
                    onclick="window.markEvent('${sid}', '${escapeHtml(student.name)}', 'PICKED_AM', 'morn_pick')"
                    ${isDone ? 'disabled' : ''}>
                <i class="fas fa-user-check"></i> Pick Up
            </button>
            
            <button id="${btnId(sid, 'morn_drop')}" 
                    class="${isDone ? 'btn-done' : 'btn-school'}" 
                    onclick="window.markEvent('${sid}', '${escapeHtml(student.name)}', 'DROPPED_SCHOOL_AM', 'morn_drop')"
                    ${isDone ? 'disabled' : ''}>
                <i class="fas fa-school"></i> Drop at School
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
                <i class="fas fa-school"></i> Pick from School
            </button>
            
            <button id="${btnId(sid, 'ret_drop')}" 
                    class="${isDone ? 'btn-done' : 'btn-home'}" 
                    onclick="window.markEvent('${sid}', '${escapeHtml(student.name)}', 'DROPPED_PM', 'ret_drop')"
                    ${isDone ? 'disabled' : ''}>
                <i class="fas fa-home"></i> Drop Home
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

// ============== GLOBAL FUNCTIONS ==============

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
        showToast("Invalid time format. Use HH:MM (e.g., 06:55)", "error");
        return;
    }
    
    try {
        await TripService.start(routeId, currentDriverUid, session, startHM);
        showToast(`🚌 Trip started at ${startHM}`, "success");
    } catch (error) {
        console.error("Start trip error:", error);
        showToast("Failed to start trip: " + error.message, "error");
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
        await TripService.end(routeId, currentDriverUid, session);
        showToast(`🏁 Trip ended`, "success");
    } catch (error) {
        console.error("End trip error:", error);
        showToast("Failed to end trip: " + error.message, "error");
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
        await TripService.addEvent(
            routeId, 
            currentDriverUid, 
            session, 
            null, 
            null, 
            'BUS_ARRIVED_SCHOOL'
        );
        showToast("🏫 Bus arrived at school", "success");
    } catch (error) {
        console.error("School arrival error:", error);
        showToast("Failed to record arrival: " + error.message, "error");
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
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Update student status
        const updates = { status: historyField.replace('_', ' ').toUpperCase() };
        
        if (eventType === 'DROPPED_SCHOOL_AM') updates.doneAM = true;
        if (eventType === 'DROPPED_PM') updates.donePM = true;
        
        await StudentService.update(sid, updates);
        
        // Update history
        const { HistoryService } = await import('../services/firestore.js');
        await HistoryService.update(sid, sName, historyField, timeStr);
        
        // Add event
        await TripService.addEvent(routeId, currentDriverUid, session, sid, sName, eventType, { timeStr });
        
        // Update button
        const btn = document.getElementById(btnId(sid, historyField));
        if (btn) {
            btn.classList.add('btn-done');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-check"></i> DONE';
        }
        
        showToast(`✅ ${sName} ${eventType.replace('_', ' ')}`, "success");
    } catch (error) {
        console.error("Mark event error:", error);
        showToast("Failed to record event: " + error.message, "error");
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
