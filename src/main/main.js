// ImmoAdv Browser – Hauptprozess (Windows & Mac)
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, systemPreferences, nativeTheme, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const store = require('./store');
const tor = require('./tor');
const pdf = require('./pdf');
const updater = require('./updater');
const { createBrowsingSession, tabPreferences, hostOf, proxyFor, GOOGLE_DIRECT, GOOGLE_LOGIN_HOSTS } = require('./privacy');
const { LISTING_SCRIPT } = require('../shared/listing');

// ---------- Grundschutz vor dem Start ----------
app.setName('ImmoAdv Browser');
process.env.TZ = 'UTC';
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('disable-features', 'NetworkPrediction,InterestFeedContentSuggestions,MediaRouter,DialMediaRouteProvider,AutofillServerCommunication');
// Tor-Einstellung gilt für die ganze Laufzeit (Änderungen erst nach Neustart) – nie halb an, halb aus
const TOR_ON = !!store.get('torEnabled');
if (TOR_ON) {
  // Keine einzige DNS-Anfrage am Tor vorbei: lokale Namensauflösung komplett aus
  const direct = GOOGLE_DIRECT ? GOOGLE_LOGIN_HOSTS.map((h) => ` , EXCLUDE ${h}`).join('') : '';
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1' + direct);
}
pdf.registerScheme();
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const CHROME_HEIGHT = 84;      // Tab-Leiste + Adressleiste (wird vom Fenster gemeldet)
let win = null;
let browsingSession = null;
let layout = { top: CHROME_HEIGHT, right: 0, hidden: false };
const tabs = [];                // { id, view, kind: 'web'|'pdf', url, title, filePath, listing }
let activeId = null;

const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const active = () => tabs.find((t) => t.id === activeId);

// ---------- Fenster ----------
async function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 760, minHeight: 520,
    title: 'ImmoAdv Browser',
    backgroundColor: '#0B1F3A',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 12 }, vibrancy: 'under-window', visualEffectState: 'active' }
      : { titleBarOverlay: { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#0B1F3A', height: 38 } }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'chrome-preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore']) win.on(ev, positionViews);
  win.on('closed', () => { win = null; });
  newTab();
}

// ---------- Tabs ----------
function makeView(kind) {
  const prefs = kind === 'pdf'
    ? { session: pdf.getSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
    : tabPreferences(browsingSession);
  const view = new WebContentsView({ webPreferences: prefs });
  view.setBackgroundColor('#ffffff');
  return view;
}

function wireView(tab) {
  const wc = tab.view.webContents;
  if (tab.kind === 'web') wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');

  // Neue Fenster → neuer Tab (keine Pop-ups)
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) newTab(url);
    return { action: 'deny' };
  });
  // Nur Webadressen – keine Programme oder lokalen Dateien aus Webseiten heraus öffnen
  const allowed = (url) => (tab.kind === 'pdf' ? url.startsWith('immoadv-pdf:') : /^https?:/i.test(url));
  wc.on('will-navigate', (e, url) => { if (!allowed(url)) e.preventDefault(); });
  wc.on('will-redirect', (e, url) => { if (!allowed(url)) e.preventDefault(); });
  wc.on('will-frame-navigate', (e) => { if (!allowed(e.url) && !/^(about|blob|data):/i.test(e.url)) e.preventDefault(); });

  const update = () => {
    if (wc.isDestroyed()) return;
    tab.url = tab.kind === 'pdf' ? tab.url : wc.getURL();
    tab.title = wc.getTitle() || tab.title;
    pushTabs();
  };
  wc.on('page-title-updated', update);
  wc.on('did-navigate', (_e, url) => {
    tab.listing = null; tab.googleBlocked = false;
    if (!/^https:\/\/accounts\.google\./.test(url)) tab.lastSiteUrl = url;   // Seite, von der die Anmeldung kam
    update();
  });
  wc.on('did-navigate-in-page', update);
  wc.on('did-start-loading', () => { tab.loading = true; tab.error = null; pushTabs(); });
  wc.on('did-stop-loading', () => { tab.loading = false; pushTabs(); });
  wc.on('did-fail-load', (_e, code, _desc, _url, isMain) => {
    if (!isMain || code === -3) return;   // -3 = abgebrochen
    tab.error = TOR_ON && tor.state.status !== 'connected'
      ? 'Tor verbindet noch … Bitte gleich noch einmal laden.'
      : 'Seite konnte nicht geladen werden. Manche Seiten sperren Tor – „Neu laden“ oder „Neue Identität“ hilft oft.';
    pushTabs();
  });
  wc.on('did-finish-load', async () => {
    if (tab.kind !== 'web') return;
    // Erkennen, wenn Google die Anmeldung in diesem Browser ablehnt
    if (/^https:\/\/accounts\.google\./.test(wc.getURL())) {
      try {
        tab.googleBlocked = await wc.executeJavaScriptInIsolatedWorld(1002, [{ code:
          `/rejected|disallowed_useragent/.test(location.href) || /nicht sicher|may not be secure|Couldn.t sign you in|Anmeldung nicht möglich/i.test(document.body ? document.body.innerText : '')` }]);
      } catch { tab.googleBlocked = false; }
      pushTabs();
    }
    try {
      // in einer eigenen, von der Seite getrennten Skript-Welt – die Seite merkt nichts davon
      const l = await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: LISTING_SCRIPT }]);
      tab.listing = l && (l.price || l.rent) ? l : null;
    } catch { tab.listing = null; }
    pushTabs();
  });
  wc.on('before-input-event', (e, input) => handleShortcut(e, input));
}

