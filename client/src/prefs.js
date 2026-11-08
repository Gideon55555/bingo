// Device preferences that aren't tied to the account.
const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };

/** Low-data mode: don't download games or voice clips in advance; render at 1× resolution.
 *  Defaults to on when the phone's "Data Saver" is on. */
export const lowData = () => read('low_data', !!navigator.connection?.saveData);
export const setLowData = (on) => { try { localStorage.setItem('low_data', on ? '1' : '0'); } catch { /* ignore */ } };
/** Canvas pixel ratio: sharp on good connections/phones, lighter in low-data mode. */
export const canvasDpr = () => (lowData() ? 1 : Math.min(2, window.devicePixelRatio || 1));
