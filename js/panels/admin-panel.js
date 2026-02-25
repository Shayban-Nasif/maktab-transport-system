// js/panels/admin-panel.js
// Admin panel module
import { db } from '../config/firebase.js';
import { 
    collection, onSnapshot, query, orderBy, limit, 
    addDoc, updateDoc, deleteDoc, writeBatch, getDocs, doc, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { escapeHtml, showToast, confirmAction } from '../utils/helpers.js';
import { StudentService, RouteService, UserService } from '../services/firestore.js';

let secondaryAuth = null;

export function renderAdmin(target, routesList, driverMap) {
    // Initialize secondary auth for user creation
    try {
        secondaryAuth = getAuth();
    } catch (e) {
        console.log("Secondary auth not initialized");
    }
    
    // Render admin dashboard HTML
    target.innerHTML = getAdminHTML(routesList, driverMap);
    
    // Set up all event listeners
    setupAdminListeners(routesList, driverMap);
    
    // Load real-time data
    loadLogs();
    loadStudents(routesList);
}

function getAdminHTML(routesList, driverMap) {
    return `
        <div class="admin-dashboard">
            <div class="admin-card" onclick="window.location='#students'">
                <div class="icon">👥</div>
                <div class="title">Students</div>
                <div class="count" id="studentCount">0</div>
            </div>
            <div class="admin-card" onclick="window.location='#drivers'">
                <div class="icon">🚌</div>
                <div class="title">Drivers</div>
                <div class="count" id="driverCount">${Object.keys(driverMap).length}</div>
            </div>
            <div class="admin-card" onclick="window.location='#routes'">
                <div class="icon">🗺️</div>
                <div class="title">Routes</div>
                <div class="count" id="routeCount">${routesList.length}</div>
            </div>
            <div class="admin-card" onclick="window.location='#logs'">
                <div class="icon">📊</div>
                <div class="title">Today's Trips</div>
                <div class="count" id="tripCount">0</div>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-box">
                <div class="label">AM Trips</div>
                <div class="value" id="amTrips">0</div>
            </div>
            <div class="stat-box">
                <div class="label">PM Trips</div>
                <div class="value" id="pmTrips">0</div>
            </div>
            <div class="stat-box">
                <div class="label">On Leave</div>
                <div class="value" id="leaveCount">0</div>
            </div>
            <div class="stat-box">
                <div class="label">Completed</div>
                <div class="value" id="completedCount">0</div>
            </div>
        </div>

        <button class="btn-reset" onclick="window.resetAllStudents()">
            🔄 RESET SYSTEM FOR NEW DAY
        </button>

        <!-- Daily Transport Logs -->
        <div class="card">
            <h4>📋 Daily Transport Logs</h4>
            <div class="scroll-box">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Student</th>
                            <th>AM Pick</th>
                            <th>AM Drop</th>
                            <th>PM Pick</th>
                            <th>PM Drop</th>
                        </tr>
                    </thead>
                    <tbody id="logsTableBody"></tbody>
                </table>
            </div>
        </div>

        <!-- Route Management -->
        <div class="card" id="routes">
            <h4>🗺️ Route Management</h4>
            <div class="scroll-box">
                <table>
                    <thead>
                        <tr>
                            <th>Route</th>
                            <th>AM Driver</th>
                            <th>PM Driver</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="rtTableBody">
                        ${renderRouteRows(routesList, driverMap)}
                    </tbody>
                </table>
            </div>
            <form id="regRouteForm" class="form-grid" style="margin-top:20px;">
                <input type="text" id="rtName" placeholder="New Route Name" required>
                <button type="submit" class="btn-route">➕ Create Route</button>
            </form>
        </div>

        <!-- Driver Registration -->
        <div class="card" id="drivers">
            <h4>🚌 Driver Registration</h4>
            <form id="regDriverForm" class="form-grid">
                <input type="text" id="dName" placeholder="Full Name" required>
                <input type="email" id="dEmail" placeholder="Email" required>
                <input type="text" id="dPhone" placeholder="Phone" required>
                <input type="text" id="dCar" placeholder="Vehicle Details" required>
                <input type="password" id="dPass" placeholder="Password" required>
                <button type="submit" class="btn-ready">👤 Register Driver</button>
            </form>
        </div>

        <!-- Registered Drivers -->
        <div class="card">
            <h4>👥 Registered Drivers</h4>
            <div class="scroll-box">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Vehicle</th>
                            <th>Email</th>
                        </tr>
                    </thead>
                    <tbody id="driverTableBody">
                        ${renderDriverRows(driverMap)}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Student Enrollment -->
        <div class="card" id="students">
            <h4>👨‍🎓 Student Enrollment</h4>
            <form id="regStForm" class="form-grid">
                <input type="text" id="sName" placeholder="Student Name" required>
                <select id="sGender">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                </select>
                <input type="date" id="sDob" required>
                <input type="text" id="sFather" placeholder="Father's Name">
                <input type="text" id="sFPhone" placeholder="Father's Phone">
                <input type="text" id="sMother" placeholder="Mother's Name">
                <input type="text" id="sMPhone" placeholder="Mother's Phone">
                <select id="sPrimary">
                    <option value="Father">Primary: Father</option>
                    <option value="Mother">Primary: Mother</option>
                </select>
                <input type="email" id="sPEmail" placeholder="Parent Email" required>
                <input type="password" id="sPPass" placeholder="Parent Password" required>
                <input type="text" id="sAddr" placeholder="Home Address" class="full-width">
                <select id="sRouteSelect" class="full-width">
                    <option value="">Select Route...</option>
                    ${routesList.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
                </select>
                <button type="submit" class="btn-ready full-width">📝 Enroll Student</button>
            </form>
        </div>

        <!-- Student Database -->
        <div class="card">
            <h4>📚 Student Database</h4>
            <div class="scroll-box">
                <table>
                    <thead>
                        <tr>
                            <th>Student</th>
                            <th>Route</th>
                            <th>Pickup</th>
                            <th>Dropoff</th>
                            <th>Stop #</th>
                            <th>AM min</th>
                            <th>PM min</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="stTableBody"></tbody>
                </table>
            </div>
        </div>
    `;
}

function renderRouteRows(routesList, driverMap) {
    return routesList.map(r => {
        let amOptions = '<option value="">Unassigned</option>';
        let pmOptions = '<option value="">Unassigned</option>';
        
        Object.keys(driverMap).forEach(uid => {
            amOptions += `<option value="${uid}" ${(r.driverUidAM||'') === uid ? 'selected' : ''}>${driverMap[uid].fullName}</option>`;
            pmOptions += `<option value="${uid}" ${(r.driverUidPM||'') === uid ? 'selected' : ''}>${driverMap[uid].fullName}</option>`;
        });
        
        return `
            <tr>
                <td><b>${escapeHtml(r.name)}</b></td>
                <td><select onchange="window.setRouteDriver('${r.id}','AM', this.value)">${amOptions}</select></td>
                <td><select onchange="window.setRouteDriver('${r.id}','PM', this.value)">${pmOptions}</select></td>
                <td><button onclick="window.delDoc('routes','${r.id}')" class="btn-danger btn-sm">🗑️</button></td>
            </tr>
        `;
    }).join('');
}

function renderDriverRows(driverMap) {
    return Object.values(driverMap).map(d => `
        <tr>
            <td><b>${escapeHtml(d.fullName || '-')}</b></td>
            <td>${escapeHtml(d.phone || '-')}</td>
            <td>${escapeHtml(d.assignedCar || '-')}</td>
            <td>${escapeHtml(d.email || '-')}</td>
        </tr>
    `).join('');
}

function setupAdminListeners(routesList, driverMap) {
    // Route creation
    document.getElementById('regRouteForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('rtName').value;
        try {
            await RouteService.create(name);
            showToast("Route created!", "success");
            e.target.reset();
        } catch (error) {
            console.error("Route creation error:", error);
            showToast("Failed to create route: " + error.message, "error");
        }
    });
    
    // Driver registration
    document.getElementById('regDriverForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!secondaryAuth) {
            showToast("Authentication not available", "error");
            return;
        }
        
        const dName = document.getElementById('dName').value;
        const dEmail = document.getElementById('dEmail').value;
        const dPhone = document.getElementById('dPhone').value;
        const dCar = document.getElementById('dCar').value;
        const dPass = document.getElementById('dPass').value;
        
        try {
            showToast("Creating driver account...", "info");
            
            const cred = await createUserWithEmailAndPassword(
                secondaryAuth, 
                dEmail, 
                dPass
            );
            
            await UserService.create({
                uid: cred.user.uid,
                fullName: dName,
                email: dEmail,
                role: "driver",
                phone: dPhone,
                assignedCar: dCar
            });
            
            await signOut(secondaryAuth);
            showToast("Driver registered successfully!", "success");
            e.target.reset();
        } catch (error) {
            console.error("Driver registration error:", error);
            
            let errorMessage = error.message;
            if (error.code === 'auth/email-already-in-use') {
                errorMessage = "Email already in use";
            } else if (error.code === 'auth/weak-password') {
                errorMessage = "Password too weak (min 6 characters)";
            }
            
            showToast(errorMessage, "error");
        }
    });
    
    // Student enrollment - FIXED VERSION
    document.getElementById('regStForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Get form values
        const sName = document.getElementById('sName').value;
        const sGender = document.getElementById('sGender').value;
        const sDob = document.getElementById('sDob').value;
        const sFather = document.getElementById('sFather').value;
        const sFPhone = document.getElementById('sFPhone').value;
        const sMother = document.getElementById('sMother').value;
        const sMPhone = document.getElementById('sMPhone').value;
        const sPrimary = document.getElementById('sPrimary').value;
        const sPEmail = document.getElementById('sPEmail').value;
        const sPPass = document.getElementById('sPPass').value;
        const sAddr = document.getElementById('sAddr').value;
        const sRouteSelect = document.getElementById('sRouteSelect').value;
        
        // Validate required fields
        if (!sName || !sDob || !sPEmail || !sPPass || !sAddr) {
            showToast("Please fill all required fields", "error");
            return;
        }
        
        try {
            showToast("Creating parent account...", "info");
            
            // Create parent account
            const parentCred = await createUserWithEmailAndPassword(
                secondaryAuth,
                sPEmail,
                sPPass
            );
            
            // Create parent user record
            await UserService.create({
                uid: parentCred.user.uid,
                fullName: sFather || sMother || "Parent",
                email: sPEmail,
                role: "parent",
                phone: sFPhone || sMPhone || "",
                children: []
            });
            
            // Create student record
            const studentData = {
                name: sName,
                gender: sGender,
                dob: sDob,
                father: sFather,
                fPhone: sFPhone,
                mother: sMother,
                mPhone: sMPhone,
                primary: sPrimary,
                parentUid: parentCred.user.uid,
                address: sAddr,
                pickupLoc: sAddr,
                dropoffLoc: sAddr,
                routeId: sRouteSelect || null,
                status: "AWAITING",
                stopOrder: null,
                minsAM: null,
                minsPM: null,
                doneAM: false,
                donePM: false,
                createdAt: new Date().toISOString()
            };
            
            await StudentService.create(studentData);
            
            // Sign out from secondary auth
            await signOut(secondaryAuth);
            
            showToast("Student enrolled successfully!", "success");
            e.target.reset();
            
        } catch (error) {
            console.error("Enrollment error:", error);
            
            let errorMessage = error.message;
            if (error.code === 'auth/email-already-in-use') {
                errorMessage = "Parent email already in use";
            } else if (error.code === 'auth/weak-password') {
                errorMessage = "Password too weak (min 6 characters)";
            }
            
            showToast(errorMessage, "error");
        }
    });
    
    // Global functions for onclick handlers
    window.setRouteDriver = async (routeId, session, driverUid) => {
        try {
            await RouteService.setDriver(routeId, session, driverUid);
            showToast("Driver assigned", "success");
        } catch (error) {
            console.error("Error assigning driver:", error);
            showToast("Failed to assign driver", "error");
        }
    };
    
    window.delDoc = async (collection, id) => {
        if (!await confirmAction("Delete this item?")) return;
        
        try {
            if (collection === 'routes') {
                await RouteService.delete(id);
            } else if (collection === 'students') {
                await StudentService.delete(id);
            }
            showToast("Deleted successfully", "success");
        } catch (error) {
            console.error("Delete error:", error);
            showToast("Failed to delete", "error");
        }
    };
    
    window.resetAllStudents = async () => {
        if (!await confirmAction("Reset ALL students for new day?")) return;
        
        try {
            const batch = writeBatch(db);
            const snap = await getDocs(collection(db, "students"));
            snap.forEach(d => batch.update(d.ref, { 
                status: "AWAITING", 
                doneAM: false, 
                donePM: false 
            }));
            await batch.commit();
            showToast("System reset complete!", "success");
        } catch (error) {
            console.error("Reset error:", error);
            showToast("Failed to reset", "error");
        }
    };
    
    window.setStudentFieldNumber = async (sid, field, val) => {
        const v = val === "" ? null : parseInt(val, 10);
        if (v != null && (!Number.isFinite(v) || v < 0)) {
            showToast("Invalid number", "error");
            return;
        }
        try {
            await StudentService.update(sid, { [field]: v });
            showToast("Updated", "success");
        } catch (error) {
            console.error("Update error:", error);
            showToast("Failed to update", "error");
        }
    };
    
    window.updateStudentLocation = async (sid, type, address) => {
        if (!address) {
            showToast("Address cannot be empty", "error");
            return;
        }
        
        const field = type === 'pickup' ? 'pickupLoc' : 'dropoffLoc';
        try {
            await StudentService.update(sid, { [field]: address });
            showToast("Location updated", "success");
        } catch (error) {
            console.error("Location update error:", error);
            showToast("Failed to update location", "error");
        }
    };
    
    window.setStudentRoute = async (sid, routeId) => {
        try {
            await StudentService.update(sid, { routeId });
            showToast("Route updated", "success");
        } catch (error) {
            console.error("Route update error:", error);
            showToast("Failed to update route", "error");
        }
    };
}

