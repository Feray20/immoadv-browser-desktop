// Läuft im PDF-Betrachter: Eingescannte PDF (ohne Text) → automatisch gerade ausrichten und Text erkennen.
// Das Original bleibt unverändert; die verbesserte Fassung wird angezeigt und kann neben dem Original gespeichert werden.
import { hasText, loadPages, detectSkew, buildPdf } from '/studio/core.mjs';

const app = () => window.PDFViewerApplication;
let original = null, improved = null, running = false, lastDocId = null;

function bar() {
  let b = document.getElementById('immoAuto');
  if (b) return b;
  b = document.createElement('div');
  b.id = 'immoAuto';
  b.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:100000;display:flex;align-items:center;gap:10px;' +
    'padding:10px 14px;border-radius:14px;background:rgba(11,26,46,.96);color:#eef3fb;font:13px/1.4 "Segoe UI",system-ui,sans-serif;' +
    'box-shadow:0 12px 32px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);max-width:calc(100vw - 32px)';
  document.body.append(b);
  return b;
}
const btn = (label, primary, fn) => {
  const x = document.createElement('button');
  x.textContent = label;
  x.style.cssText = `height:30px;padding:0 12px;border-radius:999px;border:${primary ? '0' : '1px solid rgba(255,255,255,.2)'};cursor:pointer;color:#fff;font:inherit;` +
    (primary ? 'background:linear-gradient(120deg,#2A5BD7,#19C2B0);font-weight:600' : 'background:rgba(255,255,255,.08)');
  x.onclick = fn; return x;
};
function show(text, frac, buttons = []) {
  const b = bar(); b.innerHTML = '';
  const t = document.createElement('span'); t.textContent = text; b.append(t);
  if (frac != null) {
    const w = document.createElement('span'); w.style.cssText = 'width:120px;height:4px;border-radius:4px;background:rgba(255,255,255,.15);overflow:hidden;display:inline-block';
    const i = document.createElement('i'); i.style.cssText = `display:block;height:100%;width:${Math.round(frac * 100)}%;background:linear-gradient(90deg,#2A5BD7,#19C2B0)`;
    w.append(i); b.append(w);
  }
  for (const x of buttons) b.append(x);
}
const hide = () => document.getElementById('immoAuto')?.remove();
const title = () => (document.title || 'Dokument').replace(/\.pdf$/i, '');

function download(bytes, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

async function improve(force = false) {
  if (running) return;
  const doc = app().pdfDocument; if (!doc) return;
  const data = await doc.getData();
  if (improved && data.length === improved.length) return;           // zeigt bereits die verbesserte Fassung
  if (!force && await hasText(data)) return;                           // hat schon Text → nichts zu tun
  running = true; original = data;
  try {
    show('Gescannte Seiten erkannt – werden gerade ausgerichtet …', 0);
    const pages = await loadPages(data, title(), (t, f) => show(t, f));
    let straightened = 0;
    for (let i = 0; i < pages.length; i++) {
      show(`Richte gerade aus – Seite ${i + 1} von ${pages.length}`, (i + 1) / pages.length);
      await new Promise((r) => setTimeout(r, 0));
      pages[i].skew = Math.round(detectSkew(pages[i].canvas) * 10) / 10;
      if (pages[i].skew) straightened++;
    }
    const out = await buildPdf(pages, true, title(), (t, f) => show(t, f));
    improved = out;
    await app().open({ data: out.slice(0) });
    show(`Fertig: Text erkannt${straightened ? `, ${straightened} Seite${straightened === 1 ? '' : 'n'} gerade ausgerichtet` : ''} – jetzt durchsuchbar (Strg+F).`, null, [
      btn('Speichern', true, () => { download(improved, `${title()} (durchsuchbar).pdf`); show('Gespeichert neben dem Original', null, [btn('OK', false, hide)]); }),
      btn('Original anzeigen', false, async () => { await app().open({ data: original.slice(0) }); show('Original wird angezeigt', null, [btn('Verbesserte Fassung', true, async () => { await app().open({ data: improved.slice(0) }); hide(); }), btn('OK', false, hide)]); }),
      btn('✕', false, hide)
    ]);
  } catch (e) {
    show('Texterkennung nicht möglich: ' + (e && e.message ? e.message : e), null, [btn('OK', false, hide)]);
  } finally { running = false; }
}

// manuell: „Text erkennen & gerade ausrichten“ aus dem Browser-Menü
window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data === 'immo:improve') improve(true); });
window.__immoImprove = () => improve(true);

(async () => {
  await app().initializedPromise;
  app().eventBus.on('documentloaded', () => {
    const fp = app().pdfDocument && app().pdfDocument.fingerprints && app().pdfDocument.fingerprints[0];
    if (fp && fp === lastDocId) return;
    lastDocId = fp;
    setTimeout(() => improve(false).catch(() => {}), 400);
  });
})();
