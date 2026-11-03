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
      note('Logo: ' + await engine.brandIcon());
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
  // Mac (02.11.2026, Feray: „zwei Symbole im Dock“): der Hintergrund-Dienst zeigt kein eigenes Dock-Symbol.
  if (process.platform === 'darwin') app.dock?.hide();
  // ---------- Rolle 2: Hintergrund-Dienst für die Erweiterung (Firefox → relay.js → hier) ----------
  app.whenReady().then(() => require('./host').startServer());
  app.on('window-all-closed', () => {});
} else
// ---------- Rolle 2b: direkte Gegenstelle über stdin/stdout (nur Entwicklung unter Mac/Linux) ----------
if (process.argv.some((a) => a === EXT_ID || /NativeMessagingHosts|native-host\.json/i.test(a))) {
  if (process.platform === 'darwin') app.dock?.hide();
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
  // Bilder (02.11.2026, Feray: „am Mac fehlen alle Bearbeitungs-Funktionen wie unter Windows“) öffnen ebenfalls im
  // ImmoAdv-Betrachter – mit Vorschau, Drehen, Zuschneiden, Helligkeit usw. –, nicht als nackte Datei-Seite.
  const OFFICE = /\.(docx?|xlsx?|xlsm|csv|pptx?|odt|ods|odp|rtf|png|jpe?g|gif|webp|bmp)$/i;
  const OPENABLE = /\.(pdf|html?|xhtml|svg|txt|avif|json|xml|md)$/i;
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
      backgroundColor: '#F6F9FE', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 34 } } : {}),
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'ui', 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.loadFile(path.join(__dirname, 'ui', 'setup.html'));
    win.once('ready-to-show', () => { win.show(); if (process.platform === 'darwin') app.focus({ steal: true }); });
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

  // Heruntergeladenes Update beim Start installieren (Feray 02.11.2026: „Update lässt sich nicht automatisch installieren“).
  // Grund: Beim Schließen beendet Firefox den Hintergrunddienst sofort – „beim Beenden installieren“ kam nie dran.
  // Jetzt: Liegt ein fertig geladenes, geprüftes Update (electron-updater „pending“) mit höherer Version bereit und läuft
  // der Browser gerade nicht, wird es vor dem Öffnen still installiert; danach startet der Browser selbst neu.
  function pendingUpdate() {
    if (process.platform !== 'win32' || !app.isPackaged || process.windowsStore) return null;
    try {
      let dir = 'immoadv-browser-updater';
      try { const y = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8'); const m = /updaterCacheDirName:\s*(\S+)/.exec(y); if (m) dir = m[1].replace(/['"]/g, ''); } catch {}
      const pend = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), dir, 'pending');
      const info = JSON.parse(fs.readFileSync(path.join(pend, 'update-info.json'), 'utf8'));
      const file = path.join(pend, String(info.fileName || ''));
      const v = /(\d+\.\d+\.\d+)/.exec(String(info.fileName || ''))?.[1];
      if (!v || !fs.existsSync(file)) return null;
      const n = (x) => x.split('.').map(Number), a = n(v), b = n(app.getVersion());
      const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      if (newer <= 0) return null;
      // Nur ein Versuch je Version – schlägt die Installation fehl, startet der Browser beim nächsten Mal normal.
      const mark = path.join(pend, `versucht-${v}`);
      if (fs.existsSync(mark)) return null;
      return { file, v, mark };
    } catch { return null; }
  }
  function installPending() {
    const p = pendingUpdate();
    if (!p) return false;
    try { if (engine.running()) return false; } catch {}
    try {
      engine.log(`Update ${p.v} wird beim Start installiert`);
      try { fs.writeFileSync(p.mark, new Date().toISOString()); } catch {}
      try { fs.unlinkSync(p.file + ':Zone.Identifier'); } catch {} /* SmartScreen-Sperre der eigenen Update-Datei lösen */
      { const ch = require('node:child_process').spawn(p.file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }); ch.on('error', () => {}); ch.unref(); }
      setTimeout(() => app.quit(), 300);
      return true;
    } catch (e) { engine.log('Update beim Start: ' + e.message); return false; }
  }

  // Im Hintergrund öffnen (02.11.2026, Feray: Links aus der ImmoAdv-Software – z. B. „Bei Amazon bestellen“ – sollen
  // im Browser hinten aufgehen, ohne dass das Fenster nach vorne springt). Läuft der Browser schon, gehen die Links über
  // den Hintergrund-Dienst an den Browser (neuer Tab hinten); sonst normaler Start.
  function openBackground(urls) {
    return new Promise((resolve) => {
      try {
        const os = require('node:os'), net = require('node:net');
        const user = String(process.env.USERNAME || process.env.USER || os.userInfo().username || 'nutzer').replace(/[^\w.-]/g, '_');
        const PIPE = process.platform === 'win32' ? `\\\\.\\pipe\\immoadv-browser-${user}` : path.join(os.tmpdir(), `immoadv-browser-${user}.sock`);
        const sock = net.connect(PIPE);
        let buf = Buffer.alloc(0), done = false;
        const end = (ok) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve(ok); };
        const t = setTimeout(() => end(false), 3000);
        sock.on('error', () => { clearTimeout(t); end(false); });
        sock.on('connect', () => {
          const body = Buffer.from(JSON.stringify({ id: 'bg1', cmd: 'tabs.openBg', urls }), 'utf8');
          const head = Buffer.alloc(4); head.writeUInt32LE(body.length, 0);
          sock.write(Buffer.concat([head, body]));
        });
        sock.on('data', (c) => {
          buf = Buffer.concat([buf, c]);
          while (buf.length >= 4) {
            const len = buf.readUInt32LE(0); if (buf.length < 4 + len) return;
            let msg = null; try { msg = JSON.parse(buf.slice(4, 4 + len).toString('utf8')); } catch {}
            buf = buf.slice(4 + len);
            if (msg && msg.id === 'bg1') { clearTimeout(t); end(!!(msg.ok && msg.data > 0)); }
          }
        });
      } catch { resolve(false); }
    });
  }

  async function open(argv, { wait = false } = {}) {
    const urls = targets(argv);
    if ((argv || []).includes('--background') && urls.length && urls.every((u) => /^https?:/i.test(u))) {
      try { if (engine.running() && (await openBackground(urls))) { engine.log(`Hintergrund ${urls.length} Link(s)`); return true; } } catch {}
    }
    if (installPending()) return true;
    if (!(await ensureEngine())) return false;
    if (wait) await engine.waitClosed();
    try { if (!engine.running()) await engine.brandIcon(); engine.deploy(); } catch (e) { engine.log('Einrichten: ' + (e && e.stack || e)); }
    if (process.platform === 'darwin' && app.isPackaged) require('./cleanup').dockMac(store, engine).catch((e) => engine.log('Dock: ' + e.message));
    engine.launch(urls);
    if (win && !win.isDestroyed()) { progress({ step: 'done' }); setTimeout(() => win && win.close(), 900); }
    return true;
  }

  // Starter beendet sich, sobald der Browser offen ist (Dock-Umstellung bekommt kurz Zeit) – bleibt nicht im Hintergrund hängen.
  function finish() { setTimeout(() => { if (!win && !installing) app.quit(); }, 4000); }

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
    // Einmal je neuer Version: alte Verknüpfungen/Installationen still entfernen (launcher/cleanup.js).
    try { require('./cleanup').run(store, (m) => engine.log(m)); } catch (e) { engine.log('Aufräumen: ' + e.message); }
    const argv = [process.argv[0], ...process.argv.slice(1), ...pending];
    pending = argv;
    // Nach Update oder Einstellungsänderung: warten, bis der Browser zu ist, dann neu starten
    const wait = process.argv.includes('--restart') || process.argv.includes('--updated');
    await open(argv, { wait });
    finish();
  });
}
