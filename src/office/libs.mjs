// Bausteine für den Office-Leser im ImmoAdv Browser: nur JSZip wird gebraucht (lokal mitgeliefert, kein Internet).
const once = new Map();
function script(src) {
  if (once.has(src)) return once.get(src);
  const p = new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = () => ok(); s.onerror = () => no(new Error('Baustein fehlt')); document.head.append(s); });
  once.set(src, p); return p;
}
export async function jszip() { if (!window.JSZip) await script('./jszip-bundle.js'); if (!window.JSZip) throw new Error('ZIP-Baustein fehlt'); return window.JSZip; }
// Nur für das Schreiben in ImmoAdv nötig – im Browser wird nur gelesen.
export const pptxgen = async () => { throw new Error('nicht verfügbar'); };
export const dataUrlBytes = () => { throw new Error('nicht verfügbar'); };
export const toPng = async () => { throw new Error('nicht verfügbar'); };
export const imgSize = async () => ({ w: 0, h: 0 });
