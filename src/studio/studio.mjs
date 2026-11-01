// PDF-Studio: Seiten drehen/löschen/sortieren/anhängen, schiefe Scans automatisch gerade ausrichten,
// Texterkennung (OCR, Deutsch + Englisch) → durchsuchbare PDF. Läuft komplett offline in der abgeschotteten PDF-Sitzung.
import * as pdfjsLib from '/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/build/pdf.worker.mjs';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const pages = [];          // { id, canvas, rot, skew, src: { doc, index } | null, sel }
let dragId = null, busy = false, seq = 0;
const RENDER_W = 1700;     // ≈ 200 dpi bei A4 – gut für Texterkennung

function status(text, frac) {
  $('status').innerHTML = '';
  $('status').append(document.createTextNode(text));
  if (frac != null) { const b = document.createElement('div'); b.className = 'bar2'; b.innerHTML = `<i style="width:${Math.round(frac * 100)}%"></i>`; $('status').append(b); }
}
function setBusy(b) { busy = b; for (const id of ['add', 'rotL', 'rotR', 'del', 'straight', 'save']) $(id).disabled = b; }

// ---------- Laden ----------
async function addFile(bytes, name) {
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;   // %PDF
  if (isPdf) {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      status(`Lädt „${name}“ – Seite ${i} von ${doc.numPages}`, i / doc.numPages);
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, RENDER_W / vp1.width) });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      pages.push({ id: ++seq, canvas: c, rot: 0, skew: 0, src: { bytes, index: i - 1 }, sel: false });
    }
  } else {
    const blob = new Blob([bytes]);
    const img = await createImageBitmap(blob);
    const scale = Math.min(1, 2600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    pages.push({ id: ++seq, canvas: c, rot: 0, skew: 0, src: null, sel: false });
  }
}

// ---------- Anzeige ----------
function finalCanvas(p) {
  // Drehung (90°-Schritte) + Geradeziehen anwenden
  const quarter = ((p.rot % 360) + 360) % 360;
  const swap = quarter === 90 || quarter === 270;
  const w = swap ? p.canvas.height : p.canvas.width, h = swap ? p.canvas.width : p.canvas.height;
  if (!quarter && !p.skew) return p.canvas;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(((quarter + p.skew) * Math.PI) / 180);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(p.canvas, -p.canvas.width / 2, -p.canvas.height / 2);
  return c;
}
function thumb(p) {
  const f = finalCanvas(p);
  const t = document.createElement('canvas');
  const s = 360 / Math.max(f.width, f.height);
  t.width = Math.round(f.width * s); t.height = Math.round(f.height * s);
  t.getContext('2d').drawImage(f, 0, 0, t.width, t.height);
  return t;
}
function render() {
  const grid = $('grid'); grid.innerHTML = '';
  pages.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'page' + (p.sel ? ' sel' : ''); el.draggable = true;
    el.append(thumb(p));
    const n = document.createElement('div'); n.className = 'n';
    n.innerHTML = `<span>Seite ${i + 1}</span><span class="tag">${p.skew ? `gerade (${p.skew > 0 ? '+' : ''}${p.skew.toFixed(1)}°)` : ''}</span>`;
    el.append(n);
    el.onclick = (e) => { if (!(e.ctrlKey || e.metaKey || e.shiftKey)) pages.forEach((x) => { if (x !== p) x.sel = false; }); p.sel = !p.sel; render(); };
    el.ondragstart = () => { dragId = p.id; };
    el.ondragover = (e) => { e.preventDefault(); el.classList.add('drop'); };
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = (e) => {
      e.preventDefault(); el.classList.remove('drop');
      const from = pages.findIndex((x) => x.id === dragId), to = pages.indexOf(p);
      if (from < 0 || from === to) return;
      const [m] = pages.splice(from, 1); pages.splice(to, 0, m); render();
    };
    grid.append(el);
  });
  const sel = pages.filter((p) => p.sel).length;
  if (!busy) status(`${pages.length} Seite${pages.length === 1 ? '' : 'n'}${sel ? ` · ${sel} ausgewählt` : ' · Seiten anklicken zum Auswählen, ziehen zum Sortieren'}`);
}
const targets = () => { const s = pages.filter((p) => p.sel); return s.length ? s : pages; };

