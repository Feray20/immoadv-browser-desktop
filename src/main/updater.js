// Automatische Updates wie bei echter Software:
// sucht beim Start und alle 4 Stunden nach einer neuen Version (über Tor, wenn Tor an ist),
// lädt sie im Hintergrund und zeigt ein Pop-up mit den Neuerungen.
// Store-Version (Microsoft Store) wird vom Store aktualisiert – dort ist das hier aus.
const { app, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const store = require('./store');

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* nur im Entwicklungsmodus ohne Paket */ }

const state = { status: 'idle', version: null, notes: '', progress: 0, message: '' };
let notify = () => {};
let timer = null;
let retryTimer = null;
let failures = 0;
let installWanted = false;
let ses = null;
let macManual = false;      // Mac ohne Apple-Signatur: Update als .dmg laden und öffnen (Squirrel braucht eine Signatur)
let macDmg = null;
let downloadDirFn = () => app.getPath('downloads');
const REPO = 'Feray20/immoadv-browser-desktop';
let torPort = 0;
let viaTor = false;
let usingDirect = false;
// Update-Server – nur diese dürfen im Notfall ohne Tor erreicht werden (siehe main.js host-resolver-rules)
const UPDATE_HOSTS = ['github.com', 'api.github.com', '*.githubusercontent.com'];

// Kleines Protokoll in den App-Daten, damit Update-Probleme nachvollziehbar sind (enthält keine Surf-Daten)
function log(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'update.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 200 * 1024) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* egal */ }
}
function reason(e) {
  const m = String((e && (e.message || e)) || '');
  if (/ERR_PROXY|SOCKS|ERR_TUNNEL|ERR_CONNECTION|ERR_TIMED_OUT|ETIMEDOUT|ECONNRESET|net::ERR_NAME/i.test(m)) return 'Verbindung zum Update-Server fehlgeschlagen';
  if (/\b(429|403)\b/.test(m)) return 'Update-Server hat die Tor-Adresse kurz gesperrt';
  if (/\b404\b/.test(m)) return 'Update-Dateien noch nicht vollständig';
  if (/sha512|checksum/i.test(m)) return 'Download beschädigt – wird neu geladen';
  return 'Unbekannter Fehler';
}
async function setRoute(direct) {
  usingDirect = direct;
  if (!viaTor) return;
  await ses.setProxy(direct ? { mode: 'direct' } : { proxyRules: `socks5://127.0.0.1:${torPort}`, proxyBypassRules: '<-loopback>' });
  try { await ses.closeAllConnections(); } catch {}
}

function macSigned() {
  return new Promise((resolve) => {
    const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
    execFile('codesign', ['-dv', bundle], (_err, _out, err) => resolve(/Authority=Developer ID Application/.test(String(err || ''))));
  });
}

const supported = () => !!autoUpdater && app.isPackaged && !process.windowsStore;

function emit(patch) { Object.assign(state, patch); notify({ ...state, macManual }); }

function notesText(n) {
  if (!n) return '';
  const list = Array.isArray(n) ? n.map((x) => x.note || '').join('\n') : String(n);
  return list.replace(/<[^>]+>/g, '').trim();   // nur Text, kein HTML
}

/**
 * @param {object} o
 * @param {(s:object)=>void} o.onState  – meldet den Status ans Fenster
 * @param {boolean} o.torOn             – Update-Abfragen ebenfalls über Tor
 * @param {(cb:(port:number)=>void)=>void} o.whenTorReady
 */
