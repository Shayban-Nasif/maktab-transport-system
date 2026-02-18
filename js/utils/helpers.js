// General helper functions
export const escapeHtml = (str) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const tripIdFor = (routeId, dateStr, session) => {
  return `${routeId}_${dateStr}_${session}`;
};

export const btnId = (sid, field) => `btn_${sid}_${field}`;

export const showToast = (message, type = 'info') => {
  // You can implement a toast notification system
  alert(message); // Simple for now
};

export const confirmAction = (message) => {
  return confirm(message);
};

export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};
