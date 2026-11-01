// Updates des ImmoAdv-Programms (inkl. ImmoAdv-Schicht für Chrome) – Chrome selbst aktualisiert Google.
// Sucht bei jedem Start, lädt im Hintergrund und installiert still (Windows) bzw. per Knopf.
const { app, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const store = require('./store');

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* Entwicklungsmodus */ }

const REPO = 'Feray20/immoadv-browser-desktop';
const state = { status: 'idle', version: null, notes: '', progress: 0, message: '' };
let listeners = [];
let macManual = false;     // Mac ohne Apple-Signatur: .dmg laden und öffnen (Squirrel braucht eine Signatur)
let macDmg = null;
let failures = 0;
let retryTimer = null;

function log(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'update.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 200 * 1024) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* egal */ }
}
const supported = () => !!autoUpdater && app.isPackaged && !process.windowsStore;
function emit(patch) { Object.assign(state, patch); const s = snapshot(); listeners.forEach((l) => l(s)); }
const snapshot = () => ({ ...state, current: app.getVersion(), macManual });
const notesText = (n) => (!n ? '' : (Array.isArray(n) ? n.map((x) => x.note || '').join('\n') : String(n)).replace(/<[^>]+>/g, '').trim());

function macSigned() {
  return new Promise((resolve) => {
    const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
    execFile('codesign', ['-dv', bundle], (_e, _o, err) => resolve(/Authority=Developer ID Application/.test(String(err || ''))));
  });
}

async function init(onState) {
  if (onState) listeners.push(onState);
  if (!supported()) { emit({ status: 'unsupported', message: 'Updates nur in der installierten Version' }); return; }
  if (process.platform === 'darwin') macManual = !(await macSigned());
  autoUpdater.autoDownload = !macManual && store.get('autoUpdate') !== false;
  autoUpdater.autoInstallOnAppQuit = !macManual && store.get('autoUpdate') !== false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = { info: (m) => log('info ' + m), warn: (m) => log('warn ' + m), error: (m) => log('error ' + m), debug: () => {} };

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking', message: 'Suche nach Updates …' }));
  autoUpdater.on('update-not-available', () => { failures = 0; emit({ status: 'current', message: 'Aktuell' }); });
  autoUpdater.on('update-available', (i) => {
    failures = 0;
    emit({ status: autoUpdater.autoDownload ? 'downloading' : 'available', version: i.version, notes: notesText(i.releaseNotes), progress: 0, message: `Version ${i.version} verfügbar` });
    if (macManual && store.get('autoUpdate') !== false) downloadMac();
  });
  autoUpdater.on('download-progress', (p) => emit({ status: 'downloading', progress: Math.round(p.percent || 0), message: `Lädt Version ${state.version} …` }));
  autoUpdater.on('update-downloaded', (i) => emit({ status: 'ready', version: i.version, notes: notesText(i.releaseNotes) || state.notes, message: `Version ${i.version} ist bereit` }));
  autoUpdater.on('error', (e) => {
    log(`Fehler: ${e && (e.stack || e.message)}`);
    failures++;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(check, Math.min(30, 2 * failures) * 60 * 1000);
    emit({ status: failures >= 3 ? 'error' : 'retry', message: 'Update-Server nicht erreichbar – neuer Versuch in Kürze' });
  });
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

function check() {
  if (!supported() || ['downloading', 'ready'].includes(state.status)) return;
  autoUpdater.checkForUpdates().catch(() => {});
}

function download() {
  if (!supported()) return;
  if (macManual) return downloadMac();
  if (!state.version || ['retry', 'error', 'idle', 'current'].includes(state.status)) { autoUpdater.autoDownload = true; return check(); }
  emit({ status: 'downloading' });
  autoUpdater.downloadUpdate().catch(() => {});
}

function downloadMac() {
  if (!state.version || state.status === 'downloading') return;
  const v = state.version;
  const target = path.join(app.getPath('downloads'), `ImmoAdv-Browser-${v}.dmg`);
  if (fs.existsSync(target) && fs.statSync(target).size > 5 * 1024 * 1024) { macDmg = target; return emit({ status: 'ready', message: `Version ${v} ist bereit` }); }
  const ses = session.fromPartition('immoadv-update', { cache: false });
  emit({ status: 'downloading', progress: 0 });
  ses.once('will-download', (_e, item) => {
    item.setSavePath(target + '.part');
    item.on('updated', () => { const t = item.getTotalBytes(); if (t) emit({ status: 'downloading', progress: Math.round(item.getReceivedBytes() / t * 100) }); });
    item.once('done', (_e2, st) => {
      if (st === 'completed') { try { fs.renameSync(target + '.part', target); macDmg = target; return emit({ status: 'ready', message: `Version ${v} ist bereit` }); } catch {} }
      try { fs.unlinkSync(target + '.part'); } catch {}
      emit({ status: 'available', message: 'Download unterbrochen – bitte noch einmal tippen' });
    });
  });
  ses.downloadURL(`https://github.com/${REPO}/releases/download/v${v}/ImmoAdv-Browser-${v}.dmg`);
}

/** Jetzt installieren. silent=true: ohne Fenster installieren (Windows) – Chrome bleibt dabei offen. */
function install({ silent = false } = {}) {
  if (!supported() || state.status !== 'ready') return false;
  if (macManual) { if (macDmg) shell.openPath(macDmg).then(() => setTimeout(() => app.quit(), 1200)); return true; }
  setImmediate(() => autoUpdater.quitAndInstall(true, !silent));
  return true;
}

function setAuto(on) {
  store.set('autoUpdate', !!on);
  if (supported() && !macManual) { autoUpdater.autoDownload = !!on; autoUpdater.autoInstallOnAppQuit = !!on; }
}

module.exports = { init, check, download, install, setAuto, state: snapshot, onChange: (l) => listeners.push(l) };
