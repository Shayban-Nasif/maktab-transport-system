// js/panels/driver-panel.js
// At the VERY TOP of driver-panel.js
import { db } from '../config/firebase.js';
import { 
    collection, doc, query, where, onSnapshot, 
    getDoc, orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { escapeHtml, showToast, confirmAction, tripIdFor, btnId } from '../utils/helpers.js';
import { computeEtaForStudentFromDocs } from '../utils/eta-calculator.js';
import { todayISO, nowHM, hmToMinutes } from '../utils/date-time.js';
import { TripService } from '../services/trip-service.js';
import { StudentService } from '../services/student-service.js';
import { HistoryService } from '../services/history-service.js';

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
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div>
                    <h2 style="margin:0; font-size:1.2rem;"><i class="fas fa-bus"></i> Driver</h2>
                    <div style="margin-top:4px; opacity:0.9; font-size:0.8rem;">
                        📅 ${todayISO()} | 🕐 <span id="currentTime"></span>
                    </div>
                </div>
                
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <select id="drvRoute" class="form-select" style="min-width:150px; padding:8px;">
                        ${assigned.map(x => `<option value="${x.route.id}">${escapeHtml(x.route.name)}</option>`).join('')}
                    </select>
                    
                    <select id="drvSession" class="form-select" style="min-width:80px; padding:8px;"></select>
                    
                    <button class="btn-ready btn-sm" onclick="window.startTripNow()" style="padding:8px 12px;">
                        <i class="fas fa-play"></i> Start
                    </button>
                    
                    <button class="btn-gray btn-sm" onclick="window.endTripNow()" style="padding:8px 12px;">
                        <i class="fas fa-stop"></i> End
                    </button>
                </div>
            </div>

            <!-- Quick Stats - Simplified for mobile -->
            <div class="driver-stats" style="margin-top:15px; display:flex; gap:5px; justify-content:space-between;">
                <div class="driver-stat-item" style="flex:1; padding:8px; background:rgba(255,255,255,0.2); border-radius:8px; text-align:center;">
                    <div class="small" style="font-size:0.6rem;">Total</div>
                    <div class="large" style="font-size:1.2rem; font-weight:bold;" id="totalStudents">0</div>
                </div>
                <div class="driver-stat-item" style="flex:1; padding:8px; background:rgba(255,255,255,0.2); border-radius:8px; text-align:center;">
                    <div class="small" style="font-size:0.6rem;">Done</div>
                    <div class="large" style="font-size:1.2rem; font-weight:bold;" id="droppedCount">0</div>
                </div>
                <div class="driver-stat-item" style="flex:1; padding:8px; background:rgba(255,255,255,0.2); border-radius:8px; text-align:center;">
                    <div class="small" style="font-size:0.6rem;">Left</div>
                    <div class="large" style="font-size:1.2rem; font-weight:bold;" id="remainingCount">0</div>
                </div>
            </div>

            <!-- Progress Bar -->
            <div style="margin-top:10px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:2px; font-size:0.7rem;">
                    <span>Progress</span>
                    <span id="progressPercent">0%</span>
                </div>
                <div class="progress-container" style="height:6px;">
                    <div id="progressBar" class="progress-bar" style="width:0%;"></div>
                </div>
            </div>
        </div>

        <!-- Trip Status - Simplified -->
        <div class="card" style="margin-bottom:15px; padding:12px; background:#f8fafc;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="badge bg-primary" style="font-size:0.7rem;">TRIP</span>
                    <span id="tripBadge" style="font-weight:bold; font-size:0.8rem;">Not Started</span>
                </div>
                
                <!-- School Arrival Button (for PM) -->
                <button id="schoolArrivalBtn" class="btn-school btn-sm" style="display:none; padding:6px 12px; font-size:0.8rem;" onclick="window.markSchoolArrival()">
                    <i class="fas fa-school"></i> At School
                </button>
            </div>
        </div>

        <!-- Students List -->
        <div id="dList" class="student-list">
            <div class="card" style="text-align:center; padding:30px;">
                <i class="fas fa-spinner fa-spin" style="font-size:20px;"></i>
                <p style="margin-top:10px; font-size:0.9rem;">Loading...</p>
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
            `<option value="${s}">${s}</option>`
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
        schoolBtn.style.display = currentSession === 'PM' ? 'inline-flex' : 'none';
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
                <div class="card" style="text-align:center; padding:30px;">
                    <i class="fas fa-users-slash" style="font-size:30px; color:var(--gray-400);"></i>
                    <p style="margin-top:10px;">No students on this route</p>
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
            <div class="card" style="text-align:center; padding:30px; color:var(--danger);">
                <i class="fas fa-exclamation-triangle" style="font-size:30px;"></i>
                <p style="margin-top:10px;">Error loading students</p>
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
        
        // Simple status display
        let statusDisplay = eta;
        if (eta.includes('PICKED:')) {
            statusDisplay = '✅ ' + eta.replace('PICKED:', '');
        } else if (eta.includes('SCHOOL:')) {
            statusDisplay = '🏫 ' + eta.replace('SCHOOL:', '');
        } else if (eta.includes('HOME:')) {
            statusDisplay = '🏠 ' + eta.replace('HOME:', '');
        } else if (eta === 'NOT AT SCHOOL') {
            statusDisplay = '❌ Not at school';
        }
        
        const field = currentSession === 'AM' ? 'minsAM' : 'minsPM';
        const baseMins = parseInt(st[field] ?? '0', 10);
        const overrideMins = overridesMap?.[sid];
        const minsValue = (overrideMins !== undefined && overrideMins !== null)
            ? overrideMins
            : (Number.isFinite(baseMins) ? baseMins : 0);
        
        const card = document.createElement('div');
        card.className = `driver-student-card ${isLeave ? 'leave' : ''} ${isNext ? 'next-stop' : ''} ${isDone ? 'completed' : ''}`;
        card.style.padding = '15px';
        card.style.marginBottom = '12px';
        
        card.innerHTML = `
            <!-- Student Header -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="stop-badge" style="font-size:0.7rem; padding:4px 8px;">#${st.stopOrder}</span>
                    <strong style="font-size:1rem;">${escapeHtml(st.name)}</strong>
                    ${isLeave ? '<span class="badge bg-danger" style="font-size:0.6rem;">LEAVE</span>' : ''}
                    ${isNext && !isLeave && !isDone ? '<span class="badge bg-warning" style="font-size:0.6rem;">NEXT</span>' : ''}
                </div>
                <div style="font-size:0.8rem; font-weight:bold; ${eta.includes('PICKED') || eta.includes('SCHOOL') || eta.includes('HOME') ? 'color:var(--success);' : ''}">
                    ${statusDisplay}
                </div>
            </div>

            <!-- Location Icons Only (No text) -->
            <div style="display:flex; gap:15px; margin-bottom:10px; background:var(--gray-50); padding:8px; border-radius:8px; font-size:0.7rem; overflow-x:auto; white-space:nowrap;">
                <div><i class="fas fa-map-marker-alt" style="color:var(--admin);"></i> ${escapeHtml(pickup.substring(0,20))}${pickup.length > 20 ? '...' : ''}</div>
                <div><i class="fas fa-flag-checkered" style="color:var(--parent);"></i> ${escapeHtml(dropoff.substring(0,20))}${dropoff.length > 20 ? '...' : ''}</div>
            </div>

            <!-- Timer Controls - Simplified with +/- -->
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                <span style="font-size:0.8rem;"><i class="fas fa-clock"></i></span>
                <div style="display:flex; align-items:center; gap:5px; background:var(--gray-50); padding:5px; border-radius:30px;">
                    <button class="btn-outline btn-sm" onclick="window.adjustStopMins('${sid}', -1)" style="width:30px; height:30px; padding:0; border-radius:50%;">−</button>
                    <span style="min-width:40px; text-align:center; font-weight:bold;">${minsValue}</span>
                    <button class="btn-outline btn-sm" onclick="window.adjustStopMins('${sid}', 1)" style="width:30px; height:30px; padding:0; border-radius:50%;">+</button>
                </div>
                <button class="btn-outline btn-sm" onclick="window.clearStopMins('${sid}')" style="padding:5px 10px; font-size:0.7rem;">
                    <i class="fas fa-undo"></i>
                </button>
            </div>

            ${!isLeave ? `
                <!-- Action Buttons - Simple Icons + Text -->
                <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:5px;">
                    <button class="btn-outline btn-sm" onclick="window.openMapTo('${escapeHtml(pickup)}')" style="padding:8px 0;">
                        <i class="fas fa-map"></i> Map
                    </button>
                    
                    ${renderActionButtons(st, sid, isDone)}
                </div>
            ` : `
                <div style="background:#fff3cd; padding:8px; border-radius:6px; text-align:center; font-size:0.8rem;">
                    <i class="fas fa-exclamation-triangle"></i> On Leave
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
                    ${isDone ? 'disabled' : ''}
                    style="padding:8px 0;">
                <i class="fas fa-user-check"></i> Pick
            </button>
            
            <button id="${btnId(sid, 'morn_drop')}" 
                    class="${isDone ? 'btn-done' : 'btn-school'}" 
                    onclick="window.markEvent('${sid}', '${escapeHtml(student.name)}', 'DROPPED_SCHOOL_AM', 'morn_drop')"
                    ${isDone ? 'disabled' : ''}
                    style="padding:8px 0;">
                <i class="fas fa-school"></i> Drop
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
                    ${!canPick || isPicked ? 'disabled' : ''}
                    style="padding:8px 0;">
                <i class="fas fa-school"></i> Pick
            </button>
            
            <button id="${btnId(sid, 'ret_drop')}" 
                    class="${isDone ? 'btn-done' : 'btn-home'}" 
                    onclick="window.markEvent('${sid}', '${escapeHtml(student.name)}', 'DROPPED_PM', 'ret_drop')"
                    ${isDone ? 'disabled' : ''}
                    style="padding:8px 0;">
                <i class="fas fa-home"></i> Drop
            </button>
        `;
    }
}

function startClock() {
    const updateClock = () => {
        const timeEl = document.getElementById('currentTime');
        if (timeEl) {
            timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
        showToast("Select route & session", "error");
        return;
    }
    
    const startHM = prompt("Start time (HH:MM)", nowHM());
    if (!startHM) return;
    
    if (hmToMinutes(startHM) === null) {
        showToast("Invalid time", "error");
        return;
    }
    
    try {
        await TripService.start(routeId, currentDriverUid, session, startHM);
        showToast(`🚌 Started at ${startHM}`, "success");
    } catch (error) {
        console.error("Start trip error:", error);
        showToast("Failed to start", "error");
    }
};

window.endTripNow = async () => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) {
        showToast("Select route & session", "error");
        return;
    }
    
    if (!await confirmAction(`End ${session} trip?`)) return;
    
    try {
        await TripService.end(routeId, currentDriverUid, session);
        showToast(`🏁 Trip ended`, "success");
    } catch (error) {
        console.error("End trip error:", error);
        showToast("Failed to end", "error");
    }
};

window.markSchoolArrival = async () => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) {
        showToast("Select route & session", "error");
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
        showToast("🏫 At school", "success");
    } catch (error) {
        console.error("School arrival error:", error);
        showToast("Failed", "error");
    }
};

window.markEvent = async (sid, sName, eventType, historyField) => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) {
        showToast("Select route & session", "error");
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
        await HistoryService.update(sid, sName, historyField, timeStr);
        
        // Add event
        await TripService.addEvent(routeId, currentDriverUid, session, sid, sName, eventType, { timeStr });
        
        // Update button
        const btn = document.getElementById(btnId(sid, historyField));
        if (btn) {
            btn.classList.add('btn-done');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-check"></i> Done';
        }
        
        showToast(`✅ ${sName}`, "success");
    } catch (error) {
        console.error("Mark event error:", error);
        showToast("Failed", "error");
    }
};

window.updateStopMins = async (sid, val) => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) {
        showToast("Select route & session", "error");
        return;
    }
    
    const v = val === "" ? null : parseInt(val, 10);
    if (v != null && (!Number.isFinite(v) || v < 0)) {
        showToast("Invalid", "error");
        return;
    }
    
    await TripService.setOverride(routeId, session, sid, v);
    showToast("Updated", "success");
};

window.adjustStopMins = async (sid, delta) => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) return;
    
    // Get current value
    const currentVal = overridesMap?.[sid] || 
        (currentSession === 'AM' ? 
            document.querySelector(`[data-student="${sid}"]`)?.dataset.minsAm : 
            document.querySelector(`[data-student="${sid}"]`)?.dataset.minsPm) || 0;
    
    const newVal = Math.max(0, parseInt(currentVal) + delta);
    await TripService.setOverride(routeId, session, sid, newVal);
};

window.clearStopMins = async (sid) => {
    const routeId = document.getElementById('drvRoute')?.value;
    const session = document.getElementById('drvSession')?.value;
    
    if (!routeId || !session) return;
    
    await TripService.setOverride(routeId, session, sid, null);
    showToast("Reset", "success");
};

window.openMapTo = (destination) => {
    if (!destination) {
        showToast("No destination", "error");
        return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    window.open(url, "_blank");
};
