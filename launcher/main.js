// ImmoAdv Browser 4 – Starter für Windows und Mac.
// Motor: Firefox ESR von Mozilla (Google-Anmeldung, YouTube Premium, Passkeys mit Windows Hello/Touch ID funktionieren),
// darauf die ImmoAdv-Oberfläche (Fade-Design) und die ImmoAdv-Erweiterung (Startseite, Immobilien-Check, KI, Blocker, NordVPN,
// spurloses Surfen, Passwort-Tresor). Dieses Programm richtet alles ein, startet den Browser und hält ihn aktuell.
// Zweite Rolle: Firefox startet es als Native-Messaging-Gegenstelle der Erweiterung (siehe host.js).
const { app, BrowserWindow, ipcMain, nativeTheme, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const EXT_ID = 'browser@immoadv.de';
const HOST_NAME = 'de.immoadv.browser';
app.setName('ImmoAdv Browser');
if (process.platform === 'win32') app.setAppUserModelId('de.immoadv.browser.desktop');

// ---------- Selbsttest (nur Prüf-Build): Motor laden, prüfen, einrichten, kurz starten ----------
if (process.argv.includes('--selbsttest')) {
  app.whenReady().then(async () => {
    const out = [];
    const note = (m) => { out.push(m); console.log(m); };
    try {
      const engine = require('./engine');
      note('Motor da: ' + engine.installed());
      if (!engine.installed()) await engine.install((p) => { if (p.step !== 'download' || p.p % 25 === 0) note('Schritt ' + JSON.stringify(p)); });
      note('Motor installiert: ' + engine.installed() + ' Version ' + await engine.version());
      note('Einrichten: ' + engine.deploy());
      note('Gegenstelle angemeldet: ' + require('./nativehost').register());
      const { spawnSync } = require('node:child_process');
      const shot = path.join(app.getPath('userData'), 'selbsttest.png');
      const r = spawnSync(require('./engine').paths && path.join(engine.paths.engine(), process.platform === 'win32' ? 'firefox.exe' : 'firefox/firefox'),
        ['--profile', engine.paths.profile(), '--headless', '--screenshot', shot, '--window-size=1280,800', engine.extUrl('pages/settings.html')], { timeout: 90000 });
      note('Firefox beendet: ' + r.status + ' ' + String(r.stderr || '').slice(-400));
      note('Bild: ' + fs.existsSync(shot));
    } catch (e) { note('FEHLER ' + (e && e.stack || e)); }
    fs.writeFileSync(path.join(app.getPath('userData'), 'selbsttest.txt'), out.join('\n'));
    app.exit(0);
  });
} else if (process.argv.includes('--host-server')) {
  // ---------- Rolle 2: Hintergrund-Dienst für die Erweiterung (Firefox → relay.js → hier) ----------
  app.whenReady().then(() => require('./host').startServer());
  app.on('window-all-closed', () => {});
} else
// ---------- Rolle 2b: direkte Gegenstelle über stdin/stdout (nur Entwicklung unter Mac/Linux) ----------
if (process.argv.some((a) => a === EXT_ID || /NativeMessagingHosts|native-host\.json/i.test(a))) {
  app.whenReady().then(() => require('./host').start());
  app.on('window-all-closed', () => {});
} else {
  starter();
}

function starter() {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  const store = require('./store');
  const engine = require('./engine');
  let win = null;
  let pending = [];

  const registerHost = () => require('./nativehost').register();

  // ---------- Was soll geöffnet werden? ----------
  const OFFICE = /\.(docx?|xlsx?|xlsm|csv|pptx?|odt|ods|odp|rtf)$/i;
  const OPENABLE = /\.(pdf|html?|xhtml|svg|txt|png|jpe?g|gif|webp|avif|bmp|json|xml|md)$/i;
  function targets(argv) {
    const out = [];
    for (const a of (argv || []).slice(1)) {
      if (!a || a === '--' || a.startsWith('--')) continue;
      if (/^https?:\/\//i.test(a)) { out.push(a); continue; }
      if (/^immoadv-browser:/i.test(a)) continue;
      let f = a; try { if (/^file:/i.test(a)) f = require('node:url').fileURLToPath(a); } catch {}
      if (!path.isAbsolute(f) || !fs.existsSync(f) || !fs.statSync(f).isFile()) continue;
      if (OFFICE.test(f)) out.push(engine.extUrl(`office/index.html?file=${share(f)}&name=${encodeURIComponent(path.basename(f))}`));
      else if (OPENABLE.test(f)) out.push(pathToFileURL(f).href);
    }
    return out;
  }
  // Dateien für den Office-Betrachter freigeben (nur diese, per Zufallsschlüssel)
  function share(file) {
    const f = path.join(app.getPath('userData'), 'freigaben.json');
    let list = {}; try { list = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    const token = crypto.randomBytes(16).toString('hex');
    list[token] = file;
    const keys = Object.keys(list); for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete list[k];
    fs.writeFileSync(f, JSON.stringify(list), { mode: 0o600 });
    return token;
  }

  // ---------- Einrichtungsfenster (nur beim ersten Start bzw. wenn der Motor fehlt) ----------
  function showSetup() {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
    win = new BrowserWindow({
      width: 560, height: 420, resizable: false, show: false, title: 'ImmoAdv Browser',
      backgroundColor: '#07111f', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 34 } } : {}),
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'ui', 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.loadFile(path.join(__dirname, 'ui', 'setup.html'));
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => { win = null; });
  }
  const progress = (p) => { if (win && !win.isDestroyed()) win.webContents.send('progress', p); };

  let installing = null;
  async function ensureEngine() {
    if (engine.installed()) return true;
    showSetup();
    if (!installing) installing = engine.install(progress).finally(() => { installing = null; });
    try { await installing; return true; }
    catch (e) { engine.log('Installation: ' + (e && e.stack || e)); progress({ step: 'error', message: String(e.message || e) }); return false; }
  }

  async function open(argv, { wait = false } = {}) {
    const urls = targets(argv);
    if (!(await ensureEngine())) return false;
    if (wait) await engine.waitClosed();
    try { engine.deploy(); } catch (e) { engine.log('Einrichten: ' + (e && e.stack || e)); }
    engine.launch(urls);
    if (win && !win.isDestroyed()) { progress({ step: 'done' }); setTimeout(() => win && win.close(), 900); }
    return true;
  }

  function finish() { setTimeout(() => { if (!win && !installing) app.quit(); }, 1500); }

  ipcMain.handle('retry', async () => { await open(pending); finish(); });
  ipcMain.handle('info', () => ({ version: app.getVersion(), platform: process.platform }));

  app.on('second-instance', (_e, argv) => { open(argv); });
  app.on('open-url', (e, url) => { e.preventDefault(); if (app.isReady()) open(['', url]); else pending.push(url); });   // Mac
  app.on('open-file', (e, file) => { e.preventDefault(); if (app.isReady()) open(['', file]); else pending.push(file); });
  app.on('window-all-closed', () => { if (!installing) app.quit(); });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    try { registerHost(); } catch (e) { engine.log('Host-Anmeldung: ' + e.message); }
    if (app.isPackaged) app.setAsDefaultProtocolClient('immoadv-browser');
    const argv = [process.argv[0], ...process.argv.slice(1), ...pending];
    pending = argv;
    // Nach Update oder Einstellungsänderung: warten, bis der Browser zu ist, dann neu starten
    const wait = process.argv.includes('--restart') || process.argv.includes('--updated');
    await open(argv, { wait });
    finish();
  });
}
