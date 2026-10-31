/* Oberfläche des ImmoAdv Browsers (Tabs, Adressleiste, Seitenleiste). Kein Zugriff aufs System – nur über window.immo. */
'use strict';
const $ = (id) => document.getElementById(id);
const api = window.immo;
const C = window.ImmoCalc;

let state = { tabs: [], activeId: null };
let settings = {};
let torState = { status: 'off', progress: 0, message: '' };
let panel = null;           // 'immo' | 'bookmarks' | 'settings' | null
let overlayOpen = false;
let shownGoogleHint = false;
let frequent = [];
let dragIndex = null;
let update = { status: 'idle' };
let appVersion = '';
let updatePopDismissed = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (v, d = 0) => (v ?? 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %';
const activeTab = () => state.tabs.find((t) => t.id === state.activeId);

// ---------- Layout an den Hauptprozess melden (wo die Webseite liegt) ----------
function pushLayout() {
  const top = $('chrome').offsetHeight;
  $('content').style.top = top + 'px';
  $('panel').style.top = top + 'px';
  $('loadbar').style.top = (top - 3) + 'px';
  const t = activeTab();
  const hideWeb = overlayOpen || !!(t && t.error);
  api.layout({ top, right: panel ? 388 : 0, hidden: hideWeb });
  document.body.classList.toggle('panel-open', !!panel);
  document.body.classList.toggle('loading', !!(t && t.loading));
}
new ResizeObserver(pushLayout).observe($('chrome'));

// ---------- Tabs ----------
function renderTabs() {
  const box = $('tabs');
  box.innerHTML = '';
  for (const t of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === state.activeId ? ' active' : '');
    const label = t.kind === 'pdf' ? '📄 ' + (t.fileName || 'PDF') : (t.url ? t.title || t.url : 'Startseite');
    el.innerHTML = `${t.loading ? '<span class="spin"></span>' : ''}<span class="t">${esc(label)}</span><button class="x" title="Schließen">✕</button>`;
    el.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); api.closeTab(t.id); } });
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('x')) api.closeTab(t.id); else api.selectTab(t.id);
    });
    box.appendChild(el);
  }
}

