// Upload-Verlauf (Wunsch Feray 02.11.2026): Liste, Suche, Bewerbungsakten, Versionen, „Datei prüfen“, Export.
// Daten kommen vom ImmoAdv-Programm (gleicher Bestand auf allen Geräten über den verschlüsselten Sync).
const $ = (id) => document.getElementById(id);
const send = (m) => browser.runtime.sendMessage(m);
const U = self.ImmoUploads;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAGE = 200;
const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const STOP = new Set(['zeige', 'zeig', 'mir', 'mein', 'meine', 'meinen', 'meines', 'für', 'fuer', 'bei', 'alle', 'welche', 'welcher', 'welches', 'habe', 'hab', 'ich', 'hochgeladen', 'vom', 'von', 'im', 'in', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'finde', 'zuletzt', 'verwendet', 'uploads', 'upload', 'datei', 'dateien', 'version', 'auf', 'an', 'und', 'mit', '?']);

let items = [], myDevice = '', view = 'list', shown = PAGE, filtered = [];

function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2600); }
const fmtDate = (ms) => new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = (ms) => new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
const statusBadge = (s) => `<span class="badge ${s === 'TRANSFER_COMPLETED' || s === 'SERVER_ACKNOWLEDGED' ? 'ok' : s === 'FAILED' ? 'bad' : s === 'TRANSFER_STARTED' ? 'warn' : ''}">${esc(U.STATUS_DE[s] || s)}</span>`;
const typeBadge = (t) => (t && t !== 'Sonstiges' ? `<span class="badge type guess">${esc(t)}</span>` : '');
const devName = (r) => (r.device === myDevice ? 'dieses Gerät' : r.deviceName || (r.platform === 'ios' ? 'iPhone/iPad' : r.platform === 'mac' ? 'Mac' : 'Windows-PC'));
const placeOf = (r) => r.employer || r.portal || r.domain || 'Unbekannt';

// ---------- Laden ----------
async function load(sync) {
  $('syncLine').textContent = sync ? 'Gleicht mit deinen Geräten ab …' : '';
  const all = []; let offset = 0, meta = null;
  for (let i = 0; i < 100; i++) {
    const r = await send({ type: 'uploads:list', sync: sync && offset === 0, offset });
    if (!r || r.error) { $('syncLine').textContent = 'ImmoAdv-Programm nicht erreichbar' + (r && r.error ? ': ' + r.error : ''); break; }
    meta = r; all.push(...r.items); offset += r.items.length;
    if (!r.items.length || offset >= r.total) break;
  }
  items = all; myDevice = (meta && meta.device) || '';
  const s = meta && meta.sync;
  $('syncLine').textContent = !s ? '' : s.status === 'on' ? `Abgeglichen${s.lastSync ? ' · ' + fmtTime(s.lastSync) + ' Uhr' : ''}` : 'Sync aus – nur dieses Gerät (Einstellungen → Sync)';
  fillFilters(); render();
}

function fillFilters() {
  const keep = (id) => $(id).value;
  const opts = (id, first, pairs) => { const v = keep(id); $(id).innerHTML = `<option value="">${first}</option>` + pairs.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join(''); $(id).value = pairs.some(([k]) => k === v) ? v : ''; };
  opts('fStatus', 'Jeder Status', U.STATUS.filter((s) => items.some((r) => r.status === s)).map((s) => [s, U.STATUS_DE[s]]));
  opts('fType', 'Jeder Typ', U.DOC_TYPE_NAMES.filter((t) => items.some((r) => (r.docType || 'Sonstiges') === t)).map((t) => [t, t]));
  const devs = new Map(); for (const r of items) if (r.device && !devs.has(r.device)) devs.set(r.device, devName(r));
  opts('fDevice', 'Alle Geräte', [...devs]);
}

