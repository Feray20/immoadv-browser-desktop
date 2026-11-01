// Gemeinsamer Kern: PDF/Bild laden, schiefe Scans erkennen und gerade ziehen, Texterkennung (OCR) → durchsuchbare PDF.
// Wird vom PDF-Betrachter (automatisch bei Scans) und von „Seiten bearbeiten“ benutzt. Komplett offline.
import * as pdfjsLib from '/build/pdf.mjs';
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = '/build/pdf.worker.mjs';
export const RENDER_W = 1700;     // ≈ 200 dpi bei A4 – gut für Texterkennung
let seq = 0;

const loadScript = (src) => new Promise((res, rej) => { if ([...document.scripts].some((s) => s.src.endsWith(src))) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Baustein fehlt: ' + src)); document.head.append(s); });
export async function libs() { await loadScript('/studio/vendor/pdf-lib.min.js'); await loadScript('/studio/vendor/tesseract.min.js'); }

/** Seiten einer PDF- oder Bilddatei als Bildflächen (für Geradeziehen/OCR) */
export async function loadPages(bytes, name, onProgress = () => {}) {
  const out = [];
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;   // %PDF
  if (isPdf) {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      onProgress(`Lädt „${name}“ – Seite ${i} von ${doc.numPages}`, i / doc.numPages);
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, RENDER_W / vp1.width) });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push({ id: ++seq, canvas: c, rot: 0, skew: 0, src: { bytes, index: i - 1 }, sel: false });
    }
    await doc.destroy();
  } else {
    const img = await createImageBitmap(new Blob([bytes]));
    const scale = Math.min(1, 2600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    out.push({ id: ++seq, canvas: c, rot: 0, skew: 0, src: null, sel: false });
  }
  return out;
}

/** Hat die PDF schon echten Text? (sonst ist sie ein Scan) */
export async function hasText(bytes, maxPages = 3) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  let chars = 0;
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    chars += tc.items.reduce((n, it) => n + (it.str || '').trim().length, 0);
  }
  await doc.destroy();
  return chars >= 40;
}

export function finalCanvas(p) {
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

export function detectSkew(canvas) {
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


export const canvasBytes = (c, type = 'image/jpeg', q = 0.85) => new Promise((res) => c.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), type, q));

export async function buildPdf(pages, withOcr, title = 'ImmoAdv', onProgress = () => {}) {
  await libs();
  const { PDFDocument, degrees } = window.PDFLib;
  const out = await PDFDocument.create();
  out.setProducer('ImmoAdv Browser – PDF-Studio'); out.setCreator('ImmoAdv Browser');
  let worker = null;
  if (withOcr) {
    onProgress('Texterkennung wird vorbereitet …', 0);
    worker = await window.Tesseract.createWorker(['deu', 'eng'], 1, {
      workerPath: '/studio/vendor/worker.min.js', corePath: '/studio/vendor/', langPath: '/studio/vendor',
      gzip: false, workerBlobURL: false, cacheMethod: 'none', logger: () => {}
    });
  }
  const srcDocs = new Map();
  try {
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      onProgress(withOcr ? `Erkenne Text – Seite ${i + 1} von ${pages.length}` : `Speichere Seite ${i + 1} von ${pages.length}`, (i + 1) / pages.length);
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
        const { data } = await worker.recognize(f, { pdfTitle: title }, { pdf: true, text: false, hocr: false, tsv: false, blocks: false });
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

