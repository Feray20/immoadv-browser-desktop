// ImmoAdv Browser – Programm für Windows und Mac.
// Basis ist das echte Google Chrome (Google-Konto, Sync, Passwörter, Passkeys, Erweiterungen – Updates von Google).
// Dieses Programm richtet Chrome mit eigenem ImmoAdv-Profil ein, bringt die ImmoAdv-Schicht mit
// (Startseite, Datenschutz-Center, Blocker, NordVPN, spurloses Surfen) und hält alles automatisch aktuell.
const { app, BrowserWindow, ipcMain, clipboard, nativeTheme, shell, Menu } = require('electron');
const path = require('node:path');
const store = require('./store');
const chrome = require('./chrome');
const { deploy, writeLauncherInfo, migrateV1 } = require('./deploy');
const updater = require('./updater');

app.setName('ImmoAdv Browser');
if (process.platform === 'win32') app.setAppUserModelId('de.immoadv.browser.desktop');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
const PROTOCOL = 'immoadv-browser';

let win = null;
let quitTimer = null;
let pendingUrl = null;

// ---------- Status für Datenschutz-Center ----------
function info() {
  const d = chrome.DNS[store.get('dnsProvider')] || chrome.DNS.quad9;
  const u = updater.state();
  writeLauncherInfo({
    dns: { mode: d.url ? 'secure' : 'off', provider: d.name },
    update: { status: u.status, version: u.version, message: u.status === 'ready' ? `Version ${u.version} wird installiert` : u.status === 'downloading' ? `Lädt Version ${u.version}` : '' }
  });
}

// ---------- Fenster (nur für Einrichtung, Update-Knopf und Einstellungen) ----------
function showWindow(view) {
  clearTimeout(quitTimer);
  if (process.platform === 'darwin' && app.dock) app.dock.show();
  if (win && !win.isDestroyed()) { win.webContents.send('view', view); win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 760, height: 600, minWidth: 620, minHeight: 520, show: false, title: 'ImmoAdv Browser',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0C1320' : '#F5F7FA',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 36 } } : {}),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'ui', 'app.html'), { hash: view });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; scheduleQuit(); });
}

// ---------- Ablauf beim Öffnen ----------
function ready() {
  return !!chrome.find() && store.get('setupDone') && chrome.extensionLoaded();
}

function openBrowser(urls = []) {
  chrome.applyPrefs(store.get('dnsProvider'));      // greift nur, wenn Chrome mit dem ImmoAdv-Profil gerade zu ist
  chrome.launch(urls);
}

function route(argv) {
  const url = (argv || []).find((a) => typeof a === 'string' && a.startsWith(PROTOCOL + ':')) || pendingUrl;
  pendingUrl = null;
  const action = url ? url.replace(/^immoadv-browser:\/*/, '').replace(/\/$/, '') : '';
  if (action.startsWith('update')) { updater.check(); return showWindow('update'); }
  if (action.startsWith('einstellungen')) return showWindow('settings');
  if (!ready()) return showWindow('setup');
  openBrowser();
  scheduleQuit();
}

// Unsichtbar weiterlaufen, bis das Update geprüft/geladen ist – dann still installieren und beenden
function scheduleQuit() {
  clearTimeout(quitTimer);
  if (win) return;
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  const started = Date.now();
  const tick = () => {
    if (win) return;
    const u = updater.state();
    if (u.status === 'ready' && !u.macManual && store.get('autoUpdate') !== false) { updater.install({ silent: true }); return; }
    const busy = ['checking', 'downloading', 'idle'].includes(u.status) && Date.now() - started < 45 * 60 * 1000;
    if (busy) { quitTimer = setTimeout(tick, 5000); return; }
    app.quit();
  };
  quitTimer = setTimeout(tick, 8000);
}

// ---------- IPC für das Fenster ----------
async function stateForUi() {
  return {
    platform: process.platform,
    appVersion: app.getVersion(),
    chromeFound: !!chrome.find(),
    chromeVersion: await chrome.version(),
    chromeRunning: chrome.isRunning(),
    extLoaded: chrome.extensionLoaded(chrome.paths.extension()),
    themeLoaded: chrome.extensionLoaded(chrome.paths.theme()),
    extPath: chrome.paths.extension(),
    themePath: chrome.paths.theme(),
    setupDone: !!store.get('setupDone'),
    dns: store.get('dnsProvider'),
    dnsList: Object.entries(chrome.DNS).map(([id, d]) => ({ id, name: d.name })),
    autoUpdate: store.get('autoUpdate') !== false,
    update: updater.state()
  };
}
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);

ipcMain.handle('state', () => stateForUi());
ipcMain.handle('install-chrome', async () => {
  try { await chrome.install((p) => send('install-progress', p)); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('open-extensions', (_e, which) => {
  const dir = which === 'theme' ? chrome.paths.theme() : chrome.paths.extension();
  clipboard.writeText(dir);
  chrome.launch(['chrome://extensions']);
  return dir;
});
ipcMain.handle('copy', (_e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('open-browser', (_e, url) => { openBrowser(url ? [url] : []); return true; });
ipcMain.handle('finish-setup', () => { store.set('setupDone', true); if (win) win.close(); openBrowser(['chrome://settings/syncSetup']); return true; });
ipcMain.handle('set-dns', (_e, id) => {
  if (!chrome.DNS[id]) return { ok: false };
  store.set('dnsProvider', id);
  const applied = chrome.applyPrefs(id);
  info();
  return { ok: true, applied };
});
ipcMain.handle('set-auto-update', (_e, on) => { updater.setAuto(on); return true; });
ipcMain.handle('update-check', () => { updater.check(); return updater.state(); });
ipcMain.handle('update-download', () => { updater.download(); return true; });
ipcMain.handle('update-install', () => updater.install({ silent: false }));
ipcMain.handle('close', () => { if (win) win.close(); });

// ---------- Start ----------
app.on('second-instance', (_e, argv) => route(argv));
app.on('open-url', (e, url) => { e.preventDefault(); if (app.isReady()) route([url]); else pendingUrl = url; });   // Mac
app.on('window-all-closed', () => { /* weiterlaufen bis scheduleQuit entscheidet */ });
app.on('activate', () => route([]));

app.whenReady().then(() => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  migrateV1(store);
  try { deploy(); } catch (e) { console.error('Bereitstellen fehlgeschlagen', e); }
  updater.init((s) => { info(); send('update', s); });
  info();
  // Vom alten Browser als Hintergrund-Autostart aufgerufen → nur aufräumen, nichts öffnen
  if (process.argv.includes('--hidden')) { scheduleQuit(); return; }
  route(process.argv);
});
