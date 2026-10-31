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
let ses = null;
let macManual = false;      // Mac ohne Apple-Signatur: Update als .dmg laden und öffnen (Squirrel braucht eine Signatur)
let macDmg = null;
let downloadDirFn = () => app.getPath('downloads');
const REPO = 'Feray20/immoadv-browser-desktop';

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

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking', message: 'Suche nach Updates …' }));
  autoUpdater.on('update-not-available', () => { failures = 0; emit({ status: 'current', message: 'Du hast die neueste Version.' }); });
  autoUpdater.on('update-available', (i) => { failures = 0; if (macManual) { emit({ status: 'available', version: i.version, notes: notesText(i.releaseNotes), progress: 0, message: `Version ${i.version} ist verfügbar.` }); if (store.get('autoUpdate')) downloadMac(); return; } emit({
    status: autoUpdater.autoDownload ? 'downloading' : 'available',
    version: i.version, notes: notesText(i.releaseNotes), progress: 0,
    message: `Version ${i.version} ist verfügbar.`
  }); });
  autoUpdater.on('download-progress', (p) => emit({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => emit({
    status: 'ready', version: i.version, notes: notesText(i.releaseNotes) || state.notes,
    message: `Version ${i.version} ist bereit.`
  }));
  // Fehler (z. B. langsame Tor-Route, Update gerade im Hochladen): leise erneut versuchen statt Fehlermeldung
  autoUpdater.on('error', (e) => {
    console.error('[update]', e && e.message);
    const wasDownloading = state.status === 'downloading';
    failures++;
    clearTimeout(retryTimer);
    const wait = Math.min(30, 2 * failures) * 60 * 1000;     // 2, 4, 6 … max. 30 Minuten
    retryTimer = setTimeout(() => (wasDownloading ? download() : check()), wait);
    if (failures >= 4) emit({ status: 'error', message: 'Update-Server gerade nicht erreichbar – wird automatisch erneut versucht.' });
    else emit({ status: wasDownloading ? 'available' : 'retry', message: 'Neuer Versuch in Kürze …' });
  });

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
  if (['downloading', 'ready'].includes(state.status)) return;
  autoUpdater.checkForUpdates().catch(() => {});
}

function download() {
  if (!supported()) return;
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

module.exports = { init, check, download, install, setAuto, state: () => ({ ...state, current: app.getVersion(), macManual }) };