// ---------- Geradeziehen (Projektionsprofil: Textzeilen ergeben bei richtiger Lage die schärfsten Spitzen) ----------
function detectSkew(canvas) {
  const W = 900, s = Math.min(1, W / canvas.width);
  const w = Math.max(1, Math.round(canvas.width * s)), h = Math.max(1, Math.round(canvas.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  // dunkle Punkte sammeln (Rand von 4 % auslassen – dort liegen oft Schatten des Scanners)
  const mx = Math.round(w * 0.04), my = Math.round(h * 0.04);
  let sum = 0, cnt = 0;
  for (let i = 0; i < d.length; i += 16) { sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; cnt++; }
  const thr = Math.min(160, (sum / cnt) * 0.72);
  const xs = [], ys = [];
  for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) {
    const i = (y * w + x) * 4;
    if (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < thr) { xs.push(x - w / 2); ys.push(y - h / 2); }
  }
  if (xs.length < 500) return 0;   // fast leere Seite
  const step = Math.max(1, Math.floor(xs.length / 60000));
  const score = (deg) => {
    const a = (deg * Math.PI) / 180, sn = Math.sin(a), cs = Math.cos(a);
    const bins = new Float64Array(h * 2 + 4);
    for (let k = 0; k < xs.length; k += step) bins[Math.round(ys[k] * cs - xs[k] * sn + h + 2)]++;
    let v = 0; for (let k = 1; k < bins.length; k++) { const dd = bins[k] - bins[k - 1]; v += dd * dd; }
    return v;
  };
  let best = 0, bestV = -1;
  for (let deg = -8; deg <= 8; deg += 0.5) { const v = score(deg); if (v > bestV) { bestV = v; best = deg; } }
  const base = best;
  for (let deg = base - 0.5; deg <= base + 0.5; deg += 0.1) { const v = score(deg); if (v > bestV) { bestV = v; best = deg; } }
  // Gefundener Winkel θ: Zeilen fallen mit θ ab → Bild um -θ drehen
  return Math.abs(best) < 0.15 ? 0 : -best;
}

async function straighten(list) {
  setBusy(true);
  let changed = 0;
  for (let i = 0; i < list.length; i++) {
    status(`Richte gerade aus – Seite ${i + 1} von ${list.length}`, (i + 1) / list.length);
    await new Promise((r) => setTimeout(r, 0));
    const a = detectSkew(list[i].canvas);
    list[i].skew = Math.round(a * 10) / 10;
    if (list[i].skew) changed++;
  }
  setBusy(false); render();
  status(changed ? `${changed} Seite${changed === 1 ? '' : 'n'} gerade ausgerichtet` : 'Alle Seiten sind bereits gerade');
}

// ---------- Speichern ----------
const canvasBytes = (c, type = 'image/jpeg', q = 0.85) => new Promise((res) => c.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), type, q));

