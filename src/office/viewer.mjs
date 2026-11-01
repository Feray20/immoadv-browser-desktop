// Word-, Excel-, PowerPoint- und Bild-Anzeige im ImmoAdv Browser (01.11.2026). Läuft in der abgeschotteten
// Dokument-Sitzung ohne Internet; die Datei kommt nur über die einmalige Kennung vom Programm. Nur anzeigen und drucken.
import { readDocx, readXlsx, readPptx, readCsv } from './ooxml.mjs';
import { showImage } from './image.mjs';
import { loadBytes } from './fileload.mjs';

const q = new URLSearchParams(location.search);
const token = q.get('file') || '', name = q.get('name') || 'Dokument';
const ext = (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] || '').toLowerCase();
const out = document.getElementById('out');
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
document.title = name;
document.getElementById('name').textContent = name;
document.getElementById('print').onclick = () => print();
const sub = (t) => { document.getElementById('sub').textContent = t; };
const fail = (t, d) => { out.innerHTML = `<div class="err"><b>${esc(t)}</b>${esc(d || '')}</div>`; };

async function bytes() {
  return new Blob([await loadBytes(q)]);
}

const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const refRC = (ref) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) return null; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return [Number(m[2]) - 1, c - 1]; };
const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 10 }) : String(v ?? ''));

function sheetHtml(sh) {
  let maxR = 0, maxC = 0; const grid = new Map();
  for (const [ref, cell] of Object.entries(sh.cells || {})) { const rc = refRC(ref); if (!rc) continue; const [r, c] = rc; if (r > 3000 || c > 200) continue; maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); grid.set(`${r}:${c}`, cell); }
  let h = '<table><thead><tr><th class="rn"></th>';
  for (let c = 0; c <= maxC; c++) h += `<th style="${sh.widths?.[c] ? `min-width:${sh.widths[c]}px` : ''}">${colName(c)}</th>`;
  h += '</tr></thead><tbody>';
  for (let r = 0; r <= maxR; r++) {
    h += `<tr><td class="rn">${r + 1}</td>`;
    for (let c = 0; c <= maxC; c++) {
      const cell = grid.get(`${r}:${c}`); const shown = cell ? (cell.c !== undefined ? cell.c : cell.v) : '';
      const val = typeof shown === 'string' && shown.startsWith('=') ? '' : shown;
      const eur = cell?.s?.fmt === 'eur' && typeof val === 'number';
      h += `<td class="${typeof val === 'number' ? 'num' : ''}"${cell?.s?.b ? ' style="font-weight:700"' : ''}>${esc(eur ? val.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : fmt(val))}</td>`;
    }
    h += '</tr>';
  }
  return `<div class="sheet">${h}</tbody></table></div>`;
}

function showSheets(sheets) {
  const tabs = document.getElementById('tabs');
  const pick = (i) => { out.innerHTML = sheetHtml(sheets[i]); tabs.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(i === j))); };
  if (sheets.length > 1) { tabs.innerHTML = sheets.map((s) => `<button type="button">${esc(s.name)}</button>`).join(''); tabs.querySelectorAll('button').forEach((b, i) => { b.onclick = () => pick(i); }); }
  sub(`${sheets.length} Tabellenblatt${sheets.length === 1 ? '' : 'er'}`);
  pick(0);
}

function showSlides(m) {
  const W = Math.min(960, out.clientWidth - 32 || 960), k = W / m.w;
  out.innerHTML = `<div class="slides">${m.slides.map((s) => `<div class="slide" style="width:${m.w}px;height:${m.h}px;background:${esc(s.bg)};transform:scale(${k});margin-bottom:${-(m.h * (1 - k))}px;margin-right:${-(m.w * (1 - k))}px">${s.items.map((it) => {
    const box = `left:${it.x | 0}px;top:${it.y | 0}px;width:${it.w | 0}px;height:${it.h | 0}px`;
    if (it.t === 'img') return `<img alt="" src="${esc(it.src)}" style="${box}">`;
    if (it.t === 'rect') return `<div style="${box};background:${esc(it.fill)}"></div>`;
    if (it.t === 'table') return `<div class="tx" style="${box};font-size:14px">${(it.rows || []).map((r) => `<div>${esc(r)}</div>`).join('')}</div>`;
    return `<div class="tx" style="${box};font-size:${Number(it.size) || 18}px;color:${esc(it.color)};${it.bold ? 'font-weight:700;' : ''}text-align:${esc(it.align)};${it.fill ? `background:${esc(it.fill)};` : ''}">${it.html || ''}</div>`;
  }).join('')}</div>`).join('')}</div>`;
  sub(`${m.slides.length} Folie${m.slides.length === 1 ? '' : 'n'}`);
}

(async () => {
  try {
    const blob = await bytes();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
      // Gleiche Vorschau wie früher in der ImmoAdv-Software: eigene Leiste statt der Dokument-Leiste (01.11.2026).
      document.body.classList.add('pv-mode');
      showImage(out, { blob, name, ext, token }); return;
    }
    if (ext === 'docx') { out.innerHTML = `<article class="page">${await readDocx(blob)}</article>`; sub('Word-Dokument'); return; }
    if (ext === 'xlsx') { showSheets(await readXlsx(blob)); return; }
    if (ext === 'csv') { showSheets(readCsv(await blob.text())); return; }
    if (ext === 'pptx') { showSlides(await readPptx(blob)); return; }
    if (['doc', 'xls', 'ppt'].includes(ext)) return fail('Altes Office-Format', `„.${ext}“ (vor 2007) kann der Browser nicht anzeigen. In Word/Excel/PowerPoint öffnen und als .${ext}x speichern – dann geht es hier.`);
    fail('Dateityp wird nicht unterstützt', name);
  } catch (e) { fail('Datei konnte nicht geöffnet werden', String(e?.message || e)); }
})();