function newTab(url, opts = {}) {
  const kind = opts.kind || 'web';
  const tab = { id: crypto.randomUUID(), kind, view: makeView(kind), url: '', title: opts.title || 'Startseite', filePath: opts.filePath || null };
  wireView(tab);
  tabs.push(tab);
  win.contentView.addChildView(tab.view);
  activeId = tab.id;
  if (url) load(tab, url);
  positionViews();
  pushTabs();
  return tab;
}

function load(tab, url) {
  tab.url = url;
  tab.error = null;
  tab.view.webContents.loadURL(url).catch(() => {});
  positionViews();
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  if (!tabs.length) newTab();
  if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)].id;
  positionViews(); pushTabs();
}

function positionViews() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  for (const t of tabs) {
    const show = t.id === activeId && !layout.hidden && !!t.url;
    t.view.setVisible(show);
    if (show) t.view.setBounds({ x: 0, y: layout.top, width: Math.max(0, w - layout.right), height: Math.max(0, h - layout.top) });
  }
}

function pushTabs() {
  send('tabs', {
    activeId,
    tabs: tabs.map((t) => {
      const wc = t.view.webContents;
      return {
        id: t.id, kind: t.kind, title: t.title, url: t.kind === 'pdf' ? '' : t.url,
        fileName: t.filePath ? path.basename(t.filePath) : null,
        loading: !!t.loading, error: t.error || null, listing: t.listing || null, googleBlocked: !!t.googleBlocked,
        canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward()
      };
    })
  });
}

// Neue Identität: neue Tor-Route + neue, leere Sitzung für alle Tabs
async function newIdentity() {
  const ok = !TOR_ON || await tor.newIdentity();
  const old = browsingSession;
  browsingSession = await createBrowsingSession(TOR_ON, tor.socksPort);
  wireDownloads(browsingSession);
  for (const t of tabs.filter((x) => x.kind === 'web')) {
    const url = t.url;
    win.contentView.removeChildView(t.view);
    t.view.webContents.close();
    t.view = makeView('web');
    wireView(t);
    win.contentView.addChildView(t.view);
    if (url) load(t, url);
  }
  positionViews(); pushTabs();
  try { await old.clearStorageData(); await old.clearCache(); old.closeAllConnections(); } catch { /* bereits leer */ }
  send('toast', ok ? 'Neue Identität aktiv' : 'Daten gelöscht – neue Tor-Route folgt, sobald Tor verbunden ist');
}

// ---------- Downloads ----------
const reserved = new Set();   // Ziele laufender Downloads (gleichnamige Dateien gleichzeitig)
function uniquePath(dir, name) {
  const clean = (name || 'Download').replace(/[\\/:*?"<>|]/g, '-');
  const ext = path.extname(clean), base = path.basename(clean, ext);
  let p = path.join(dir, clean), n = 1;
  while (fs.existsSync(p) || reserved.has(p)) p = path.join(dir, `${base} (${n++})${ext}`);
  return p;
}

function downloadDir() {
  const d = store.get('downloadDir');
  return d && fs.existsSync(d) ? d : app.getPath('downloads');
}

function wireDownloads(ses) {
  ses.on('will-download', (_e, item) => {
    const target = uniquePath(downloadDir(), item.getFilename());
    item.setSavePath(target);
    reserved.add(target);
    item.once('done', (_ev, state) => {
      reserved.delete(target);
      if (state !== 'completed') return send('toast', 'Download abgebrochen');
      send('toast', `Gespeichert in „${path.basename(downloadDir())}“`);
      if (path.extname(target).toLowerCase() === '.pdf') openPDF(target);
    });
  });
}

async function openPDFDialog() {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }], defaultPath: downloadDir() });
  if (!r.canceled && r.filePaths[0]) openPDF(r.filePaths[0]);
}