// ---------- Suche (auch Sätze wie „Lebenslauf für Roche“ oder „Uploads vom Oktober“) ----------
function haystack(r) {
  const d = new Date(r.at);
  return [r.name, r.employer, r.portal, r.domain, r.frame, r.title, r.sha256, r.docType, r.deviceName, U.STATUS_DE[r.status],
    fmtDay(r.at), MONTHS[d.getMonth()], String(d.getFullYear()), r.mime].join(' ').toLowerCase();
}
function matches(r, terms) {
  if (!terms.length) return true;
  const h = r._h || (r._h = haystack(r));
  return terms.every((t) => h.includes(t));
}
function terms() {
  return $('q').value.toLowerCase().replace(/[„“"',.!]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t))
    .map((t) => (t === 'bewerbungsunterlagen' ? 'bewerbung' : t === 'pdfs' ? 'pdf' : t));
}
function applyFilters() {
  const t = terms(), st = $('fStatus').value, ty = $('fType').value, dv = $('fDevice').value;
  return items.filter((r) => (!st || r.status === st) && (!ty || (r.docType || 'Sonstiges') === ty) && (!dv || r.device === dv) && matches(r, t));
}

// ---------- Ansichten ----------
// Nur ein Buchstaben-Symbol (Prüfung 02.11.2026): echte Favicons hätten beim Öffnen jede Bewerbungs-Domain angefragt –
// das verrät den Bewerbungsverlauf an diese Seiten.
function favicon(r) {
  return `<div class="fav">${esc((placeOf(r)[0] || '?').toUpperCase())}</div>`;
}
function itemHtml(r) {
  return `<div class="item" data-id="${esc(r.id)}">${favicon(r)}
    <div class="main">
      <div class="line1"><span class="name">${esc(r.name)}</span>${typeBadge(r.docType)}${statusBadge(r.status)}</div>
      <div class="line2">${esc(r.employer ? r.employer + ' · ' : '')}${esc(r.portal || r.domain)}${r.title ? ' – ' + esc(r.title) : ''}</div>
      <div class="line3">${fmtSize(r.size)}${r.pages ? ` · ${r.pages} Seiten` : ''} · ${esc(devName(r))}${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noreferrer">Seite öffnen</a>` : ''}</div>
      <div class="hash" title="SHA-256 – klicken zum Kopieren" data-h="${esc(r.sha256)}">${r.sha256 ? 'SHA-256 ' + esc(r.sha256) : 'Fingerabdruck nicht verfügbar (Datei war nicht lesbar)'}</div>
    </div>
    <div class="right"><span class="when">${fmtDate(r.at)} Uhr</span><button class="del" title="Eintrag löschen (auf allen Geräten)" aria-label="Eintrag löschen">✕</button></div></div>`;
}

function renderList() {
  const part = filtered.slice(0, shown);
  $('out').innerHTML = part.length ? part.map(itemHtml).join('') : `<div class="empty">${items.length ? 'Nichts gefunden.' : 'Noch keine Uploads. Sobald du auf einer Seite eine Datei zum Hochladen auswählst, steht sie hier – auf allen deinen Geräten.'}</div>`;
  $('more').classList.toggle('hidden', filtered.length <= shown);
}

// Bewerbungsakten: je Arbeitgeber (sicher aus der Adresse) bzw. Portal/Seite (Vorschlag)
function renderAkten() {
  const groups = new Map();
  for (const r of filtered) {
    const key = r.employer ? 'e:' + r.employer.toLowerCase() : 'd:' + (r.domain || r.portal || '?');
    if (!groups.has(key)) groups.set(key, { label: r.employer || r.portal || r.domain || 'Unbekannt', sure: !!r.employer, list: [] });
    groups.get(key).list.push(r);
  }
  const arr = [...groups.values()].sort((a, b) => b.list[0].at - a.list[0].at);
  $('out').innerHTML = arr.length ? arr.slice(0, shown).map((g) => {
    const docs = new Map(); for (const r of g.list) { const k = r.sha256 || r.id; if (!docs.has(k)) docs.set(k, r); }
    const portals = [...new Set(g.list.map((r) => r.portal).filter(Boolean))].join(', ');
    return `<div class="card"><h3>${esc(g.label)} ${g.sure ? '' : '<span class="badge warn">Zuordnung über die Seite – Vorschlag</span>'}</h3>
      <div class="sub">${g.list.length} Upload${g.list.length === 1 ? '' : 's'} · ${docs.size} Dokument${docs.size === 1 ? '' : 'e'}${portals ? ' · über ' + esc(portals) : ''} · zuletzt ${fmtDate(g.list[0].at)} Uhr</div>
      <div class="chips">${[...docs.values()].map((r) => `<span class="chip">${esc(r.name)}${r.docType && r.docType !== 'Sonstiges' ? ' · ' + esc(r.docType) : ''}</span>`).join('')}</div>
      <ul class="tl">${g.list.slice(0, 40).map((r) => `<li><span class="d">${fmtDate(r.at)} Uhr</span> · ${esc(r.name)} · ${esc(r.portal || r.domain)} · ${esc(U.STATUS_DE[r.status])}${r.sha256 ? ` · <span class="hash" data-h="${esc(r.sha256)}">${esc(r.sha256.slice(0, 12))}…</span>` : ''}</li>`).join('')}</ul></div>`;
  }).join('') : '<div class="empty">Noch keine Bewerbungsakten.</div>';
  $('more').classList.toggle('hidden', arr.length <= shown);
}

// Versionen: gleicher Dateiname (ohne Endung, Groß/klein egal) – je Fingerabdruck eine Version, chronologisch
function renderVersionen() {
  const norm = (n) => String(n || '').toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '').replace(/[\s_\-]+/g, ' ').replace(/\(\d+\)$/, '').trim();
  const groups = new Map();
  for (const r of filtered) { const k = norm(r.name); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const arr = [...groups.values()].map((list) => {
    const vers = new Map();
    for (const r of [...list].sort((a, b) => a.at - b.at)) { const k = r.sha256 || 'ohne:' + r.id; if (!vers.has(k)) vers.set(k, []); vers.get(k).push(r); }
    return { name: list[0].name, list, vers: [...vers.entries()] };
  }).sort((a, b) => b.vers.length - a.vers.length || b.list[0].at - a.list[0].at);
  $('out').innerHTML = arr.length ? arr.slice(0, shown).map((g) => `<div class="card"><h3>${esc(g.name)} <span class="badge">${g.vers.length} Version${g.vers.length === 1 ? '' : 'en'}</span> ${typeBadge(g.list[0].docType)}</h3>
    <div class="sub">${g.vers.length > 1 ? 'Gleicher Name, unterschiedlicher Inhalt (anderer Fingerabdruck).' : 'Immer dieselbe Fassung (gleicher Fingerabdruck).'}</div>
    <ul class="tl">${g.vers.map(([h, ups], i) => `<li><b>Version ${i + 1}</b>${i === g.vers.length - 1 && g.vers.length > 1 ? ' <span class="badge ok">neueste</span>' : ''} · ${fmtSize(ups[0].size)}${ups[0].pages ? ' · ' + ups[0].pages + ' Seiten' : ''}${h.startsWith('ohne:') ? '' : ` · <span class="hash" data-h="${esc(h)}">${esc(h.slice(0, 16))}…</span>`}
      <div class="d">${ups.map((r) => `${fmtDate(r.at)} Uhr bei ${esc(placeOf(r))}`).join(' · ')}</div></li>`).join('')}</ul></div>`).join('')
    : '<div class="empty">Noch keine Dateien.</div>';
  $('more').classList.toggle('hidden', arr.length <= shown);
}

function render() {
  filtered = applyFilters();
  $('count').textContent = items.length ? `${filtered.length.toLocaleString('de-DE')} von ${items.length.toLocaleString('de-DE')} Uploads` : '';
  ({ list: renderList, akten: renderAkten, versionen: renderVersionen })[view]();
}

// ---------- Datei prüfen (lokal) ----------
let pdfjs = null;
async function pdfInfo(file) {
  if (!/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name)) return null;
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const headTxt = String.fromCharCode(...head);
  const info = { pdf: headTxt.includes('%PDF-'), pages: null, encrypted: false, damaged: false, meta: {} };
  if (!info.pdf) { info.damaged = true; return info; }
  try {
    if (!pdfjs) { pdfjs = await import('/pdfjs/build/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/build/pdf.worker.mjs'; }
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    info.pages = doc.numPages;
    const md = await doc.getMetadata().catch(() => null);
    if (md && md.info) info.meta = { title: md.info.Title || '', author: md.info.Author || '', created: md.info.CreationDate || '', producer: md.info.Producer || '' };
    if (md && md.info && md.info.EncryptFilterName) info.encrypted = true;
    doc.destroy();
  } catch (e) {
    if (e && e.name === 'PasswordException') info.encrypted = true; else if (pdfjs) info.damaged = true; else info.unchecked = true;
  }
  return info;
}
function pdfDate(s) { const m = /D:(\d{4})(\d{2})(\d{2})/.exec(String(s)); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; }

async function check(files) {
  files = Array.from(files);
  const out = $('checkOut');
  out.innerHTML = '<div class="verdict">Prüfe … (lokal, die Datei verlässt dieses Gerät nicht)</div>';
  await load(true);   // erst den Stand aller Geräte holen
  out.innerHTML = '';
  for (const f of Array.from(files).slice(0, 20)) {
    const box = document.createElement('div'); box.className = 'verdict'; box.textContent = `${f.name}: Fingerabdruck wird berechnet …`; out.append(box);
    let hash = '';
    try { hash = await self.ImmoSha256.hashBlob(f); } catch (e) { box.className = 'verdict miss'; box.textContent = `${f.name}: Datei konnte nicht gelesen werden.`; continue; }
    const hits = items.filter((r) => r.sha256 === hash).sort((a, b) => a.at - b.at);
    const sameName = items.filter((r) => r.sha256 !== hash && r.name.toLowerCase() === f.name.toLowerCase());
    const info = await pdfInfo(f).catch(() => null);
    const health = [];
    if (info) {
      if (info.damaged) health.push('<span class="badge bad">PDF beschädigt oder nicht lesbar</span>');
      else if (info.encrypted) health.push('<span class="badge warn">Passwortgeschützt – manche Portale lehnen das ab</span>');
      else if (info.pages) health.push(`<span class="badge ok">PDF lesbar · ${info.pages} Seite${info.pages === 1 ? '' : 'n'}</span>`);
      if (info.meta && info.meta.author) health.push(`<span class="badge">Autor im PDF: ${esc(info.meta.author)}</span>`);
      if (info.meta && info.meta.created) health.push(`<span class="badge">Erstellt ${esc(pdfDate(info.meta.created))}</span>`);
    }
    if (f.size > 10 * 1048576) health.push(`<span class="badge warn">${fmtSize(f.size)} – viele Portale erlauben nur 5–10 MB</span>`);
    if (f.size === 0) health.push('<span class="badge bad">Datei ist leer</span>');
    const newer = sameName.filter((r) => hits.length === 0 || r.at > hits[hits.length - 1].at);
    if (newer.length) health.push(`<span class="badge warn">Unter diesem Namen hast du zuletzt eine andere Fassung hochgeladen (${fmtDay(newer[newer.length - 1].at)})</span>`);
    box.className = 'verdict ' + (hits.length ? 'hit' : 'miss');
    box.innerHTML = hits.length
      ? `<b class="t">✓ ${esc(f.name)} – ${hits.length === 1 ? 'einmal' : hits.length + '×'} hochgeladen</b>
         <ul>${hits.map((r) => `<li>${fmtDate(r.at)} Uhr bei <b>${esc(placeOf(r))}</b>${r.employer && r.portal ? ' über ' + esc(r.portal) : ''}${r.title ? ' – ' + esc(r.title) : ''} · ${esc(devName(r))} · ${esc(U.STATUS_DE[r.status])}</li>`).join('')}</ul>
         <div class="hash" data-h="${hash}">SHA-256 ${hash}</div><div class="health">${health.join('')}</div>`
      : `<b class="t">${esc(f.name)}: Diese Dateiversion wurde in deinem gespeicherten Upload-Verlauf nicht gefunden.</b>
         ${sameName.length ? `<div class="hint">Unter demselben Namen gibt es ${sameName.length} Upload${sameName.length === 1 ? '' : 's'} mit anderem Inhalt – zuletzt ${fmtDate(sameName[sameName.length - 1].at)} Uhr bei ${esc(placeOf(sameName[sameName.length - 1]))}.</div>` : ''}
         <div class="hash" data-h="${hash}">SHA-256 ${hash}</div><div class="health">${health.join('')}</div>`;
  }
}

// ---------- Export ----------
function csv() {
  const cols = [['Datum', (r) => fmtDay(r.at)], ['Uhrzeit', (r) => fmtTime(r.at)], ['Datei', (r) => r.name], ['Dokumenttyp (vermutet)', (r) => r.docType || ''], ['Größe (Byte)', (r) => r.size],
    ['SHA-256', (r) => r.sha256], ['Arbeitgeber', (r) => r.employer], ['Portal', (r) => r.portal], ['Domain', (r) => r.domain], ['Seitentitel', (r) => r.title], ['Adresse', (r) => r.url],
    ['Gerät', (r) => r.deviceName], ['Status', (r) => U.STATUS_DE[r.status] || r.status], ['Zeitzone', (r) => r.tz]];
  const cell = (v) => { const s = String(v == null ? '' : v); return /[";\n\r]|^[=+\-@]/.test(s) ? '"' + s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : s; };
  const text = '﻿' + [cols.map((c) => c[0]).join(';'), ...filtered.map((r) => cols.map((c) => cell(c[1](r))).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  browser.downloads.download({ url, filename: `Upload-Verlauf ${new Date().toISOString().slice(0, 10)}.csv`, saveAs: true }).catch(() => {}).finally(() => setTimeout(() => URL.revokeObjectURL(url), 60000));
}

// ---------- Bedienung ----------
$('views').querySelectorAll('button').forEach((b) => { b.onclick = () => { view = b.dataset.v; shown = PAGE; $('views').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); render(); }; });
let qT = 0;
$('q').oninput = () => { clearTimeout(qT); qT = setTimeout(() => { shown = PAGE; render(); }, 120); };
for (const id of ['fStatus', 'fType', 'fDevice']) $(id).onchange = () => { shown = PAGE; render(); };
$('more').onclick = () => { shown += PAGE; render(); };
$('csv').onclick = csv;
// PDF: unter Windows direkt speichern; am Mac kennt Firefox „Als PDF speichern“ für Erweiterungen nicht – dort öffnet sich
// der Druckdialog (unten links „PDF“ → „Als PDF sichern“).
$('pdf').onclick = async () => {
  shown = Infinity; render();
  const os = (await browser.runtime.getPlatformInfo().catch(() => ({}))).os;
  let r = 'print';
  if (os !== 'mac') r = await send({ type: 'uploads:pdf', fileName: `Upload-Verlauf ${new Date().toISOString().slice(0, 10)}.pdf` });
  if (r === 'canceled') toast('Abgebrochen');
  else if (r !== 'saved' && r !== 'replaced') window.print();
  shown = PAGE; render();
};
$('out').addEventListener('click', async (e) => {
  const h = e.target.closest('.hash[data-h]');
  if (h && h.dataset.h) { await navigator.clipboard.writeText(h.dataset.h).catch(() => {}); toast('Fingerabdruck kopiert'); return; }
  const d = e.target.closest('.del');
  if (d) {
    const id = d.closest('.item').dataset.id;
    // Ein Klick löscht sofort (Feray: Löschen ohne Rückfrage) – auf allen Geräten
    const r = await send({ type: 'uploads:delete', ids: [id] });
    if (r && r.error) return toast('Löschen nicht möglich: ' + r.error);
    items = items.filter((x) => x.id !== id); fillFilters(); render(); toast('Gelöscht – auch auf deinen anderen Geräten');
  }
});
$('checkOut').addEventListener('click', async (e) => { const h = e.target.closest('.hash[data-h]'); if (h) { await navigator.clipboard.writeText(h.dataset.h).catch(() => {}); toast('Fingerabdruck kopiert'); } });
$('pick').onchange = (e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) check(f); };   // Liste vorher kopieren (Zurücksetzen leert sie)
const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); const f = Array.from(e.dataTransfer.files || []); if (f.length) check(f); });
// Ganze Seite: abgelegte Dateien prüfen statt öffnen
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { if (!drop.contains(e.target)) { e.preventDefault(); const f = Array.from(e.dataTransfer.files || []); if (f.length) check(f); } });

// Neues von diesem oder einem anderen Gerät → sofort neu zeichnen
let reT = 0;
browser.runtime.onMessage.addListener((m) => { if (m && m.type === 'uploads') { clearTimeout(reT); reT = setTimeout(() => load(false), 300); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
load(true);
