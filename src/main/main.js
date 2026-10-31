// ImmoAdv Browser – Hauptprozess (Windows & Mac)
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, systemPreferences, nativeTheme, session, clipboard, Tray, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const store = require('./store');
const tor = require('./tor');
const pdf = require('./pdf');
const updater = require('./updater');
const { DIRECT_HOSTS, cleanURL, createBrowsingSession, tabPreferences, hostOf, proxyFor, GOOGLE_DIRECT, GOOGLE_LOGIN_HOSTS } = require('./privacy');
const { LISTING_SCRIPT } = require('../shared/listing');
const { SUMMARY_SCRIPT } = require('../shared/summary');

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
  // Update-Server dürfen lokal aufgelöst werden – wird nur genutzt, wenn ein Update über Tor nicht klappt
  const direct = [...DIRECT_HOSTS, ...updater.UPDATE_HOSTS].map((h) => ` , EXCLUDE ${h}`).join('');
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1' + direct);
}
pdf.registerScheme();
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const CHROME_HEIGHT = 84;      // Tab-Leiste + Adressleiste (wird vom Fenster gemeldet)
let win = null;
let browsingSession = null;
let layout = { top: CHROME_HEIGHT, right: 0, hidden: false };
const tabs = [];
const closedStack = [];     // zuletzt geschlossene Tabs – nur im Arbeitsspeicher                // { id, view, kind: 'web'|'pdf', url, title, filePath, listing }
let activeId = null;

const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const active = () => tabs.find((t) => t.id === activeId);

// ---------- Hintergrund-Modus: Tor bleibt verbunden, das Fenster öffnet sofort ----------
let reallyQuit = false;
let tray = null;
const startedHidden = process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAsHidden);

function applyBackground() {
  const on = store.get('background') !== false;
  if (app.isPackaged) {
    try { app.setLoginItemSettings({ openAtLogin: on, openAsHidden: on, args: on ? ['--hidden'] : [] }); } catch { /* egal */ }
  }
  if (on && !tray) {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'emblem.png')).resize({ width: process.platform === 'darwin' ? 18 : 16 });
    tray = new Tray(img);
    tray.setToolTip('ImmoAdv Browser – Tor bereit');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'ImmoAdv Browser öffnen', click: () => showWindow() },
      { label: 'Neue Identität', click: () => newIdentity() },
      { type: 'separator' },
      { label: 'Beenden (Tor trennen)', click: () => { reallyQuit = true; app.quit(); } }
    ]));
    tray.on('click', () => showWindow());
  } else if (!on && tray) { tray.destroy(); tray = null; }
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  warmFavorites();
}

// Fenster schließen = alles vergessen wie bisher, nur Tor läuft weiter
async function hideAndWipe() {
  win.hide();
  for (const t of tabs.splice(0)) { try { win.contentView.removeChildView(t.view); t.view.webContents.close(); } catch {} }
  closedStack.length = 0;
  const old = browsingSession;
  browsingSession = await createBrowsingSession(TOR_ON, tor.socksPort);
  wireDownloads(browsingSession);
  try { await old.clearStorageData(); await old.clearCache(); old.closeAllConnections(); } catch {}
  newTab();
  if (!store.get('trayHintShown') && tray && process.platform === 'win32') {
    store.set('trayHintShown', true);
    tray.displayBalloon({ title: 'ImmoAdv Browser', content: 'Läuft im Hintergrund weiter, damit Tor sofort verbunden ist. Alle Seiten und Daten wurden gelöscht.' });
  }
}

// Vorab verbinden: häufige Seiten und Lesezeichen sind beim Klick schon „warm“
let warmTimer = null;
function preconnect(origin) {
  if (!browsingSession || (TOR_ON && tor.state.status !== 'connected')) return;
  try { browsingSession.preconnect({ url: origin, numSockets: 1 }); } catch { /* ungültig */ }
}
function warmFavorites() {
  if (TOR_ON && tor.state.status !== 'connected') return;
  const urls = [...(store.get('bookmarks') || []).map((b) => b.url), ...(store.get('frequent') || []).slice(0, 6).map((f) => f.url)];
  const origins = [...new Set(urls.map((u) => { try { return new URL(u).origin; } catch { return null; } }).filter(Boolean))].slice(0, 8);
  origins.forEach((o, i) => setTimeout(() => preconnect(o), i * 150));
  clearInterval(warmTimer);
  warmTimer = setInterval(() => { if (win && win.isVisible()) warmFavorites(); }, 4 * 60 * 1000);
}

