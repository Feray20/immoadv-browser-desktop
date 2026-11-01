// Updates des ImmoAdv Browsers (Windows & Mac) aus den GitHub-Releases.
// „Update jetzt installieren“: lädt herunter und installiert sofort ohne weitere Fragen, danach startet der Browser neu.
// Windows: stiller Installer. Mac ohne Apple-Signatur: neue App-Version wird selbst entpackt und ersetzt (Einstellungen bleiben).
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
let macManual = false;     // Mac ohne Apple-Signatur: Squirrel geht nicht → eigenes Ersetzen der App
let macZip = null;
let macSha = null;      // erwartete Prüfsumme der Mac-ZIP aus der Update-Info
let installWhenReady = false;   // Knopf gedrückt → nach dem Download sofort installieren
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
    const z = (i.files || []).find((f) => /-mac\.zip$/.test(f.url || ''));
    macSha = z && z.sha512 ? z.sha512 : null;
    emit({ status: autoUpdater.autoDownload ? 'downloading' : 'available', version: i.version, notes: notesText(i.releaseNotes), progress: 0, message: `Version ${i.version} verfügbar` });
    if (macManual && (store.get('autoUpdate') !== false || installWhenReady)) downloadMac();
  });
  autoUpdater.on('download-progress', (p) => emit({ status: 'downloading', progress: Math.round(p.percent || 0), message: `Lädt Version ${state.version} …` }));
  autoUpdater.on('update-downloaded', (i) => {
    emit({ status: 'ready', version: i.version, notes: notesText(i.releaseNotes) || state.notes, message: `Version ${i.version} ist bereit` });
    if (installWhenReady) install();
  });
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
  if (macManual) return state.version ? downloadMac() : check();
  if (!state.version || ['retry', 'error', 'idle', 'current'].includes(state.status)) { autoUpdater.autoDownload = true; return check(); }
  emit({ status: 'downloading' });
  autoUpdater.downloadUpdate().catch(() => {});
}

function downloadMac() {
  if (!state.version || state.status === 'downloading') return;
  const v = state.version;
  const dir = path.join(app.getPath('userData'), 'update');
  const target = path.join(dir, `ImmoAdv-Browser-${v}-universal-mac.zip`);
  fs.mkdirSync(dir, { recursive: true });
  if (macSha && fs.existsSync(target) && fs.statSync(target).size > 5 * 1024 * 1024 && require('node:crypto').createHash('sha512').update(fs.readFileSync(target)).digest('base64') === macSha) {
    macZip = target; emit({ status: 'ready', message: `Version ${v} ist bereit` });
    if (installWhenReady) install();
    return;
  }
  const ses = session.fromPartition('immoadv-update', { cache: false });
  emit({ status: 'downloading', progress: 0, message: `Lädt Version ${v} …` });
  ses.once('will-download', (_e, item) => {
    item.setSavePath(target + '.part');
    item.on('updated', () => { const t = item.getTotalBytes(); if (t) emit({ status: 'downloading', progress: Math.round(item.getReceivedBytes() / t * 100) }); });
    item.once('done', (_e2, st) => {
      if (st === 'completed') {
        try {
          // Prüfsumme gegen die Update-Info – sonst nicht installieren
          const sum = require('node:crypto').createHash('sha512').update(fs.readFileSync(target + '.part')).digest('base64');
          if (!macSha || sum !== macSha) { log(`Mac-Update: Prüfsumme passt nicht (${macSha ? 'abweichend' : 'fehlt'})`); fs.unlinkSync(target + '.part'); return emit({ status: 'error', message: 'Update-Datei beschädigt – neuer Versuch später' }); }
          fs.renameSync(target + '.part', target); macZip = target;
          emit({ status: 'ready', message: `Version ${v} ist bereit` });
          if (installWhenReady) install();
          return;
        } catch (e) { log('Mac-Download: ' + e.message); }
      }
      try { fs.unlinkSync(target + '.part'); } catch {}
      emit({ status: 'available', message: 'Download unterbrochen – bitte noch einmal tippen' });
    });
  });
  ses.downloadURL(`https://github.com/${REPO}/releases/download/v${v}/ImmoAdv-Browser-${v}-universal-mac.zip`);
}

// Mac: nach dem Beenden neue Version entpacken, alte App ersetzen, neu starten (nur das Programm – Einstellungen bleiben)
function installMac() {
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  if (!macZip || !bundle.endsWith('.app')) return false;
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); } catch {
    // Programme-Ordner nicht beschreibbar → Mac fragt einmal nach dem Passwort
    log('Programme-Ordner schreibgeschützt – Installation mit Admin-Freigabe');
  }
  const script = path.join(path.dirname(macZip), 'install.sh');
  const q = (x) => `'${String(x).replace(/'/g, `'\\''`)}'`;
  fs.writeFileSync(script, `#!/bin/bash
PID=${process.pid}; APP=${q(bundle)}; ZIP=${q(macZip)}; TMP="$(mktemp -d)"
LOG=${q(path.join(app.getPath('userData'), 'update.log'))}
for i in $(seq 1 60); do kill -0 $PID 2>/dev/null || break; sleep 0.5; done
if ditto -x -k "$ZIP" "$TMP" && [ -d "$TMP/ImmoAdv Browser.app" ]; then
  xattr -cr "$TMP/ImmoAdv Browser.app" 2>/dev/null
  if [ -w "$(dirname "$APP")" ]; then
    rm -rf "$APP.alt" && mv "$APP" "$APP.alt" && mv "$TMP/ImmoAdv Browser.app" "$APP" && rm -rf "$APP.alt"
  else
    osascript -e "do shell script \\"rm -rf '$APP.alt' && mv '$APP' '$APP.alt' && mv '$TMP/ImmoAdv Browser.app' '$APP' && rm -rf '$APP.alt'\\" with administrator privileges"
  fi
  [ -d "$APP" ] || mv "$APP.alt" "$APP"
  echo "$(date -u +%FT%TZ) Mac-Update installiert" >> "$LOG"
  rm -f "$ZIP"
else
  echo "$(date -u +%FT%TZ) Mac-Update: Entpacken fehlgeschlagen" >> "$LOG"
fi
rm -rf "$TMP"
open "$APP"
`, { mode: 0o755 });
  require('node:child_process').spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' }).unref();
  setImmediate(() => app.quit());
  return true;
}

/** Jetzt installieren – still, ohne Rückfragen; der Browser startet danach selbst neu. */
function install() {
  if (!supported() || state.status !== 'ready') return false;
  installWhenReady = false;
  emit({ status: 'installing', message: 'Wird installiert – der Browser startet gleich neu' });
  if (macManual) return installMac();
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}

/** Ein Knopf für alles: suchen → laden → sofort installieren */
function updateNow() {
  if (!supported()) return false;
  if (state.status === 'ready') return install();
  installWhenReady = true;
  if (state.status !== 'downloading') download();
  return true;
}

function setAuto(on) {
  store.set('autoUpdate', !!on);
  if (supported() && !macManual) { autoUpdater.autoDownload = !!on; autoUpdater.autoInstallOnAppQuit = !!on; }
}

module.exports = { init, check, download, install, updateNow, setAuto, logPath: () => path.join(app.getPath('userData'), 'update.log'), state: snapshot, onChange: (l) => listeners.push(l) };