async function init({ onState, torOn, whenTorReady, downloadDir }) {
  notify = onState;
  if (downloadDir) downloadDirFn = downloadDir;
  if (!supported()) { emit({ status: 'unsupported' }); return; }
  if (process.platform === 'darwin') macManual = !(await macSigned());

  // Sitzung, die electron-updater für seine Abfragen nutzt – bekommt den Tor-Proxy, damit auch das nicht direkt rausgeht
  try { ses = autoUpdater.netSession; } catch { /* ältere Versionen */ }
  if (!ses) ses = session.fromPartition('electron-updater', { cache: false });

  autoUpdater.autoDownload = !macManual && !!store.get('autoUpdate');
  autoUpdater.autoInstallOnAppQuit = !macManual && !!store.get('autoUpdate');
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = { info: (m) => log('info ' + m), warn: (m) => log('warn ' + m), error: (m) => log('error ' + m), debug: () => {} };

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking', message: 'Suche nach Updates …' }));
  autoUpdater.on('update-not-available', () => { failures = 0; if (usingDirect) setRoute(false); emit({ status: 'current', message: 'Du hast die neueste Version.' }); });
  autoUpdater.on('update-available', (i) => { failures = 0; if (macManual) { emit({ status: 'available', version: i.version, notes: notesText(i.releaseNotes), progress: 0, message: `Version ${i.version} ist verfügbar.` }); if (store.get('autoUpdate')) downloadMac(); return; } emit({
    status: autoUpdater.autoDownload ? 'downloading' : 'available',
    version: i.version, notes: notesText(i.releaseNotes), progress: 0,
    message: `Version ${i.version} ist verfügbar.`
  }); });
  autoUpdater.on('download-progress', (p) => emit({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => { failures = 0; if (usingDirect) setRoute(false); emit({
    status: 'ready', version: i.version, notes: notesText(i.releaseNotes) || state.notes,
    message: `Version ${i.version} ist bereit.`
  }); });
  // Fehler (z. B. langsame Tor-Route, Update gerade im Hochladen): leise erneut versuchen statt Fehlermeldung
  autoUpdater.on('error', (e) => {
    log(`Fehler (${usingDirect ? 'direkt' : viaTor ? 'Tor' : 'ohne Tor'}): ${e && (e.stack || e.message)}`);
    const wasDownloading = state.status === 'downloading';
    failures++;
    clearTimeout(retryTimer);
    // Über Tor sperrt GitHub manchmal Adressen. Nach 2 Fehlschlägen wird NUR das Update direkt geladen
    // (GitHub sieht dann deine IP beim Update-Download – Surfen bleibt über Tor). Abschaltbar in den Einstellungen.
    const fallback = viaTor && !usingDirect && failures >= 2 && store.get('updateFallback') !== false;
    const wait = fallback ? 3000 : failures === 1 ? 20000 : Math.min(30, 2 * failures) * 60 * 1000;
    const go = async () => { if (fallback) await setRoute(true); wasDownloading || installWanted ? download() : check(); };
    retryTimer = setTimeout(go, wait);
    emit({ status: wasDownloading ? 'available' : (failures >= 4 ? 'error' : 'retry'),
      message: `${reason(e)} – ${fallback ? 'neuer Versuch auf direktem Weg …' : 'neuer Versuch in Kürze …'}` });
  });

  const start = async (port) => {
    viaTor = torOn; torPort = port;
    if (torOn) await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
    log(`Start ${app.getVersion()} – Abfrage ${torOn ? 'über Tor' : 'direkt'}`);
    check();
    clearInterval(timer);
    timer = setInterval(check, 4 * 60 * 60 * 1000);
  };
  if (torOn) whenTorReady(start); else start(0);
}

function check(force) {
  if (!supported()) return;
  if (!force && ['downloading', 'ready'].includes(state.status)) return;
  autoUpdater.checkForUpdates().catch(() => {});
}

function download() {
  if (!supported()) return;
  installWanted = true;
  // falls noch keine Version bekannt ist (z. B. nach Fehler beim Prüfen): erst prüfen, dann lädt autoDownload
  if (!state.version || ['retry', 'error', 'idle', 'current'].includes(state.status)) { autoUpdater.autoDownload = !macManual; return check(true); }
  if (macManual) return downloadMac();
  emit({ status: 'downloading', progress: state.progress || 0 });
  autoUpdater.downloadUpdate().catch(() => {});
}

// Mac ohne Signatur: .dmg über dieselbe (Tor-)Sitzung in den Download-Ordner laden
function downloadMac() {
  if (!state.version || state.status === 'downloading') return;
  const v = state.version;
  const url = `https://github.com/${REPO}/releases/download/v${v}/ImmoAdv-Browser-${v}.dmg`;
  const target = path.join(downloadDirFn(), `ImmoAdv-Browser-${v}.dmg`);
  if (fs.existsSync(target) && fs.statSync(target).size > 10 * 1024 * 1024) { macDmg = target; return emit({ status: 'ready', message: `Version ${v} ist bereit.` }); }
  emit({ status: 'downloading', progress: 0 });
  ses.once('will-download', (_e, item) => {
    item.setSavePath(target + '.part');
    item.on('updated', () => { const t = item.getTotalBytes(); if (t) emit({ status: 'downloading', progress: Math.round(item.getReceivedBytes() / t * 100) }); });
    item.once('done', (_e2, st) => {
      if (st === 'completed') {
        try { fs.renameSync(target + '.part', target); macDmg = target; emit({ status: 'ready', message: `Version ${v} ist bereit.` }); return; } catch { /* fällt unten durch */ }
      }
      try { fs.unlinkSync(target + '.part'); } catch {}
      failures++;
      emit({ status: 'available', message: 'Download unterbrochen – bitte noch einmal tippen.' });
    });
  });
  ses.downloadURL(url);
}

/** Jetzt neu starten und installieren */
function install() {
  if (!supported() || state.status !== 'ready') return;
  if (macManual) {
    // Mac: Installationsfenster öffnen, App beenden – dann ImmoAdv Browser in „Programme“ ziehen
    if (macDmg) shell.openPath(macDmg).then(() => setTimeout(() => app.quit(), 1500));
    return;
  }
  setImmediate(() => autoUpdater.quitAndInstall(true, true));   // still installieren und sofort neu starten
}

function setAuto(on) {
  store.set('autoUpdate', !!on);
  if (supported() && !macManual) { autoUpdater.autoDownload = !!on; autoUpdater.autoInstallOnAppQuit = !!on; }
}

module.exports = { UPDATE_HOSTS, logPath: () => path.join(app.getPath('userData'), 'update.log'), init, check, download, install, setAuto, state: () => ({ ...state, current: app.getVersion(), macManual }) };