function loadLogs() {
    const logsQuery = query(collection(db, "history"), orderBy("timestamp", "desc"), limit(50));
    onSnapshot(logsQuery, (snap) => {
        const tbody = document.getElementById('logsTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = snap.docs.map(d => {
            const h = d.data();
            return `
                <tr>
                    <td><small>${h.date || '-'}</small></td>
                    <td><strong>${escapeHtml(h.studentName || 'Unknown')}</strong></td>
                    <td style="color:var(--driver)">${h.morn_pick || '--:--'}</td>
                    <td style="color:var(--driver)">${h.morn_drop || '--:--'}</td>
                    <td style="color:var(--route)">${h.ret_pick || '--:--'}</td>
                    <td style="color:var(--route)">${h.ret_drop || '--:--'}</td>
                </tr>
            `;
        }).join('');
    });
}

function loadStudents(routesList) {
    onSnapshot(collection(db, "students"), (snap) => {
        const tbody = document.getElementById('stTableBody');
        if (!tbody) return;
        
        // Update counts
        document.getElementById('studentCount').textContent = snap.size;
        
        const leaveCount = snap.docs.filter(d => d.data().status === 'LEAVE').length;
        document.getElementById('leaveCount').textContent = leaveCount;
        
        // Update completed count (students with doneAM true)
        const completedCount = snap.docs.filter(d => d.data().doneAM === true).length;
        document.getElementById('completedCount').textContent = completedCount;
        
        tbody.innerHTML = snap.docs.map(d => {
            const s = d.data();
            const sid = d.id;
            
            let rtOptions = '<option value="">None</option>';
            routesList.forEach(r => {
                rtOptions += `<option value="${r.id}" ${s.routeId === r.id ? 'selected' : ''}>${r.name}</option>`;
            });
            
            return `
                <tr>
                    <td>
                        <b>${escapeHtml(s.name || '')}</b>
                        ${s.status === 'LEAVE' ? '<span class="badge bg-danger" style="margin-left:5px;">LEAVE</span>' : ''}
                    </td>
                    <td>
                        <select onchange="window.setStudentRoute('${sid}', this.value)" style="max-width:120px;">
                            ${rtOptions}
                        </select>
                    </td>
                    <td>
                        <input type="text" value="${escapeHtml(s.pickupLoc || s.address || '')}" 
                               onchange="window.updateStudentLocation('${sid}', 'pickup', this.value)"
                               placeholder="Pickup" style="max-width:150px;">
                    </td>
                    <td>
                        <input type="text" value="${escapeHtml(s.dropoffLoc || s.address || '')}" 
                               onchange="window.updateStudentLocation('${sid}', 'dropoff', this.value)"
                               placeholder="Dropoff" style="max-width:150px;">
                    </td>
                    <td>
                        <input type="number" min="1" value="${s.stopOrder ?? ''}" style="width:60px;"
                               onchange="window.setStudentFieldNumber('${sid}','stopOrder', this.value)">
                    </td>
                    <td>
                        <input type="number" min="0" value="${s.minsAM ?? ''}" style="width:60px;"
                               onchange="window.setStudentFieldNumber('${sid}','minsAM', this.value)">
                    </td>
                    <td>
                        <input type="number" min="0" value="${s.minsPM ?? ''}" style="width:60px;"
                               onchange="window.setStudentFieldNumber('${sid}','minsPM', this.value)">
                    </td>
                    <td>
                        <button onclick="window.delDoc('students','${sid}')" class="btn-danger btn-sm">🗑️</button>
                    </td>
                </tr>
            `;
        }).join('');
    });
}