function renderToolbar() {
  const t = activeTab();
  $('back').disabled = !t?.canGoBack;
  $('forward').disabled = !t?.canGoForward;
  $('reload').textContent = t?.loading ? '✕' : '↻';
  if (document.activeElement !== $('address')) {
    $('address').value = t?.kind === 'pdf' ? (t.fileName || '') : (t?.url ? hostOf(t.url) : '');
  }
  $('immoBtn').classList.toggle('hidden', !t?.listing);
  $('pdfSave').classList.toggle('hidden', t?.kind !== 'pdf');
  $('googleBtn').classList.toggle('hidden', !t?.googleBlocked);
  if (t?.googleBlocked && !shownGoogleHint) { shownGoogleHint = true; toast(settings.googleDirect ? 'Google lehnt diesen Browser ab – Anmeldung im Standard-Browser möglich' : 'Google sperrt die Anmeldung über Tor – in den Einstellungen „Google-Anmeldung ohne Tor“ erlauben oder im Standard-Browser anmelden'); }
  const marked = !!(t?.url && (settings.bookmarks || []).some((b) => b.url === t.url));
  $('bookmarkBtn').textContent = marked ? '★' : '☆';
  $('bookmarkBtn').disabled = !t?.url || t.kind === 'pdf';

  renderWait();
  const showStart = !t || (!t.url && t.kind !== 'pdf');
  $('start').classList.toggle('hidden', !showStart && !t?.error && !t?.waiting);
  $('errorBox').classList.toggle('hidden', !t?.error);
  $('errorBox').textContent = t?.error || '';
  if (panel === 'immo' && !t?.listing) closePanel();
  pushLayout();
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

// ---------- Tor-Status ----------
function renderTor() {
  const b = $('torBadge');
  b.className = '';
  let text;
  if (!settings.torEnabled) { b.classList.add('off'); text = 'Tor ist aus – Websites sehen deine IP-Adresse'; }
  else if (torState.status === 'connected') { b.classList.add('ok'); text = 'Sicher über Tor verbunden'; }
  else if (torState.status === 'failed') { b.classList.add('bad'); text = torState.message; }
  else text = `Tor verbindet … ${torState.progress || 0} %`;
  b.title = text;
  $('torText').textContent = !settings.torEnabled ? 'Tor aus' : torState.status === 'connected' ? 'Geschützt'
    : torState.status === 'failed' ? 'Fehler' : `Verbindet ${torState.progress || 0} %`;
  $('torPill').className = 'torpill ' + (b.className || '');
  $('startStatus').textContent = text;
  document.querySelector('.status-pill .dot').style.background = !settings.torEnabled ? '#9aa4b2' : torState.status === 'connected' ? '#2fe39a' : torState.status === 'failed' ? '#ff5d5d' : '#f5a524';
  renderWait();
  $('privTor').textContent = settings.torEnabled ? 'Alle Seiten laufen über Tor' : 'Tor ist aus – normaler Modus';
}

// ---------- Startseite ----------
function renderWait() {
  const t = activeTab();
  const on = !!t?.waiting;
  $('waitBox').classList.toggle('hidden', !on);
  if (!on) return;
  const p = torState.progress || 0;
  $('waitText').textContent = `${p} % – die Seite öffnet sich automatisch`;
  $('waitHost').textContent = t.url ? hostOf(t.url) : '';
  $('waitArc').style.strokeDashoffset = String(327 - 327 * p / 100);
}

// ---------- Lesezeichenleiste (ziehen zum Sortieren) ----------
function renderBookmarkBar() {
  const bar = $('bookmarkbar');
  bar.classList.toggle('hidden', settings.bookmarkBar === false);
  bar.innerHTML = '';
  const list = settings.bookmarks || [];
  list.forEach((b, i) => {
    const el = document.createElement('button');
    el.className = 'bm-chip';
    el.draggable = true;
    el.title = b.url;
    el.innerHTML = `<span class="ic">${esc(b.title.slice(0, 1).toUpperCase())}</span>${esc(b.title)}`;
    el.onclick = (e) => (e.ctrlKey || e.metaKey ? api.newTab(b.url) : api.navigate(b.url));
    el.onauxclick = (e) => { if (e.button === 1) api.newTab(b.url); };
    el.addEventListener('dragstart', (e) => { dragIndex = i; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => { dragIndex = null; el.classList.remove('dragging'); bar.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === i) return;
      const next = [...list];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(i, 0, moved);
      settings = await api.setSettings({ bookmarks: next });
      renderBookmarkBar(); renderFavorites();
    });
    bar.appendChild(el);
  });
  if (!list.length) bar.innerHTML = '<span class="hint">Mit ☆ Seiten hier ablegen – Reihenfolge per Ziehen ändern</span>';
}

function renderFrequent() {
  $('frequentWrap').classList.toggle('hidden', !frequent.length || settings.rememberFrequent === false);
  const box = $('frequent');
  box.innerHTML = '';
  for (const f of frequent) {
    const el = document.createElement('button');
    el.className = 'fav';
    let host = f.url; try { host = new URL(f.url).hostname.replace(/^www\./, ''); } catch {}
    el.innerHTML = `<span class="ic">${esc(host.slice(0, 1).toUpperCase())}</span><span>${esc(host)}</span>`;
    el.onclick = () => api.navigate(f.url);
    box.appendChild(el);
  }
}

// ---------- Suche auf der Seite ----------
function openFind() {
  $('findbar').classList.remove('hidden');
  $('findInput').focus(); $('findInput').select();
}
function closeFind() {
  $('findbar').classList.add('hidden'); $('findCount').textContent = '';
  api.findStop();
}
$('findInput').addEventListener('input', () => { const v = $('findInput').value; if (v) api.find(v, true, false); else { api.findStop(); $('findCount').textContent = ''; } });
$('findInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); api.find($('findInput').value, !e.shiftKey, true); }
  if (e.key === 'Escape') closeFind();
});
$('findNext').onclick = () => api.find($('findInput').value, true, true);
$('findPrev').onclick = () => api.find($('findInput').value, false, true);
$('findClose').onclick = closeFind;

