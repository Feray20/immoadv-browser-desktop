// PDF-Studio: Seiten drehen/löschen/sortieren/anhängen, schiefe Scans automatisch gerade ausrichten,
// Texterkennung (OCR, Deutsch + Englisch) → durchsuchbare PDF. Läuft komplett offline in der abgeschotteten PDF-Sitzung.
import { loadPages, finalCanvas, detectSkew, buildPdf } from './core.mjs';
import { loadBytes } from './fileload.mjs';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const pages = [];          // { id, canvas, rot, skew, src: { doc, index } | null, sel }
let dragId = null, busy = false;

function status(text, frac) {
  $('status').innerHTML = '';
  $('status').append(document.createTextNode(text));
  if (frac != null) { const b = document.createElement('div'); b.className = 'bar2'; b.innerHTML = `<i style="width:${Math.round(frac * 100)}%"></i>`; $('status').append(b); }
}
function setBusy(b) { busy = b; for (const id of ['add', 'rotL', 'rotR', 'del', 'straight', 'save']) $(id).disabled = b; }

// ---------- Laden ----------
async function addFile(bytes, name) { pages.push(...await loadPages(bytes, name, status)); }

// ---------- Anzeige ----------
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
async function save() {
  if (!pages.length) return;
  setBusy(true);
  try {
    const bytes = await buildPdf(pages, $('ocr').checked, params.get('name') || 'ImmoAdv', status);
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
    if (!params.get('file') && !params.get('src')) { setBusy(false); render(); status('PDF oder Bild mit „＋ Hinzufügen“ öffnen'); return; }
    const name = params.get('name') || (params.get('src') || '').split('/').pop().split('?')[0] || 'Dokument';
    if (!params.get('name')) params.set('name', decodeURIComponent(name));
    await addFile(await loadBytes(params), params.get('name'));
    setBusy(false); render();
    // Eingescannte Seiten (ohne Text) gleich gerade ausrichten
    if (params.get('auto') === '1') straighten(pages);
  } catch (e) { setBusy(false); status('Konnte die Datei nicht öffnen: ' + e.message); }
})();