function openPDF(filePath) {
  newTab(pdf.viewerURL(filePath), { kind: 'pdf', title: path.basename(filePath), filePath });
}

// ---------- Tastenkürzel ----------
function handleShortcut(e, input) {
  if (input.type !== 'keyDown') return;
  const mod = process.platform === 'darwin' ? input.meta : input.control;
  if (!mod) return;
  const k = input.key.toLowerCase();
  const t = active();
  const map = {
    t: () => newTab(), w: () => t && closeTab(t.id), l: () => { win.webContents.focus(); send('focus-address'); },
    r: () => t?.view.webContents.reload(), s: () => t?.kind === 'pdf' && savePDF(t),
    '[': () => t?.view.webContents.navigationHistory.goBack(), ']': () => t?.view.webContents.navigationHistory.goForward()
  };
  if (map[k]) { e.preventDefault(); map[k](); }
}

async function savePDF(t) {
  try { await pdf.save(t.view.webContents, t.filePath); send('toast', 'PDF gespeichert'); }
  catch { send('toast', 'Speichern fehlgeschlagen'); }
}

// ---------- Verbindung zum Fenster ----------
function registerIPC() {
  // Nur das eigene Fenster darf Befehle schicken – nie eine Webseite
  const fromUI = (e) => win && e.sender === win.webContents;
  const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (fromUI(e)) fn(e, ...a); });
  const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => (fromUI(e) ? fn(e, ...a) : null));
  handle('update:check', () => updater.check());
  handle('update:download', () => updater.download());
  handle('update:install', () => updater.install());
  handle('update:auto', (_e, on) => updater.setAuto(on));
  handle('state', () => ({
    update: updater.state(), version: app.getVersion(),
    settings: store.all(), tor: tor.state, platform: process.platform,
    downloadDirName: store.get('downloadDir') ? path.basename(store.get('downloadDir')) : null
  }));
  on('layout', (_e, l) => { layout = { ...layout, ...l }; positionViews(); });
  on('navigate', (_e, input) => {
    let t = active();
    if (!t || t.kind === 'pdf') t = newTab();
    load(t, toURL(input));
  });
  on('tab:new', (_e, url) => newTab(url ? toURL(url) : undefined));
  on('tab:select', (_e, id) => { if (tabs.some((t) => t.id === id)) { activeId = id; positionViews(); pushTabs(); } });
  on('tab:close', (_e, id) => closeTab(id));
  on('nav', (_e, cmd) => {
    const t = active(); if (!t) return;
    const wc = t.view.webContents;
    ({ back: () => wc.navigationHistory.goBack(), forward: () => wc.navigationHistory.goForward(),
       reload: () => wc.reload(), stop: () => wc.stop() })[cmd]?.();
  });
  on('identity', () => newIdentity());
  on('pdf:open', () => openPDFDialog());
  on('open-external', () => { const t = active(); if (t?.kind === 'web') openExternal(t); });
  on('pdf:save', () => { const t = active(); if (t?.kind === 'pdf') savePDF(t); });
  handle('downloadDir:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Download-Ordner wählen', properties: ['openDirectory', 'createDirectory'], defaultPath: app.getPath('documents') });
    if (r.canceled || !r.filePaths[0]) return null;
    store.set('downloadDir', r.filePaths[0]);
    return path.basename(r.filePaths[0]);
  });
  handle('downloadDir:default', () => { store.set('downloadDir', app.getPath('downloads')); return path.basename(app.getPath('downloads')); });
  handle('downloadDir:open', () => shell.openPath(downloadDir()));
  handle('settings:set', (_e, obj) => {
    const allowed = ['torEnabled', 'useBridges', 'customBridges', 'blockTrackers', 'httpsOnly', 'javaScript', 'appLock', 'bookmarks', 'googleDirect'];
    for (const k of Object.keys(obj)) if (allowed.includes(k)) store.set(k, obj[k]);
    return store.all();
  });
  handle('report:save', async (_e, { html, fileName }) => saveReport(html, fileName));
  on('menu', () => showMenu());
  on('clear-all', async () => {
    for (const t of [...tabs]) closeTab(t.id);
    await newIdentity();
    send('toast', 'Alles gelöscht');
  });
}