function renderGreeting() {
  const h = new Date().getHours();
  $('greeting').textContent = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Guten Tag' : h < 22 ? 'Guten Abend' : 'Gute Nacht';
  $('today').textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

function renderFavorites() {
  const box = $('favorites');
  box.innerHTML = '';
  for (const b of settings.bookmarks || []) {
    const el = document.createElement('button');
    el.className = 'fav';
    el.innerHTML = `<span class="ic">${esc(b.title.slice(0, 1).toUpperCase())}</span><span>${esc(b.title)}</span>`;
    el.onclick = () => api.navigate(b.url);
    box.appendChild(el);
  }
}

// ---------- Seitenleiste ----------
function openPanel(kind) {
  panel = kind;
  $('panel').classList.remove('hidden');
  requestAnimationFrame(() => $('panel').classList.add('open'));
  ({ immo: renderImmo, bookmarks: renderBookmarks, settings: renderSettings })[kind]();
  pushLayout();
}
function closePanel() {
  panel = null; $('panel').classList.remove('open');
  setTimeout(() => { if (!panel) $('panel').classList.add('hidden'); }, 220);
  pushLayout();
}

// Immobilien-Check
function renderImmo() {
  const t = activeTab(); const l = t?.listing || {};
  $('panelTitle').textContent = 'Immobilien-Check';
  const isRent = l.isRent;
  const price = isRent ? 0 : C.parseGerman(l.price) || 0;
  const rent = C.parseGerman(isRent ? (l.rent || l.price) : l.rent) || 0;
  const land = C.landFromZip(l.zip) || 'Hessen';
  const opts = Object.keys(C.LAENDER).map((k) => `<option ${k === land ? 'selected' : ''} value="${esc(k)}">${esc(k)} (${C.LAENDER[k].toLocaleString('de-DE')} %)</option>`).join('');
  const field = (id, label, val, step = 'any') => `<div class="row"><span>${label}</span><input type="number" id="${id}" value="${val}" step="${step}" min="0"></div>`;
  $('panelBody').innerHTML = `
    <p><b>${esc(l.title || t?.title || 'Inserat')}</b><br><span class="hint">${esc([l.zip, l.city, l.source].filter(Boolean).join(' · '))}</span></p>
    <div class="group"><h3>Objekt</h3>
      ${field('iPrice', 'Kaufpreis (€)', price)}
      ${field('iArea', 'Wohnfläche (m²)', C.parseGerman(l.area) || 0)}
      ${field('iRent', 'Kaltmiete / Monat (€)', rent)}
      <div class="row"><span>Bundesland</span><select id="iLand">${opts}</select></div>
    </div>
    <div class="group"><h3>Finanzierung</h3>
      ${field('iEquity', 'Eigenkapital (€)', Math.round(price * 0.2))}
      ${field('iZins', 'Zins % p. a.', 3.6)}
      ${field('iTilg', 'Tilgung % p. a.', 2.0)}
      ${field('iMakler', 'Makler %', 3.57)}
      ${field('iNotar', 'Notar + Grundbuch %', 2.0)}
      ${field('iCosts', 'Nicht umlagef. Kosten / Monat (€)', 0)}
    </div>
    <div class="group" id="iResult"></div>
    <button class="primary" id="iSave">Als PDF speichern</button>
    <p class="hint">Unverbindliche Beispielrechnung, keine Finanzierungs- oder Steuerberatung. Alles wird nur auf diesem Computer berechnet.</p>`;
  $('panelBody').querySelectorAll('input,select').forEach((el) => el.addEventListener('input', updateImmo));
  $('iSave').onclick = saveImmo;
  updateImmo();
}

function immoInput() {
  const n = (id) => parseFloat($(id).value) || 0;
  return { price: n('iPrice'), area: n('iArea'), coldRent: n('iRent'), land: $('iLand').value, equity: n('iEquity'),
    zins: n('iZins'), tilgung: n('iTilg'), makler: n('iMakler'), notar: n('iNotar'), costs: n('iCosts') };
}

function resultRows(r) {
  const rows = [
    ['Grunderwerbsteuer', eur(r.grest)], ['Makler', eur(r.makler)], ['Notar + Grundbuch', eur(r.notar)],
    ['Kaufnebenkosten gesamt', eur(r.nebenkosten), true], ['Gesamtkosten', eur(r.total), true],
    ['Darlehen', eur(r.loan)], ['Monatsrate', eur(r.rate, 2), true], ['Restschuld nach 10 Jahren', eur(r.restschuld10)],
    ['Eigenkapitalquote', pct(r.ekQuote)]
  ];
  if (r.pricePerSqm) rows.push(['Preis pro m²', eur(r.pricePerSqm)]);
  if (r.brutto != null) rows.push(['Bruttomietrendite', pct(r.brutto)]);
  if (r.netto != null) rows.push(['Nettomietrendite', pct(r.netto)]);
  if (r.faktor != null) rows.push(['Kaufpreisfaktor', r.faktor.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + '-fach']);
  if (r.cashflow != null) rows.push(['Cashflow / Monat', eur(r.cashflow, 2), true, r.cashflow >= 0 ? 'pos' : 'neg']);
  return rows;
}

function updateImmo() {
  const r = C.calculate(immoInput());
  $('iResult').innerHTML = '<h3>Ergebnis</h3>' + resultRows(r).map(([k, v, bold, cls]) =>
    `<div class="row"><span>${k}</span>${bold ? `<b class="${cls || ''}">${v}</b>` : `<span>${v}</span>`}</div>`).join('');
}

async function saveImmo() {
  const t = activeTab(); const l = t?.listing || {};
  const i = immoInput(); const r = C.calculate(i);
  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const rows = resultRows(r).map(([k, v, b]) => `<tr><td>${k}</td><td style="text-align:right;${b ? 'font-weight:700' : ''}">${v}</td></tr>`).join('');
  const html = `<!doctype html><html lang="de"><meta charset="utf-8"><style>
    body{font-family:-apple-system,Segoe UI,Arial,sans-serif;margin:0;color:#0f1b2d}
    header{background:linear-gradient(120deg,#0B1F3A,#2A5BD7 58%,#19C2B0);color:#fff;padding:28px 40px}
    h1{margin:0;font-size:24px} main{padding:24px 40px} table{width:100%;border-collapse:collapse;font-size:13px}
    td{padding:7px 0;border-bottom:1px solid #e4e8ef} h2{color:#2A5BD7;font-size:15px;margin:22px 0 6px}
    footer{position:fixed;bottom:18px;left:40px;right:40px;font-size:9px;color:#888}</style>
    <header><h1>ImmoAdv · Immobilien-Check</h1><div>${esc(today)}</div></header><main>
    <p><b>${esc(l.title || t?.title || 'Inserat')}</b><br><small>${esc([l.zip, l.city, l.source].filter(Boolean).join(' · '))}</small></p>
    <h2>Eingaben</h2><table>
      <tr><td>Kaufpreis</td><td style="text-align:right">${eur(i.price)}</td></tr>
      <tr><td>Wohnfläche</td><td style="text-align:right">${i.area.toLocaleString('de-DE')} m²</td></tr>
      <tr><td>Kaltmiete / Monat</td><td style="text-align:right">${eur(i.coldRent, 2)}</td></tr>
      <tr><td>Bundesland</td><td style="text-align:right">${esc(i.land)} (${r.grestRate.toLocaleString('de-DE')} % GrESt)</td></tr>
      <tr><td>Eigenkapital</td><td style="text-align:right">${eur(i.equity)}</td></tr>
      <tr><td>Zins / Tilgung</td><td style="text-align:right">${pct(i.zins)} / ${pct(i.tilgung)}</td></tr>
    </table><h2>Ergebnis</h2><table>${rows}</table></main>
    <footer>Unverbindliche Beispielrechnung, keine Finanzierungs- oder Steuerberatung. immoadv.de</footer></html>`;
  const name = `Immobilien-Check ${new Date().toISOString().slice(0, 10)}.pdf`;
  try { const folder = await api.saveReport(html, name); toast(`In „${folder}“ gespeichert`); }
  catch { toast('Speichern fehlgeschlagen'); }
}

// Lesezeichen
function renderBookmarks() {
  $('panelTitle').textContent = 'Lesezeichen';
  const list = settings.bookmarks || [];
  $('panelBody').innerHTML = list.length ? list.map((b, i) =>
    `<div class="bm"><a data-i="${i}">${esc(b.title)}<small>${esc(hostOf(b.url))}</small></a><button class="icon danger" data-del="${i}" title="Entfernen">✕</button></div>`).join('')
    : '<p class="hint">Noch keine Lesezeichen. Mit ☆ in der Leiste hinzufügen.</p>';
  $('panelBody').querySelectorAll('a[data-i]').forEach((a) => a.onclick = () => api.navigate(list[+a.dataset.i].url));
  $('panelBody').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    const next = list.filter((_, i) => i !== +b.dataset.del);
    settings = await api.setSettings({ bookmarks: next });
    renderBookmarks(); renderFavorites(); renderBookmarkBar(); renderToolbar();
  });
}