async function buildPdf(withOcr) {
  const { PDFDocument, degrees } = window.PDFLib;
  const out = await PDFDocument.create();
  out.setProducer('ImmoAdv Browser – PDF-Studio'); out.setCreator('ImmoAdv Browser');
  let worker = null;
  if (withOcr) {
    status('Texterkennung wird vorbereitet …', 0);
    worker = await window.Tesseract.createWorker(['deu', 'eng'], 1, {
      workerPath: '/studio/vendor/worker.min.js', corePath: '/studio/vendor/', langPath: '/studio/vendor',
      gzip: false, workerBlobURL: false, cacheMethod: 'none', logger: () => {}
    });
  }
  const srcDocs = new Map();
  try {
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      status(withOcr ? `Erkenne Text – Seite ${i + 1} von ${pages.length}` : `Speichere Seite ${i + 1} von ${pages.length}`, (i + 1) / pages.length);
      await new Promise((r) => setTimeout(r, 0));
      if (!withOcr && p.src && !p.skew) {
        // unverändert/gedreht: Originalseite übernehmen (Text und Schärfe bleiben erhalten)
        let src = srcDocs.get(p.src.bytes);
        if (!src) { src = await PDFDocument.load(p.src.bytes, { ignoreEncryption: true }); srcDocs.set(p.src.bytes, src); }
        const [pg] = await out.copyPages(src, [p.src.index]);
        if (p.rot) pg.setRotation(degrees(((pg.getRotation().angle + p.rot) % 360 + 360) % 360));
        out.addPage(pg);
        continue;
      }
      const f = finalCanvas(p);
      if (withOcr) {
        // Seite als Bild + unsichtbare Textebene (durchsuchbar, markierbar)
        const { data } = await worker.recognize(f, { pdfTitle: params.get('name') || 'ImmoAdv' }, { pdf: true, text: false, hocr: false, tsv: false, blocks: false });
        const one = await PDFDocument.load(new Uint8Array(data.pdf));
        const [pg] = await out.copyPages(one, [0]);
        out.addPage(pg);
      } else {
        const img = await out.embedJpg(await canvasBytes(f));
        // Seitengröße: 200 dpi angenommen → in PDF-Punkten (1/72 Zoll)
        const k = 72 / 200;
        const pg = out.addPage([f.width * k, f.height * k]);
        pg.drawImage(img, { x: 0, y: 0, width: f.width * k, height: f.height * k });
      }
    }
  } finally { if (worker) await worker.terminate().catch(() => {}); }
  return out.save();
}

async function save() {
  if (!pages.length) return;
  setBusy(true);
  try {
    const bytes = await buildPdf($('ocr').checked);
    const base = (params.get('name') || 'Dokument').replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    a.download = `${base}${$('ocr').checked ? ' (durchsuchbar)' : ' (bearbeitet)'}.pdf`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    status('Gespeichert – öffnet gleich im PDF-Betrachter');
  } catch (e) {
    status('Speichern fehlgeschlagen: ' + (e && e.message ? e.message : e));
  } finally { setBusy(false); }
}

// ---------- Bedienung ----------
$('rotL').onclick = () => { for (const p of targets()) p.rot -= 90; render(); };
$('rotR').onclick = () => { for (const p of targets()) p.rot += 90; render(); };
$('del').onclick = () => {
  const sel = pages.filter((p) => p.sel);
  if (!sel.length) return status('Erst Seiten zum Löschen anklicken');
  if (sel.length === pages.length) return status('Mindestens eine Seite muss bleiben');
  for (const p of sel) pages.splice(pages.indexOf(p), 1);
  render();
};
$('straight').onclick = () => straighten(targets());
$('save').onclick = save;
$('add').onclick = () => $('file').click();
$('file').onchange = async () => {
  setBusy(true);
  try { for (const f of $('file').files) await addFile(new Uint8Array(await f.arrayBuffer()), f.name); }
  catch (e) { status('Datei konnte nicht gelesen werden: ' + e.message); }
  $('file').value = ''; setBusy(false); render();
};

(async () => {
  $('name').textContent = params.get('name') || '';
  setBusy(true);
  try {
    const r = await fetch(`/__file/${encodeURIComponent(params.get('file') || '')}`);
    if (!r.ok) throw new Error('Datei nicht gefunden');
    await addFile(new Uint8Array(await r.arrayBuffer()), params.get('name') || 'Dokument');
    setBusy(false); render();
    // Eingescannte Seiten (ohne Text) gleich gerade ausrichten
    if (params.get('auto') === '1') straighten(pages);
  } catch (e) { setBusy(false); status('Konnte die Datei nicht öffnen: ' + e.message); }
})();

export { detectSkew };