// ---------- Fenster ----------
async function createWindow() {
  win = new BrowserWindow({
    show: !startedHidden,
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
  win.on('close', (e) => {
    if (reallyQuit || store.get('background') === false) return;
    e.preventDefault();
    hideAndWipe();
  });
  newTab();
}

// ---------- Tabs ----------
function makeView(kind) {
  const prefs = kind === 'pdf'
    ? { session: pdf.getSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
    : tabPreferences(browsingSession);
  const view = new WebContentsView({ webPreferences: prefs });
  view.setBackgroundColor('#ffffff');
  if (typeof view.setBorderRadius === 'function') view.setBorderRadius(14);
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
    tab.captcha = TOR_ON && /^https:\/\/(www\.|ipv4\.)?google\.[a-z.]+\/sorry\//.test(url);
    if (!/^https:\/\/accounts\.google\./.test(url)) tab.lastSiteUrl = url;   // Seite, von der die Anmeldung kam
    update();
    rememberVisit(url, wc);
  });
  wc.on('did-navigate-in-page', update);
  wc.on('found-in-page', (_e, r) => { if (tab.id === activeId) send('find-result', { active: r.activeMatchOrdinal, total: r.matches }); });
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
      // wie am iPhone: Anmeldung automatisch im Standard-Browser fortsetzen, hier zurück zur Seite
      if (tab.googleBlocked && !tab.handedOff) {
        tab.handedOff = true;
        openExternal(tab);
        send('toast', 'Google lässt die Anmeldung nur im normalen Browser zu – dort geöffnet');
        if (tab.lastSiteUrl) setTimeout(() => { tab.handedOff = false; load(tab, tab.lastSiteUrl); }, 800);
      }
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
  // Solange Tor noch verbindet: Seite merken und automatisch öffnen, sobald die Verbindung steht
  if (tab.kind === 'web' && TOR_ON && tor.state.status !== 'connected') {
    tab.waiting = true; tab.pendingUrl = url;
    positionViews(); pushTabs();
    return;
  }
  tab.waiting = false; tab.pendingUrl = null;
  tab.view.webContents.loadURL(url).catch(() => {});
  positionViews();
}

function flushWaiting() {
  for (const t of tabs) if (t.waiting && t.pendingUrl) load(t, t.pendingUrl);
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  if (t.kind === 'web' && t.url) { closedStack.push(t.url); if (closedStack.length > 20) closedStack.shift(); }
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
    const show = t.id === activeId && !layout.hidden && !!t.url && !t.waiting;
    t.view.setVisible(show);
    // Webseite als schwebende Karte mit runden Ecken auf dem ImmoAdv-Fade
    const G = 8;
    if (show) t.view.setBounds({ x: G, y: layout.top, width: Math.max(0, w - layout.right - G * 2), height: Math.max(0, h - layout.top - G) });
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
        loading: !!t.loading, waiting: !!t.waiting, zoom: t.zoom || 0, error: t.error || null, listing: t.listing || null, googleBlocked: !!t.googleBlocked, captcha: !!t.captcha,
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
  if (input.shift && k === 't') { e.preventDefault(); reopenTab(); return; }
  if (input.shift && k === 'b') { e.preventDefault(); send('toggle-bookmarkbar'); return; }
  const map = {
    f: () => { win.webContents.focus(); send('find-open'); },
    k: () => { win.webContents.focus(); send('palette-open'); },
    j: () => { win.webContents.focus(); send('open-panel', 'summary'); },
    '+': () => zoom(t, 0.5), '=': () => zoom(t, 0.5), '-': () => zoom(t, -0.5), '0': () => zoom(t, null),
    t: () => newTab(), w: () => t && closeTab(t.id), l: () => { win.webContents.focus(); send('focus-address'); },
    r: () => t?.view.webContents.reload(), s: () => t?.kind === 'pdf' && savePDF(t),
    '[': () => t?.view.webContents.navigationHistory.goBack(), ']': () => t?.view.webContents.navigationHistory.goForward()
  };
  if (map[k]) { e.preventDefault(); map[k](); }
}

function zoom(t, step) {
  if (!t) return;
  t.zoom = step === null ? 0 : Math.max(-3, Math.min(4, (t.zoom || 0) + step));
  t.view.webContents.setZoomLevel(t.zoom);
  send('toast', `Zoom ${Math.round(Math.pow(1.2, t.zoom) * 100)} %`);
  pushTabs();
}

function reopenTab() {
  const url = closedStack.pop();
  if (url) newTab(url); else send('toast', 'Kein geschlossener Tab');
}

// Häufig besuchte Seiten: nur Adresse und Titel, nur auf diesem Computer, nie weitergegeben
function rememberVisit(url, wc) {
  if (!store.get('rememberFrequent')) return;
  let u; try { u = new URL(url); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || /(^|\.)google\.|duckduckgo|startpage\./.test(u.hostname)) return;
  const key = u.origin;
  const list = store.get('frequent') || [];
  const item = list.find((x) => x.key === key);
  if (item) { item.count++; item.last = Date.now(); item.title = wc.getTitle() || item.title; }
  else list.push({ key, url: u.origin + '/', title: wc.getTitle() || u.hostname.replace(/^www\./, ''), count: 1, last: Date.now() });
  list.sort((a, b) => b.count - a.count);
  store.set('frequent', list.slice(0, 40));
  send('frequent', store.get('frequent').slice(0, 8));
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
  handle('update:log', () => { const f = updater.logPath(); if (fs.existsSync(f)) shell.showItemInFolder(f); return fs.existsSync(f); });
  handle('state', () => ({
    update: updater.state(), version: app.getVersion(),
    settings: store.all(), tor: tor.state, platform: process.platform,
    frequent: (store.get('frequent') || []).slice(0, 8),
    watchlist: store.get('watchlist') || [],
    downloadDirName: store.get('downloadDir') ? path.basename(store.get('downloadDir')) : null
  }));
  on('layout', (_e, l) => { layout = { ...layout, ...l }; positionViews(); });
  on('find', (_e, { text, forward, next }) => {
    const t = active(); if (!t || !text) return;
    t.view.webContents.findInPage(text, { forward: forward !== false, findNext: !!next });
  });
  on('find-stop', () => { const t = active(); if (t) t.view.webContents.stopFindInPage('clearSelection'); });
  on('zoom', (_e, step) => zoom(active(), step));
  on('reopen-tab', () => reopenTab());
  handle('summary', async () => {
    const t = active();
    if (!t || t.kind !== 'web' || !t.url || t.waiting) return null;
    try { return await t.view.webContents.executeJavaScriptInIsolatedWorld(1003, [{ code: SUMMARY_SCRIPT }]); } catch { return null; }
  });
  // Merkliste – nur auf diesem Computer
  handle('watch:add', (_e, item) => {
    const list = (store.get('watchlist') || []).filter((w) => w.url !== item.url);
    list.unshift({ ...item, id: crypto.randomUUID(), added: Date.now() });
    store.set('watchlist', list.slice(0, 50));
    return store.get('watchlist');
  });
  handle('watch:remove', (_e, id) => { store.set('watchlist', (store.get('watchlist') || []).filter((w) => w.id !== id)); return store.get('watchlist'); });
  handle('link:copy', () => {
    const t = active();
    if (!t || t.kind !== 'web' || !t.url) return false;
    clipboard.writeText(cleanURL(t.url));
    return true;
  });
  handle('screenshot', async () => {
    const t = active();
    if (!t || !t.url) return null;
    const img = await t.view.webContents.capturePage();
    const name = `Bildschirmfoto ${hostOf(t.url) || 'Seite'} ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-')}.png`;
    const target = uniquePath(downloadDir(), name);
    fs.writeFileSync(target, img.toPNG());
    return path.basename(downloadDir());
  });
  handle('frequent:clear', () => { store.set('frequent', []); send('frequent', []); return true; });
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
  // „Ich bin kein Roboter“: neue Tor-Route nur für einen frischen Versuch – Ziel-Seite neu laden
  on('new-route', async () => {
    const t = active();
    if (!t) return;
    const ok = await tor.newIdentity();
    const target = (() => { try { return new URL(t.url).searchParams.get('continue') || t.url; } catch { return t.url; } })();
    t.captcha = false;
    setTimeout(() => load(t, target), ok ? 1200 : 0);
    send('toast', ok ? 'Neue Tor-Route – Seite lädt neu' : 'Tor-Route konnte nicht gewechselt werden');
  });
  handle('youtube-direct', async (_e, on) => {
    store.set('youtubeDirect', !!on);
    app.relaunch(); app.exit(0);
  });
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
    const allowed = ['torEnabled', 'useBridges', 'customBridges', 'blockTrackers', 'httpsOnly', 'javaScript', 'appLock', 'bookmarks', 'googleDirect', 'rememberFrequent', 'bookmarkBar', 'cleanLinks', 'youtubeDirect', 'updateFallback', 'background', 'searchEngine'];
    for (const k of Object.keys(obj)) if (allowed.includes(k)) store.set(k, obj[k]);
    if ('background' in obj) applyBackground();
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
  const engine = store.get('searchEngine') || 'duckduckgo';
  if (engine === 'google') return `https://www.google.com/search?q=${q}&hl=de`;
  if (engine === 'startpage') return `https://www.startpage.com/do/search?q=${q}&language=deutsch`;
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
    { label: 'Auf Seite suchen …', accelerator: 'CmdOrCtrl+F', click: () => send('find-open') },
    { label: 'Geschlossenen Tab wieder öffnen', accelerator: 'CmdOrCtrl+Shift+T', enabled: closedStack.length > 0, click: () => reopenTab() },
    { label: 'Zoom', submenu: [
      { label: 'Vergrößern', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(active(), 0.5) },
      { label: 'Verkleinern', accelerator: 'CmdOrCtrl+-', click: () => zoom(active(), -0.5) },
      { label: 'Originalgröße', accelerator: 'CmdOrCtrl+0', click: () => zoom(active(), null) }
    ] },
    { label: 'Lesezeichenleiste ein/aus', accelerator: 'CmdOrCtrl+Shift+B', click: () => send('toggle-bookmarkbar') },
    { label: 'Zusammenfassen', accelerator: 'CmdOrCtrl+J', enabled: t?.kind === 'web' && !!t.url, click: () => send('open-panel', 'summary') },
    { label: 'Merkliste & Vergleich', click: () => send('open-panel', 'watch') },
    { label: 'Bildschirmfoto der Seite', enabled: !!t?.url, click: () => send('screenshot') },
    { label: 'Schnellbefehle …', accelerator: 'CmdOrCtrl+K', click: () => send('palette-open') },
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
  applyBackground();
  // Link-Vorschau: fährt mit der Maus über einen Link, wird die Verbindung zu dieser Seite schon aufgebaut
  let pcCount = 0; setInterval(() => { pcCount = 0; }, 60000);
  ipcMain.on('preconnect', (e, origin) => {
    if (!tabs.some((t) => t.view.webContents === e.sender) || ++pcCount > 30) return;
    if (typeof origin === 'string' && /^https?:\/\/[^/]+$/.test(origin)) preconnect(origin);
  });

  // Standard-Sitzung (Fenster, interne Anfragen): kein direkter Netzverkehr
  const def = session.defaultSession;
  def.setSpellCheckerEnabled(false);
  if (TOR_ON) await def.setProxy(proxyFor(0));
  def.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^(https?|wss?|ftp):/i.test(d.url) }));

  browsingSession = await createBrowsingSession(TOR_ON, 0);
  wireDownloads(browsingSession);
  // sobald Tor seinen Port meldet, wird er als Proxy gesetzt
  tor.on('socks', (port) => { browsingSession.setProxy(proxyFor(port)); });
  tor.on('state', (s) => { send('tor', s); if (s.status === 'connected') { flushWaiting(); warmFavorites(); } });
  // Tor so früh wie möglich starten – parallel zum Aufbau des Fensters
  if (TOR_ON) tor.start({ useBridges: store.get('useBridges'), customBridges: store.get('customBridges') });
  await createWindow();

  updater.init({
    onState: (s) => send('update', s),
    downloadDir: () => downloadDir(),
    torOn: TOR_ON,
    // Update-Suche erst, wenn Tor verbunden ist (läuft dann ebenfalls über Tor)
    whenTorReady: (cb) => {
      const go = () => cb(tor.socksPort);
      if (tor.state.status === 'connected') return go();
      const h = (s) => { if (s.status === 'connected') { tor.off('state', h); go(); } };
      tor.on('state', h);
    }
  });

  if (!TOR_ON) send('tor', { status: 'disabled', progress: 0, message: 'Tor ist aus' });
});

app.on('second-instance', () => showWindow());
app.on('activate', () => showWindow());
app.on('window-all-closed', () => app.quit());
let torStopped = false;
app.on('before-quit', (e) => {
  reallyQuit = true;
  if (torStopped || !tor.proc) return;
  e.preventDefault();
  torStopped = true;
  tor.stopGracefully().finally(() => app.quit());
});
app.on('web-contents-created', (_e, wc) => {
  // Sicherheitsnetz: niemals Node-Rechte oder <webview> für Webinhalte
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));   // wird für Tabs danach gezielt ersetzt
});

module.exports = { hostOf };