// Einstellungen
function renderSettings() {
  $('panelTitle').textContent = 'Einstellungen';
  const sw = (key, label) => `<div class="row"><span>${label}</span><label class="switch"><input type="checkbox" data-key="${key}" ${settings[key] ? 'checked' : ''}><span></span></label></div>`;
  $('panelBody').innerHTML = `
    <div class="group"><h3>Anonymität</h3>
      <div class="row"><span>Status</span><span>${esc($('torBadge').title)}</span></div>
      ${sw('torEnabled', 'Nur über Tor surfen')}
      ${sw('useBridges', 'Tor tarnen (Snowflake-Brücken)')}
    </div>
    <button class="secondary" id="sIdentity">Neue Identität</button>
    <p class="hint">Mit Brücken sieht dein Internetanbieter nicht, dass du Tor nutzt. Änderungen an Tor gelten nach einem Neustart des Programms.</p>
    <div class="group"><h3>Sicherheit</h3>
      ${sw('blockTrackers', 'Tracker & Werbung blockieren')}
      ${sw('httpsOnly', 'Nur verschlüsselte Seiten (HTTPS)')}
      ${sw('javaScript', 'JavaScript (aus = höchste Sicherheit)')}
      ${state.platform === 'darwin' ? sw('appLock', 'Mit Touch ID sperren') : ''}
    </div>
    <div class="group"><h3>Updates</h3>
      <div class="row"><span>Version</span><b>${esc(appVersion)}</b></div>
      <div class="row"><span>Automatische Updates</span><label class="switch"><input type="checkbox" id="sAutoUp" ${settings.autoUpdate !== false ? 'checked' : ''}><span></span></label></div>
      <div class="row"><span>Status</span><span id="sUpStatus">${esc(updateText())}</span></div>
    </div>
    <button class="secondary" id="sUpBtn">${update.status === 'ready' ? 'Update jetzt starten' : update.status === 'available' ? 'Update laden' : 'Jetzt nach Updates suchen'}</button>
    <div class="group"><h3>Startseite & Leiste</h3>
      ${sw('bookmarkBar', 'Lesezeichenleiste anzeigen')}
      ${sw('rememberFrequent', 'Häufig besuchte Seiten merken (nur lokal)')}
    </div>
    <button class="secondary" id="sFreqClear">„Häufig besucht“ löschen</button>
    <div class="group"><h3>Google</h3>
      ${sw('googleDirect', 'Google-Anmeldung ohne Tor erlauben')}
    </div>
    <p class="hint">Google sperrt Anmeldungen über Tor fast immer. Ist das an, läuft nur die Google-Anmeldeseite direkt – Google sieht dabei deine echte IP-Adresse (weiß nach dem Login aber ohnehin, wer du bist). Alles andere bleibt über Tor. Gilt nach Neustart.</p>
    <div class="group"><h3>Downloads</h3>
      <div class="row"><span>Ordner</span><b id="sDir">${esc(state.downloadDirName || 'Downloads')}</b></div>
    </div>
    <button class="secondary" id="sChoose">Download-Ordner ändern</button>
    <button class="secondary" id="sOpenDir">Download-Ordner öffnen</button>
    <div class="group"><h3>Eigene Brücken (optional)</h3>
      <textarea id="sBridges" placeholder="Nur nötig, falls die eingebauten Brücken blockiert werden.">${esc(settings.customBridges || '')}</textarea>
      <p class="hint">Neue Zeilen gibt es auf bridges.torproject.org (Snowflake oder obfs4). Gilt nach Neustart.</p>
    </div>
    <button class="secondary danger" id="sClear">Alle Tabs und Website-Daten löschen</button>`;
  $('panelBody').querySelectorAll('input[data-key]').forEach((el) => el.onchange = async () => {
    settings = await api.setSettings({ [el.dataset.key]: el.checked });
    renderTor(); renderBookmarkBar(); renderFrequent();
    if (['torEnabled', 'useBridges', 'javaScript', 'googleDirect'].includes(el.dataset.key)) toast('Gilt nach Neustart des Programms');
  });
  $('sBridges').onchange = async () => { settings = await api.setSettings({ customBridges: $('sBridges').value }); toast('Gilt nach Neustart'); };
  $('sIdentity').onclick = () => api.newIdentity();
  $('sFreqClear').onclick = async () => { await api.clearFrequent(); frequent = []; renderFrequent(); toast('Liste gelöscht'); };
  $('sAutoUp').onchange = async () => { await api.setAutoUpdate($('sAutoUp').checked); settings.autoUpdate = $('sAutoUp').checked; };
  $('sUpBtn').onclick = () => (update.status === 'ready' ? api.installUpdate() : update.status === 'available' ? api.downloadUpdate() : api.checkUpdate());
  $('sChoose').onclick = async () => { const n = await api.chooseDownloadDir(); if (n) { state.downloadDirName = n; $('sDir').textContent = n; toast(`Downloads gehen jetzt nach „${n}“`); } };
  $('sOpenDir').onclick = () => api.openDownloadDir();
  $('sClear').onclick = () => api.clearAll();
}

