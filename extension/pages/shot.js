'use strict';
// Ganzseiten-Bildschirmfoto bearbeiten: markieren, Freihand, Textmarker, schwärzen (deckend – das Bild darunter ist beim
// Speichern wirklich weg, nicht nur überdeckt). Alles bleibt auf dem Gerät.
const $ = (id) => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const img = new Image();
const ops = [];
let tool = 'box', color = '#ff3b30', cur = null, title = 'Seite';

const lw = () => Math.max(3, Math.round(cv.width / 400));
function drawOp(o) {
  ctx.save();
  if (o.t === 'redact') { ctx.fillStyle = '#000'; ctx.fillRect(o.x, o.y, o.w, o.h); }
  else if (o.t === 'box') { ctx.strokeStyle = o.c; ctx.lineWidth = o.lw; ctx.lineJoin = 'round'; ctx.strokeRect(o.x, o.y, o.w, o.h); }
  else if (o.t === 'pen' || o.t === 'hl') {
    ctx.strokeStyle = o.c; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = o.t === 'hl' ? o.lw * 5 : o.lw; ctx.globalAlpha = o.t === 'hl' ? 0.35 : 1;
    ctx.beginPath(); o.p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  }
  ctx.restore();
}
function paint() { ctx.drawImage(img, 0, 0); ops.forEach(drawOp); if (cur) drawOp(cur); }
const norm = (o) => (o.w < 0 ? { ...o, x: o.x + o.w, w: -o.w } : o);
const norm2 = (o) => { o = norm(o); return o.h < 0 ? { ...o, y: o.y + o.h, h: -o.h } : o; };
function pos(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; }

cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  const [x, y] = pos(e);
  cur = tool === 'pen' || tool === 'hl' ? { t: tool, c: color, lw: lw(), p: [[x, y]] } : { t: tool, c: color, lw: lw(), x, y, w: 0, h: 0 };
});
cv.addEventListener('pointermove', (e) => {
  if (!cur) return;
  const [x, y] = pos(e);
  if (cur.p) cur.p.push([x, y]); else { cur.w = x - cur.x; cur.h = y - cur.y; }
  requestAnimationFrame(paint);
});
cv.addEventListener('pointerup', () => {
  if (!cur) return;
  const o = cur.p ? cur : norm2(cur); cur = null;
  if (o.p ? o.p.length > 1 : o.w > 3 && o.h > 3) ops.push(o);
  paint();
});
document.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => { tool = b.dataset.tool; document.querySelectorAll('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
document.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { color = b.dataset.c; document.querySelectorAll('[data-c]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
$('undo').onclick = () => { ops.pop(); paint(); };
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $('undo').click(); return; }
  const k = { r: 'box', s: 'pen', m: 'hl', x: 'redact' }[e.key.toLowerCase()];
  if (k && !e.ctrlKey && !e.metaKey) document.querySelector(`[data-tool="${k}"]`).click();
});
const blob = () => new Promise((ok) => cv.toBlob(ok, 'image/png'));
const say = (t) => { $('note').textContent = t; clearTimeout(say.t); say.t = setTimeout(() => { $('note').textContent = ''; }, 4000); };
$('save').onclick = async () => {
  const b = await blob();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  // Fester Speicherort (Einstellungen → Allgemein → Bildschirmfotos & PDFs): ohne Nachfrage direkt in den Ordner.
  const ask = await browser.runtime.sendMessage({ type: 'settings:get' }).then((x) => !x || x.askDownload !== false).catch(() => true);
  if (!ask) {
    try {
      const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(b); });
      const x = await browser.runtime.sendMessage({ type: 'shots:save', dataUrl, name: `Bildschirmfoto ${title} ${stamp}` });
      say(`Gespeichert in ${x.dir} ✓`); return;
    } catch (e) { say('Direkt speichern ging nicht – bitte Ordner wählen.'); }
  }
  const url = URL.createObjectURL(b);
  try { await browser.downloads.download({ url, filename: `Bildschirmfoto ${title} ${stamp}.png`.replace(/[\\/:*?"<>|#%]+/g, ' '), saveAs: true }); say('Gespeichert ✓'); }
  catch (e) { if (!/cancel/i.test(e.message)) say('Nicht gespeichert: ' + e.message); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob() })]); say('In die Zwischenablage kopiert ✓'); }
  catch (e) { say('Kopieren geht hier nicht – bitte „Speichern“.'); }
};

(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const s = id ? await browser.runtime.sendMessage({ type: 'shot:get', id }) : null;
  if (!s) { say('Bild nicht mehr da – bitte neu aufnehmen.'); return; }
  title = String(s.title || 'Seite').slice(0, 60);
  document.title = `Bildschirmfoto: ${title} – ImmoAdv Browser`;
  img.onload = () => { cv.width = img.naturalWidth; cv.height = img.naturalHeight; paint(); };
  img.src = s.data;
})();