// Öffnet die Seite (bei gesperrtem Google-Login: die Seite davor) im normalen Browser von Windows/Mac
function openExternal(t) {
  const url = t.googleBlocked && t.lastSiteUrl ? t.lastSiteUrl : t.url;
  if (/^https?:/i.test(url)) shell.openExternal(url);
}

function toURL(input) {
  const s = String(input || '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /^[^\s/]+\.[a-z0-9-]{2,}(\/.*)?$/i.test(s)) return 'https://' + s;
  const q = encodeURIComponent(s);
  return TOR_ON
    ? `https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/?q=${q}&kl=de-de`
    : `https://duckduckgo.com/?q=${q}&kl=de-de`;
}

function showMenu() {
  const t = active();
  const template = [
    { label: 'Neuer Tab', accelerator: 'CmdOrCtrl+T', click: () => newTab() },
    { label: 'Neue Identität', click: () => newIdentity() },
    { type: 'separator' },
    { label: 'PDF öffnen & unterschreiben …', click: () => openPDFDialog() },
    ...(t?.kind === 'pdf' ? [{ label: 'PDF speichern', accelerator: 'CmdOrCtrl+S', click: () => savePDF(t) }] : []),
    { label: 'Download-Ordner öffnen', click: () => shell.openPath(downloadDir()) },
    ...(t?.kind === 'web' && t.url ? [{ label: 'Im Standard-Browser öffnen (ohne Tor)', click: () => openExternal(t) }] : []),
    { type: 'separator' },
    { label: 'Einstellungen & Sicherheit', click: () => send('open-panel', 'settings') }
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
}

// Bericht des Immobilien-Checks als PDF in den Download-Ordner (ohne Netzwerk erzeugt)
async function saveReport(html, fileName) {
  const ses = session.fromPartition('immoadv-report', { cache: false });
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith('data:') }));
  const w = new BrowserWindow({ show: false, webPreferences: { session: ses, javascript: false, sandbox: true } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const data = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } });
    const target = uniquePath(downloadDir(), fileName);
    fs.writeFileSync(target, data);
    return path.basename(downloadDir());
  } finally { w.destroy(); }
}

// ---------- Start ----------
app.whenReady().then(async () => {
  // Mac: optional Touch ID beim Start
  if (process.platform === 'darwin' && store.get('appLock') && systemPreferences.canPromptTouchID()) {
    try { await systemPreferences.promptTouchID('ImmoAdv Browser entsperren'); } catch { return app.quit(); }
  }
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' },
      { label: 'Ablage', submenu: [{ label: 'Neuer Tab', accelerator: 'Cmd+T', click: () => newTab() }, { role: 'close' }] },
      { role: 'windowMenu' }
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  registerIPC();

  // Standard-Sitzung (Fenster, interne Anfragen): kein direkter Netzverkehr
  const def = session.defaultSession;
  def.setSpellCheckerEnabled(false);
  if (TOR_ON) await def.setProxy(proxyFor(0));
  def.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^(https?|wss?|ftp):/i.test(d.url) }));

  browsingSession = await createBrowsingSession(TOR_ON, 0);
  wireDownloads(browsingSession);
  // sobald Tor seinen Port meldet, wird er als Proxy gesetzt
  tor.on('socks', (port) => { browsingSession.setProxy(proxyFor(port)); });
  tor.on('state', (s) => send('tor', s));
  await createWindow();

  updater.init({
    onState: (s) => send('update', s),
    torOn: TOR_ON,
    // Update-Suche erst, wenn Tor verbunden ist (läuft dann ebenfalls über Tor)
    whenTorReady: (cb) => {
      const go = () => cb(tor.socksPort);
      if (tor.state.status === 'connected') return go();
      const h = (s) => { if (s.status === 'connected') { tor.off('state', h); go(); } };
      tor.on('state', h);
    }
  });

  if (TOR_ON) {
    tor.start({ useBridges: store.get('useBridges'), customBridges: store.get('customBridges') });
  } else {
    send('tor', { status: 'disabled', progress: 0, message: 'Tor ist aus' });
  }
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => tor.stop());
app.on('web-contents-created', (_e, wc) => {
  // Sicherheitsnetz: niemals Node-Rechte oder <webview> für Webinhalte
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));   // wird für Tabs danach gezielt ersetzt
});

module.exports = { hostOf };