// ---------- Updates ----------
function updateText() {
  return ({
    idle: 'Noch nicht geprüft', checking: 'Suche …', current: 'Aktuell',
    available: `Version ${update.version} verfügbar`, downloading: `Lädt Version ${update.version} … ${update.progress || 0} %`,
    ready: `Version ${update.version} bereit`, error: 'Prüfung fehlgeschlagen', unsupported: 'Über den Store bzw. nur in der installierten Version'
  })[update.status] || '';
}
function showUpdatePop() {
  $('upTitle').textContent = `Version ${update.version} ist bereit`;
  $('upNotes').textContent = update.notes || 'Verbesserungen und Fehlerbehebungen.';
  overlayOpen = true; $('updatePop').classList.remove('hidden'); pushLayout();
}
function hideUpdatePop() { overlayOpen = !$('onboarding').classList.contains('hidden'); $('updatePop').classList.add('hidden'); pushLayout(); }
$('upInstall').onclick = () => api.installUpdate();
$('upLater').onclick = () => { updatePopDismissed = update.version; hideUpdatePop(); };

// ---------- Hinweis-Pop-up ----------
let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.classList.remove('hidden');
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 250); }, 2400);
}

// ---------- Bedienelemente ----------
$('startSearch').addEventListener('submit', (e) => { e.preventDefault(); const v = $('startInput').value.trim(); if (v) { api.navigate(v); $('startInput').value = ''; } });
$('addressForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('address').value.trim(); if (v) { api.navigate(v); $('address').blur(); } });
$('address').addEventListener('focus', () => { const t = activeTab(); if (t?.url && t.kind !== 'pdf') $('address').value = t.url; $('address').select(); });
$('address').addEventListener('blur', renderToolbar);
$('back').onclick = () => api.nav('back');
$('forward').onclick = () => api.nav('forward');
$('reload').onclick = () => api.nav(activeTab()?.loading ? 'stop' : 'reload');
$('newtab').onclick = () => api.newTab();
$('menuBtn').onclick = () => api.menu();
$('immoBtn').onclick = () => (panel === 'immo' ? closePanel() : openPanel('immo'));
$('pdfSave').onclick = () => api.savePDF();
$('googleBtn').onclick = () => api.openExternal();
$('bookmarksPanelBtn').onclick = () => (panel === 'bookmarks' ? closePanel() : openPanel('bookmarks'));
$('panelClose').onclick = closePanel;
$('bookmarkBtn').onclick = async () => {
  const t = activeTab(); if (!t?.url) return;
  const list = settings.bookmarks || [];
  const exists = list.some((b) => b.url === t.url);
  settings = await api.setSettings({ bookmarks: exists ? list.filter((b) => b.url !== t.url) : [...list, { title: t.title || hostOf(t.url), url: t.url }] });
  toast(exists ? 'Lesezeichen entfernt' : 'Lesezeichen gesichert');
  renderFavorites(); renderBookmarkBar(); renderToolbar(); if (panel === 'bookmarks') renderBookmarks();
};
document.addEventListener('keydown', (e) => {
  const mod = state.platform === 'darwin' ? e.metaKey : e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 't' && e.shiftKey) { e.preventDefault(); api.reopenTab(); return; }
  if (k === 'b' && e.shiftKey) { e.preventDefault(); toggleBar(); return; }
  if (k === 'f') { e.preventDefault(); openFind(); return; }
  if (k === 't') { e.preventDefault(); api.newTab(); }
  if (k === 'l') { e.preventDefault(); $('address').focus(); }
  if (k === 'w') { e.preventDefault(); const t = activeTab(); if (t) api.closeTab(t.id); }
});

