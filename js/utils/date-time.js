// Date and time utility functions
export const todayISO = () => new Date().toLocaleDateString('en-CA');

export const timeHMNow = () => new Date().toLocaleTimeString([], { 
  hour: '2-digit', 
  minute: '2-digit' 
});

export const nowHM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const hmToMinutes = (hm) => {
  if (!hm || !hm.includes(':')) return null;
  const [h, m] = hm.split(':').map(x => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

export const minutesToHM = (mins) => {
  mins = ((mins % (24*60)) + (24*60)) % (24*60);
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
};

export const formatTime = (date) => {
  if (!date) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export const defaultSession = () => (new Date().getHours() < 12 ? 'AM' : 'PM');
