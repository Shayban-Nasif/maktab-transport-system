import { hmToMinutes, minutesToHM, formatTime } from './date-time.js';

// ETA calculation function for AM/PM sessions
export function computeEtaForStudentFromDocs(
  session, 
  studentId, 
  tripStartHM, 
  docs, 
  overridesMap = {}, 
  pickupEvents = [], 
  dropoffEvents = []
) {
  const base = hmToMinutes(tripStartHM);
  if (base === null) return '--:--';

  const field = (session === 'AM') ? 'minsAM' : 'minsPM';

  // Get sorted list by stop order
  const list = docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => Number.isFinite(s.stopOrder))
    .sort((a, b) => (a.stopOrder ?? 9999) - (b.stopOrder ?? 9999));

  const me = list.find(x => x.id === studentId);
  if (!me) return '--:--';

  // ============= PM SESSION LOGIC =============
  if (session === 'PM') {
    // Check if student was dropped at school in AM
    const amDropEvent = dropoffEvents.find(e => 
      e.studentId === studentId && e.type === 'DROPPED_SCHOOL_AM'
    );
    
    if (!amDropEvent && !me.doneAM) {
      return 'NOT AT SCHOOL';
    }

    // Check if already dropped home
    if (me.donePM) {
      const dropEvent = dropoffEvents.find(e => 
        e.studentId === studentId && e.type === 'DROPPED_PM'
      );
      if (dropEvent?.timestamp?.toDate) {
        return `HOME: ${formatTime(dropEvent.timestamp.toDate())}`;
      }
      return 'AT HOME';
    }

    // Check if picked up from school
    const pmPickEvent = pickupEvents.find(e => 
      e.studentId === studentId && e.type === 'PICKED_SCHOOL_PM'
    );
    
    if (pmPickEvent?.timestamp?.toDate) {
      return `PICKED: ${formatTime(pmPickEvent.timestamp.toDate())}`;
    }

    // Check if we've arrived at school yet
    const schoolArrivalEvent = pickupEvents.find(e => 
      e.type === 'BUS_ARRIVED_SCHOOL'
    );
    
    if (!schoolArrivalEvent) {
      return minutesToHM(base + 10) + ' (at school)';
    }

    // Calculate based on actual school arrival
    const schoolTime = schoolArrivalEvent.timestamp?.toDate();
    if (!schoolTime) return '--:--';
    
    const schoolBase = schoolTime.getHours() * 60 + schoolTime.getMinutes();
    let cumulativeMins = 0;
    
    for (const st of list) {
      const isDropped = dropoffEvents.some(e => 
        e.studentId === st.id && e.type === 'DROPPED_PM'
      );
      
      if (st.id === studentId) {
        return minutesToHM(schoolBase + cumulativeMins);
      }
      
      if (!isDropped) {
        const override = overridesMap?.[st.id];
        const minsRaw = (override !== undefined && override !== null) ? override : st[field];
        const mins = parseInt(minsRaw ?? '0', 10);
        cumulativeMins += Number.isFinite(mins) ? mins : 0;
      }
    }
  }

  // ============= AM SESSION LOGIC =============
  if (session === 'AM') {
    // If dropped at school
    if (me.doneAM) {
      const dropEvent = dropoffEvents.find(e => 
        e.studentId === studentId && e.type === 'DROPPED_SCHOOL_AM'
      );
      if (dropEvent?.timestamp?.toDate) {
        return `SCHOOL: ${formatTime(dropEvent.timestamp.toDate())}`;
      }
      return 'AT SCHOOL';
    }

    // If picked up
    const amPickEvent = pickupEvents.find(e => 
      e.studentId === studentId && e.type === 'PICKED_AM'
    );
    
    if (amPickEvent?.timestamp?.toDate) {
      return `PICKED: ${formatTime(amPickEvent.timestamp.toDate())}`;
    }
  }

  // Calculate ETA for pending
  let cumulativeMins = 0;
  for (const st of list) {
    if (st.id === studentId) break;
    
    if (session === 'PM') {
      const isDropped = dropoffEvents.some(e => 
        e.studentId === st.id && e.type === 'DROPPED_PM'
      );
      if (!isDropped) {
        const override = overridesMap?.[st.id];
        const minsRaw = (override !== undefined && override !== null) ? override : st[field];
        const mins = parseInt(minsRaw ?? '0', 10);
        cumulativeMins += Number.isFinite(mins) ? mins : 0;
      }
    } else {
      const isPicked = pickupEvents.some(e => 
        e.studentId === st.id && e.type === 'PICKED_AM'
      );
      if (!isPicked) {
        const override = overridesMap?.[st.id];
        const minsRaw = (override !== undefined && override !== null) ? override : st[field];
        const mins = parseInt(minsRaw ?? '0', 10);
        cumulativeMins += Number.isFinite(mins) ? mins : 0;
      }
    }
  }

  return minutesToHM(base + cumulativeMins);
}
