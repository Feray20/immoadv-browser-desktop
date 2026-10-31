// Automatische Updates wie bei echter Software:
// sucht beim Start und alle 4 Stunden nach einer neuen Version (über Tor, wenn Tor an ist),
// lädt sie im Hintergrund und zeigt ein Pop-up mit den Neuerungen.
// Store-Version (Microsoft Store) wird vom Store aktualisiert – dort ist das hier aus.
const { app, session } = require('electron');
const store = require('./store');

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* nur im Entwicklungsmodus ohne Paket */ }

const state = { status: 'idle', version: null, notes: '', progress: 0, message: '' };
let notify = () => {};
let timer = null;

const supported = () => !!autoUpdater && app.isPackaged && !process.windowsStore;

function emit(patch) { Object.assign(state, patch); notify({ ...state }); }

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
function init({ onState, torOn, whenTorReady }) {
  notify = onState;
  if (!supported()) { emit({ status: 'unsupported' }); return; }

  // Sitzung, die electron-updater für seine Abfragen nutzt – bekommt den Tor-Proxy, damit auch das nicht direkt rausgeht
  let ses = null;
  try { ses = autoUpdater.netSession; } catch { /* ältere Versionen */ }
  if (!ses) ses = session.fromPartition('electron-updater', { cache: false });

  autoUpdater.autoDownload = !!store.get('autoUpdate');
  autoUpdater.autoInstallOnAppQuit = !!store.get('autoUpdate');
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking', message: 'Suche nach Updates …' }));
  autoUpdater.on('update-not-available', () => emit({ status: 'current', message: 'Du hast die neueste Version.' }));
  autoUpdater.on('update-available', (i) => emit({
    status: autoUpdater.autoDownload ? 'downloading' : 'available',
    version: i.version, notes: notesText(i.releaseNotes), progress: 0,
    message: `Version ${i.version} ist verfügbar.`
  }));
  autoUpdater.on('download-progress', (p) => emit({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => emit({
    status: 'ready', version: i.version, notes: notesText(i.releaseNotes) || state.notes,
    message: `Version ${i.version} ist bereit.`
  }));
  autoUpdater.on('error', () => emit({ status: 'error', message: 'Update-Prüfung fehlgeschlagen – nächster Versuch später.' }));

  const start = async (port) => {
    if (torOn) await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
    check();
    clearInterval(timer);
    timer = setInterval(check, 4 * 60 * 60 * 1000);
  };
  if (torOn) whenTorReady(start); else start(0);
}

function check() {
  if (!supported()) return;
  autoUpdater.checkForUpdates().catch(() => {});
}

function download() { if (supported()) autoUpdater.downloadUpdate().catch(() => {}); }

/** Jetzt neu starten und installieren */
function install() { if (supported() && state.status === 'ready') autoUpdater.quitAndInstall(false, true); }

function setAuto(on) {
  store.set('autoUpdate', !!on);
  if (supported()) { autoUpdater.autoDownload = !!on; autoUpdater.autoInstallOnAppQuit = !!on; }
}

module.exports = { init, check, download, install, setAuto, state: () => ({ ...state, version: state.version, current: app.getVersion() }) };