// Ersteinrichtung: Download-Ordner
function showOnboarding(show) {
  overlayOpen = show;
  $('onboarding').classList.toggle('hidden', !show);
  pushLayout();
}
$('obChoose').onclick = async () => { const n = await api.chooseDownloadDir(); if (n) { state.downloadDirName = n; showOnboarding(false); toast(`Downloads gehen nach „${n}“`); } };
$('obDefault').onclick = async () => { state.downloadDirName = await api.useDefaultDownloadDir(); showOnboarding(false); };

// ---------- Start ----------
api.onTabs((d) => { state.tabs = d.tabs; state.activeId = d.activeId; renderTabs(); renderToolbar(); });
api.onTor((s) => { torState = s; renderTor(); });
api.onToast(toast);
api.onFrequent((f) => { frequent = f; renderFrequent(); });
api.onFindOpen(openFind);
api.onFindResult((r) => { $('findCount').textContent = r.total ? `${r.active}/${r.total}` : 'Keine Treffer'; });
api.onToggleBookmarkBar(toggleBar);
async function toggleBar() { settings = await api.setSettings({ bookmarkBar: settings.bookmarkBar === false }); renderBookmarkBar(); }
api.onUpdate((u) => {
  update = u;
  if (panel === 'settings') renderSettings();
  if (u.status === 'ready' && updatePopDismissed !== u.version) showUpdatePop();
  if (u.status === 'available' && settings.autoUpdate === false) toast(`Version ${u.version} verfügbar – unter Einstellungen laden`);
});
api.onFocusAddress(() => $('address').focus());
api.onOpenPanel(openPanel);

(async () => {
  const s = await api.state();
  settings = s.settings; torState = s.tor; update = s.update || update; appVersion = s.version || ''; frequent = s.frequent || [];
  state.platform = s.platform; state.downloadDirName = s.downloadDirName;
  document.body.classList.add(s.platform === 'darwin' ? 'mac' : 'win');
  renderTor(); renderFavorites(); renderBookmarkBar(); renderFrequent(); renderGreeting(); renderToolbar();
  setInterval(renderGreeting, 60000);
  if (!s.settings.downloadDir) showOnboarding(true);
})();
