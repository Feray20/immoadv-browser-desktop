// ImmoAdv Browser 3 – Hauptprozess (Windows & Mac). Eigener Browser auf Chromium-Basis (Electron).
// Tabs, Arbeitsbereiche, geteilte Ansicht, Verlauf, Lesezeichen, Passwörter, NordVPN, Blocker, KI-Assistent, Updates.
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, systemPreferences, nativeTheme, session, clipboard, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const store = require('./store');
const pdf = require('./pdf');
const updater = require('./updater');
const blocker = require('./blocker');
const vpn = require('./vpn');
const vault = require('./vault');
const history = require('./history');
const ai = require('./ai');
const { cleanURL, createBrowsingSession, tabPreferences, hostOf, startupCleanup, siteLeft } = require('./privacy');
const { cleanDomain, siteOf } = require('../shared/lists');
const { LISTING_SCRIPT } = require('../shared/listing');
const { SUMMARY_SCRIPT } = require('../shared/summary');
const { parseBookmarksHTML, bookmarksHTML } = require('../shared/bookmarks');

// ---------- Grundschutz vor dem Start ----------
app.setName('ImmoAdv Browser');
if (process.platform === 'win32') app.setAppUserModelId('de.immoadv.browser.desktop');
app.commandLine.appendSwitch('disable-features', 'InterestFeedContentSuggestions,MediaRouter,DialMediaRouteProvider,AutofillServerCommunication,OptimizationHints');
pdf.registerScheme();
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---------- Als Standardbrowser: Links und Dateien von Windows/Mac öffnen ----------
const pendingOpen = [];      // vor dem Start übergebene Adressen/Dateien
function openTargets(list) {
  const items = (list || []).map((a) => String(a || '').trim()).filter(Boolean);
  for (const a of items) {
    if (/^https?:\/\//i.test(a)) { if (needsChrome(a)) { openInChrome(a); continue; } if (win) newTab(a); else pendingOpen.push(a); continue; }
    const file = a.replace(/^file:\/\//i, '');
    if (!/\.(pdf|html?)$/i.test(file) || !fs.existsSync(file)) continue;
    if (!win) { pendingOpen.push(file); continue; }
    if (/\.pdf$/i.test(file)) openPDF(file);
    else newTab(require('node:url').pathToFileURL(file).href, { localFile: true });
  }
  if (win && items.length) showWindow();
}
const argvTargets = (argv) => (argv || []).slice(1).filter((a) => /^https?:\/\//i.test(a) || /\.(pdf|html?)$/i.test(a));
pendingOpen.push(...argvTargets(process.argv));
app.on('open-url', (e, url) => { e.preventDefault(); openTargets([url]); });      // Mac: Link aus anderer App
app.on('open-file', (e, file) => { e.preventDefault(); openTargets([file]); });  // Mac: HTML/PDF-Datei

// ---------- Google-Konto: Google lässt die Anmeldung nur in Chrome/Edge/Firefox/Safari zu ----------
// Gmail, Drive, Kalender und die Google-Anmeldung öffnen deshalb automatisch in Chrome (dort bist du angemeldet).
const GOOGLE_ACCOUNT = /^https:\/\/(accounts|mail|drive|docs|sheets|slides|calendar|myaccount|photos|contacts|keep|meet|chat|admin|takeout|passwords|myactivity|pay|one)\.google\.[a-z.]+(\/|$)/i;
const needsChrome = (url) => store.get('googleExternal') !== false && GOOGLE_ACCOUNT.test(String(url || ''));
function chromePath() {
  if (process.platform === 'darwin') return null;
  const env = process.env;
  const c = [
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];
  return c.find((p) => p && fs.existsSync(p)) || null;
}
let lastChrome = { url: '', at: 0 };
function openInChrome(url) {
  if (lastChrome.url === url && Date.now() - lastChrome.at < 3000) return;   // Doppelklicks/Weiterleitungen
  lastChrome = { url, at: Date.now() };
  const { spawn } = require('node:child_process');
  try {
    if (process.platform === 'darwin') {
      spawn('open', ['-a', 'Google Chrome', url], { detached: true, stdio: 'ignore' })
        .on('exit', (code) => { if (code) spawn('open', ['-a', 'Safari', url], { detached: true, stdio: 'ignore' }).unref(); }).unref();
    } else {
      const exe = chromePath();
      if (!exe) { send('toast', 'Google-Konto: bitte Chrome oder Edge installieren – Google erlaubt die Anmeldung nur dort'); return; }
      spawn(exe, [url], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    }
    send('toast', 'Google-Konto in Chrome geöffnet – Google erlaubt die Anmeldung nur dort');
  } catch { send('toast', 'Chrome konnte nicht geöffnet werden'); }
}

function isDefaultBrowser() {
  try { return app.isDefaultProtocolClient('https') && app.isDefaultProtocolClient('http'); } catch { return false; }
}
async function makeDefaultBrowser() {
  if (process.platform === 'darwin') {
    // macOS fragt selbst nach („ImmoAdv Browser als Standard-Webbrowser verwenden?“)
    app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https');
    return { ok: true, how: 'mac' };
  }
  // Windows erlaubt Programmen das Umstellen nicht selbst – öffnet die richtige Seite in den Einstellungen
  await shell.openExternal('ms-settings:defaultapps?registeredAppUser=' + encodeURIComponent('ImmoAdv Browser')).catch(() => shell.openExternal('ms-settings:defaultapps'));
  return { ok: true, how: 'windows' };
}

// Verschlüsseltes DNS (DNS-over-HTTPS) – mit NordVPN löst ohnehin der VPN-Server auf
const DNS = {
  quad9: { name: 'Quad9 (Schweiz)', url: 'https://dns.quad9.net/dns-query' },
  mullvad: { name: 'Mullvad (Schweden)', url: 'https://dns.mullvad.net/dns-query' },
  cloudflare: { name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  google: { name: 'Google', url: 'https://dns.google/dns-query' },
  system: { name: 'System-DNS (unverschlüsselt)', url: null }
};
function applyDNS() {
  const d = DNS[store.get('dnsProvider')] || DNS.quad9;
  try { app.configureHostResolver(d.url ? { secureDnsMode: 'secure', secureDnsServers: [d.url] } : { secureDnsMode: 'off' }); }
  catch (e) { console.error('DNS', e); }
}

let win = null;
let browsingSession = null;
let layout = { top: 84, left: 0, right: 0, hidden: false };
const tabs = [];            // { id, ws, pinned, kind: 'web'|'pdf', view|null (schläft), url, title, filePath, lastActive, … }
const closedStack = [];     // zuletzt geschlossene Tabs – nur im Arbeitsspeicher
const pwPending = new Map(); // Tab-ID → { url, user, pass, at } bis zur Entscheidung „Speichern?“
const wsActive = new Map(); // Arbeitsbereich → zuletzt aktiver Tab
const downloads = [];       // Downloads dieser Sitzung
let activeId = null;
let split = null;           // { a, b } – zwei Tabs nebeneinander

const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const active = () => tabs.find((t) => t.id === activeId);
const wcOf = (t) => (t && t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null);
const activeWs = () => {
  const ws = store.get('workspaces') || [];
  return ws.some((w) => w.id === store.get('activeWorkspace')) ? store.get('activeWorkspace') : (ws[0] && ws[0].id) || 'privat';
};

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

// Vorab verbinden: Lesezeichen sind beim Klick schon „warm“
function preconnect(origin) {
  if (!browsingSession) return;
  try { browsingSession.preconnect({ url: origin, numSockets: 1 }); } catch { /* ungültig */ }
}
function warmFavorites() {
  const urls = (store.get('bookmarks') || []).filter((b) => !b.folder).map((b) => b.url);
  const origins = [...new Set(urls.map((u) => { try { return new URL(u).origin; } catch { return null; } }).filter(Boolean))].slice(0, 8);
  origins.forEach((o, i) => setTimeout(() => preconnect(o), i * 150));
}

// ---------- Fenster ----------
async function createWindow() {
  win = new BrowserWindow({
    show: false,
    width: 1360, height: 880, minWidth: 760, minHeight: 520,
    title: 'ImmoAdv Browser',
    backgroundColor: '#0A1628',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 13 }, vibrancy: 'under-window', visualEffectState: 'active' }
      : { titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 40 } }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'chrome-preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (e, input) => handleShortcut(e, input));
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore']) win.on(ev, positionViews);
  win.on('close', () => saveSession(true));
  win.on('closed', () => { win = null; });
  win.once('ready-to-show', () => { win.show(); warmFavorites(); });
  const restored = restoreSession();
  if (pendingOpen.length) openTargets(pendingOpen.splice(0));
  else if (!restored) newTab();
}

// ---------- Tabs ----------
function makeView(kind) {
  const prefs = kind === 'pdf'
    ? { session: pdf.getSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
    : tabPreferences(browsingSession);
  const view = new WebContentsView({ webPreferences: prefs });
  view.setBackgroundColor('#ffffff');
  if (typeof view.setBorderRadius === 'function') view.setBorderRadius(12);
  return view;
}

function wireView(tab) {
  const wc = tab.view.webContents;
  // WebRTC: mit VPN nur über das VPN, sonst keine lokalen IP-Adressen preisgeben
  if (tab.kind === 'web') wc.setWebRTCIPHandlingPolicy(vpn.active() ? 'disable_non_proxied_udp' : 'default_public_interface_only');

  // Neue Fenster → neuer Tab im selben Arbeitsbereich (keine Pop-ups)
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (needsChrome(url)) { openInChrome(url); return { action: 'deny' }; }
    if (/^https?:/i.test(url)) newTab(url, { ws: tab.ws, background: disposition === 'background-tab' });
    return { action: 'deny' };
  });
  // Nur Webadressen – keine Programme oder lokalen Dateien aus Webseiten heraus öffnen
  // lokale HTML-Datei (vom System geöffnet): nur diese eine Datei, Links daraus nur ins Web
  const allowed = (url) => (tab.kind === 'pdf' ? url.startsWith('immoadv-pdf:') : /^https?:/i.test(url) || (tab.localFile && url === tab.localFile));
  const toChrome = (e, url) => { if (tab.kind === 'web' && needsChrome(url)) { e.preventDefault(); openInChrome(url); return true; } return false; };
  wc.on('will-navigate', (e, url) => { if (toChrome(e, url)) return; if (!allowed(url)) e.preventDefault(); });
  wc.on('will-redirect', (e, url) => { if (toChrome(e, url)) return; if (!allowed(url)) e.preventDefault(); });
  wc.on('will-frame-navigate', (e) => { if (!allowed(e.url) && !/^(about|blob|data):/i.test(e.url)) e.preventDefault(); });

  const update = () => {
    if (wc.isDestroyed()) return;
    if (tab.kind !== 'pdf') tab.url = wc.getURL();
    tab.title = wc.getTitle() || tab.title;
    if (tab.kind === 'web') history.setTitle(tab.url, tab.title);
    pushTabs();
  };
  wc.on('page-title-updated', update);
  wc.on('page-favicon-updated', async (_e, icons) => { tab.favicon = await favicon((icons || []).find((u) => /^https:/.test(u))); pushTabs(); });
  wc.on('did-navigate', (_e, url) => {
    tab.listing = null; tab.login = null; tab.blocked = null; tab.favicon = null;
    // Spurlos: Seite im selben Tab verlassen → ihre Daten werden gelöscht, wenn kein Tab sie mehr offen hat
    const site = siteOf(hostOf(url));
    if (tab.site && tab.site !== site) siteLeft(browsingSession, tab.site, siteOpen);
    tab.site = site;
    update();
    if (tab.kind === 'web') history.add(url, wc.getTitle());
  });
  wc.on('did-navigate-in-page', (_e, url, isMain) => { update(); if (isMain && tab.kind === 'web') history.add(url, wc.getTitle()); });
  wc.on('found-in-page', (_e, r) => { if (tab.id === activeId) send('find-result', { active: r.activeMatchOrdinal, total: r.matches }); });
  wc.on('did-start-loading', () => { tab.loading = true; tab.error = null; pushTabs(); });
  wc.on('did-stop-loading', () => { tab.loading = false; pushTabs(); });
  wc.on('media-started-playing', () => { tab.audible = true; pushTabs(); });
  wc.on('media-paused', () => { tab.audible = wc.isCurrentlyAudible(); pushTabs(); });
  wc.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') { tab.error = 'Die Seite ist abgestürzt – „Neu laden“ startet sie neu.'; tab.offlineUrl = null; pushTabs(); } });
  wc.on('did-fail-load', async (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return;   // -3 = abgebrochen
    // vom Blocker gestoppt → Warnseite statt Fehlermeldung
    if (code === -20) {
      const b = blocker.takeBlock(wc.id);
      if (b) { tab.blocked = b; tab.error = null; pushTabs(); positionViews(); return; }
    }
    // kein Internet → Hinweis, lädt automatisch neu, sobald wieder Netz da ist
    if (code === -106 || !net.isOnline()) { tab.error = 'Derzeit keine Internetverbindung'; tab.offlineUrl = url || tab.url; pushTabs(); positionViews(); return; }
    // VPN-Server antwortet nicht → still den nächsten Server nehmen und neu laden
    if ([-130, -111, -115, -127, -336, -337, -21].includes(code) && vpn.state().loggedIn && !tab.vpnRetry) {
      tab.vpnRetry = true;
      if (await vpn.failover()) { setTimeout(() => { tab.vpnRetry = false; load(tab, url || tab.url); }, 300); return; }
    }
    tab.vpnRetry = false;
    if (code === -200 || (code <= -201 && code >= -219)) tab.error = 'Das Sicherheitszertifikat dieser Seite ist ungültig – die Verbindung wurde zu deinem Schutz nicht aufgebaut.';
    else tab.error = `Seite konnte nicht geladen werden – „Neu laden“ hilft oft. (Fehler ${code}${vpn.state().loggedIn ? ', über NordVPN' : ''})`;
    pushTabs();
  });
  // Ungültige Zertifikate werden nie still akzeptiert (Chromium-Standard: abbrechen)
  wc.on('did-finish-load', async () => {
    if (tab.kind !== 'web') return;
    tab.vpnRetry = false;
    const saved = vault.forUrl(wc.getURL());
    tab.login = saved.length ? saved : null;
    try {
      // in einer eigenen, von der Seite getrennten Skript-Welt – die Seite merkt nichts davon
      const l = await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: LISTING_SCRIPT }]);
      tab.listing = l && (l.price || l.rent) ? l : null;
    } catch { tab.listing = null; }
    pushTabs();
  });
  wc.on('before-input-event', (e, input) => handleShortcut(e, input));
  wc.on('context-menu', (_e, p) => pageMenu(tab, p));
}

// Seitensymbole: über die Browser-Sitzung geladen (also auch über NordVPN), klein als data:-Bild an die Oberfläche
const favCache = new Map();
async function favicon(url) {
  if (!url) return null;
  if (favCache.has(url)) return favCache.get(url);
  let data = null;
  try {
    const r = await browsingSession.fetch(url, { credentials: 'omit' });
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (r.ok && /^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|gif|webp)$/.test(type)) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 60000) data = `data:${type};base64,${buf.toString('base64')}`;
    }
  } catch { /* ohne Symbol */ }
  if (favCache.size > 300) favCache.clear();
  favCache.set(url, data);
  return data;
}

function attachView(tab) {
  tab.view = makeView(tab.kind);
  wireView(tab);
  win.contentView.addChildView(tab.view);
  tab.suspended = false;
}

function newTab(url, opts = {}) {
  const kind = opts.kind || 'web';
  const tab = {
    id: crypto.randomUUID(), ws: opts.ws || activeWs(), pinned: !!opts.pinned, kind, view: null,
    url: url || '', title: opts.title || (url ? hostOf(url) : 'Startseite'), filePath: opts.filePath || null, lastActive: Date.now()
  };
  if (opts.localFile && url) tab.localFile = url;
  if (opts.suspended) tab.suspended = true; else attachView(tab);
  const at = opts.index != null ? opts.index : tabs.length;
  tabs.splice(at, 0, tab);
  if (!opts.background) { activeId = tab.id; wsActive.set(tab.ws, tab.id); if (tab.ws !== activeWs()) store.set('activeWorkspace', tab.ws); }
  if (url && !opts.suspended) load(tab, url);
  positionViews(); pushTabs();
  return tab;
}

function load(tab, url) {
  if (tab.kind === 'web' && needsChrome(url)) { openInChrome(url); if (!tab.url) pushTabs(); return; }
  if (!tab.view) attachView(tab);
  tab.url = url;
  tab.error = null; tab.blocked = null; tab.offlineUrl = null;
  tab.view.webContents.loadURL(url).catch(() => {});
  positionViews();
}

function selectTab(id) {
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  activeId = id; t.lastActive = Date.now();
  wsActive.set(t.ws, id);
  if (t.ws !== activeWs()) store.set('activeWorkspace', t.ws);
  if (split && split.a !== id && split.b !== id) split = null;
  if (!t.view) { attachView(t); if (t.url) load(t, t.url); }   // schlafender Tab wacht auf
  positionViews(); pushTabs();
}

// Spurlos: ist die Seite noch in einem anderen Tab offen?
const siteOpen = (site) => tabs.some((t) => t.site === site);

// Wieder Internet → Seiten, die nicht laden konnten, still neu laden
let lastOnline = true;
setInterval(() => {
  const on = net.isOnline();
  if (on && !lastOnline) for (const t of tabs) if (t.offlineUrl) { const u = t.offlineUrl; t.offlineUrl = null; t.error = null; load(t, u); }
  lastOnline = on;
  send('online', on);
}, 2000);

// Hintergrund-Tabs schlafen legen (spart Arbeitsspeicher und Akku) – Adresse und Titel bleiben, Klick weckt den Tab
setInterval(() => {
  const min = Number(store.get('suspendMinutes')) || 0;
  if (!min) return;
  const limit = Date.now() - min * 60000;
  for (const t of tabs) {
    const wc = wcOf(t);
    if (!wc || t.kind !== 'web' || t.id === activeId || (split && (split.a === t.id || split.b === t.id))) continue;
    if (t.lastActive > limit || wc.isCurrentlyAudible() || pwPending.has(t.id) || !t.url) continue;
    suspend(t);
  }
}, 60000);

function suspend(t) {
  if (!t.view) return;
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  t.view = null; t.suspended = true; t.loading = false;
  pushTabs();
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  if (t.kind === 'web' && t.url) { closedStack.push({ url: t.url, ws: t.ws }); if (closedStack.length > 25) closedStack.shift(); }
  pwPending.delete(t.id);
  if (t.view) { win.contentView.removeChildView(t.view); t.view.webContents.close(); }
  if (t.site) siteLeft(browsingSession, t.site, siteOpen);
  if (split && (split.a === id || split.b === id)) split = null;
  if (activeId === id) {
    const same = tabs.filter((x) => x.ws === t.ws);
    if (!same.length) return newTab(undefined, { ws: t.ws });
    const next = same.reduce((a, b) => (b.lastActive > a.lastActive ? b : a));
    return selectTab(next.id);
  }
  positionViews(); pushTabs();
}

function positionViews() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const a = active();
  const pair = split && a && (split.a === a.id || split.b === a.id) ? [split.a, split.b] : [activeId];
  const G = 8;
  const x0 = layout.left + G, width = Math.max(0, w - layout.left - layout.right - G * 2), height = Math.max(0, h - layout.top - G);
  for (const t of tabs) {
    if (!t.view) continue;
    const idx = pair.indexOf(t.id);
    const show = idx >= 0 && !layout.hidden && !!t.url && !t.blocked && !t.error;
    t.view.setVisible(show);
    if (!show) continue;
    if (pair.length === 2) {
      const half = Math.floor((width - G) / 2);
      t.view.setBounds({ x: x0 + idx * (half + G), y: layout.top, width: half, height });
    } else t.view.setBounds({ x: x0, y: layout.top, width, height });
  }
}

let pushTimer = null;
function pushTabs() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; pushNow(); saveSession(); }, 16);
}
function pushNow() {
  const now = Date.now();
  for (const [id, p] of pwPending) if (now - p.at > 3 * 60000) pwPending.delete(id);
  send('tabs', {
    activeId, activeWs: activeWs(), workspaces: store.get('workspaces') || [], split,
    tabs: tabs.map((t) => {
      const wc = wcOf(t);
      const pw = pwPending.get(t.id);
      return {
        id: t.id, ws: t.ws, pinned: !!t.pinned, kind: t.kind, title: t.title, url: t.kind === 'pdf' ? '' : t.url, favicon: t.favicon || null,
        fileName: t.filePath ? path.basename(t.filePath) : null, suspended: !!t.suspended, audible: !!t.audible,
        loading: !!t.loading, zoom: t.zoom || 0, error: t.error || null, listing: t.listing || null,
        blocked: t.blocked || null, login: t.login ? t.login.map(({ id, user }) => ({ id, user })) : null,
        pwOffer: pw ? { user: pw.user, site: siteOf(hostOf(pw.url)), update: pw.update } : null,
        canGoBack: wc ? wc.navigationHistory.canGoBack() : false, canGoForward: wc ? wc.navigationHistory.canGoForward() : false
      };
    })
  });
}

// ---------- Sitzung: offene Tabs beim nächsten Start wieder da ----------
let sessionTimer = null;
function saveSession(now = false) {
  clearTimeout(sessionTimer);
  const doSave = () => {
    if (store.get('restoreSession') === false) return store.get('lastSession') && store.set('lastSession', null);
    const list = tabs.filter((t) => t.kind === 'web' && /^https?:/.test(t.url)).map((t) => ({ url: t.url, title: t.title, ws: t.ws, pinned: !!t.pinned, active: t.id === activeId }));
    store.set('lastSession', { tabs: list.slice(0, 80), activeWs: activeWs() });
  };
  if (now) doSave(); else sessionTimer = setTimeout(doSave, 1500);
}
function restoreSession() {
  const s = store.get('lastSession');
  if (store.get('restoreSession') === false || !s || !Array.isArray(s.tabs) || !s.tabs.length) return false;
  const known = new Set((store.get('workspaces') || []).map((w) => w.id));
  let act = null;
  for (const t of s.tabs) {
    const ws = known.has(t.ws) ? t.ws : activeWs();
    // nur der aktive Tab lädt sofort – die anderen schlafen, bis sie angeklickt werden (schneller Start)
    const tab = newTab(t.url, { ws, pinned: t.pinned, title: t.title, suspended: true, background: true });
    if (t.active) act = tab;
  }
  const first = act || tabs.find((t) => t.ws === activeWs()) || tabs[0];
  if (first) selectTab(first.id);
  return tabs.length > 0;
}

// ---------- Arbeitsbereiche ----------
function selectWorkspace(id) {
  if (!(store.get('workspaces') || []).some((w) => w.id === id)) return;
  store.set('activeWorkspace', id);
  split = null;
  const remembered = wsActive.get(id);
  const t = tabs.find((x) => x.id === remembered) || tabs.filter((x) => x.ws === id).sort((a, b) => b.lastActive - a.lastActive)[0];
  if (t) selectTab(t.id); else newTab(undefined, { ws: id });
}

function moveToWorkspace(id, ws) {
  const t = tabs.find((x) => x.id === id);
  if (!t || !(store.get('workspaces') || []).some((w) => w.id === ws)) return;
  const wasActive = t.id === activeId;
  t.ws = ws;
  if (split && (split.a === id || split.b === id)) split = null;
  if (wasActive) { const rest = tabs.filter((x) => x.ws === activeWs()); if (rest.length) selectTab(rest[0].id); else newTab(undefined, { ws: activeWs() }); }
  send('toast', `Tab nach „${(store.get('workspaces').find((w) => w.id === ws) || {}).name}“ verschoben`);
  pushTabs();
}

// Alle Website-Daten löschen (Cookies, Speicher, Zwischenspeicher) – Tabs laden neu
async function clearSiteData() {
  try { await browsingSession.clearStorageData(); await browsingSession.clearCache(); await browsingSession.clearAuthCache(); } catch { /* bereits leer */ }
  for (const t of tabs) { const wc = wcOf(t); if (wc && t.kind === 'web' && t.url) wc.reload(); }
  send('toast', 'Alle Website-Daten gelöscht – du bist überall abgemeldet');
}

// ---------- Downloads ----------
const reserved = new Set();
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
const pushDownloads = () => send('downloads', downloads.slice(0, 30).map(({ item, ...d }) => d));

function wireDownloads(ses) {
  ses.on('will-download', (_e, item) => {
    const target = uniquePath(downloadDir(), item.getFilename());
    item.setSavePath(target);
    reserved.add(target);
    const d = { id: crypto.randomUUID(), name: path.basename(target), file: target, total: item.getTotalBytes(), received: 0, state: 'progress', scan: null, item };
    downloads.unshift(d); pushDownloads();
    send('toast', `Download gestartet: ${d.name}`);
    item.on('updated', () => { d.received = item.getReceivedBytes(); d.total = item.getTotalBytes(); d.state = item.isPaused() ? 'paused' : 'progress'; pushDownloads(); });
    item.once('done', async (_ev, st) => {
      reserved.delete(target);
      d.item = null;
      if (st !== 'completed') { d.state = 'cancelled'; pushDownloads(); return; }
      d.state = 'scanning'; pushDownloads();
      const scan = await virusScan(target);
      d.scan = scan;
      if (scan === 'threat') {
        try { fs.unlinkSync(target); } catch {}
        d.state = 'threat'; pushDownloads();
        return send('toast', `Virus in „${d.name}“ gefunden – Datei wurde gelöscht`);
      }
      d.state = 'done'; pushDownloads();
      const risky = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|dmg|pkg|app|reg|lnk|hta)$/i.test(target);
      send('toast', risky ? 'Programmdatei gespeichert – nur öffnen, wenn du der Quelle vertraust' : `Gespeichert in „${path.basename(downloadDir())}“${scan === 'clean' ? ' · virengeprüft' : ''}`);
      if (path.extname(target).toLowerCase() === '.pdf') openPDF(target);
    });
  });
}

// Virenprüfung über Microsoft Defender (Windows). Mac: Gatekeeper/XProtect prüfen beim Öffnen.
function virusScan(file) {
  if (process.platform !== 'win32') return Promise.resolve('system');
  const exe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe');
  if (!fs.existsSync(exe)) return Promise.resolve('skipped');
  return new Promise((resolve) => {
    require('node:child_process').execFile(exe, ['-Scan', '-ScanType', '3', '-File', file, '-DisableRemediation'], { windowsHide: true, timeout: 120000 },
      (err) => resolve(!err ? 'clean' : err.code === 2 ? 'threat' : 'skipped'));
  });
}

async function openPDFDialog() {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }], defaultPath: downloadDir() });
  if (!r.canceled && r.filePaths[0]) openPDF(r.filePaths[0]);
}
function openPDF(filePath) { newTab(pdf.viewerURL(filePath), { kind: 'pdf', title: path.basename(filePath), filePath }); }

// ---------- Tastenkürzel (auch wenn der Fokus in einer Webseite liegt) ----------
function handleShortcut(e, input) {
  if (input.type !== 'keyDown') return;
  const mod = process.platform === 'darwin' ? input.meta : input.control;
  const k = input.key.toLowerCase();
  const t = active();
  if (input.key === 'F12' && t) { e.preventDefault(); return devTools(t); }
  if (!mod) {
    if (input.alt && (k === 'arrowleft' || k === 'arrowright') && t) { e.preventDefault(); const wc = wcOf(t); if (wc) k === 'arrowleft' ? wc.navigationHistory.goBack() : wc.navigationHistory.goForward(); }
    return;
  }
  if (k === 'tab') { e.preventDefault(); return cycleTab(input.shift ? -1 : 1); }
  if (/^[1-9]$/.test(k) && !input.shift) {
    e.preventDefault();
    const list = tabs.filter((x) => x.ws === activeWs());
    const target = k === '9' ? list[list.length - 1] : list[Number(k) - 1];
    if (target) selectTab(target.id);
    return;
  }
  const focusUI = (ch, data) => { win.webContents.focus(); send(ch, data); };
  if (input.shift) {
    const sm = {
      t: () => reopenTab(), b: () => send('toggle-bookmarkbar'), a: () => focusUI('open-panel', 'ai'),
      s: () => t && toggleSplit(t.id), i: () => t && devTools(t), delete: () => focusUI('open-panel', 'privacy')
    };
    if (sm[k]) { e.preventDefault(); sm[k](); }
    return;
  }
  const wc = wcOf(t);
  const map = {
    f: () => focusUI('find-open'), k: () => focusUI('palette-open'), j: () => focusUI('open-panel', 'summary'),
    h: () => focusUI('open-panel', 'history'), d: () => focusUI('bookmark-current'), e: () => focusUI('open-panel', 'downloads'),
    '+': () => zoom(t, 0.5), '=': () => zoom(t, 0.5), '-': () => zoom(t, -0.5), '0': () => zoom(t, null),
    t: () => newTab(), n: () => newTab(), w: () => t && closeTab(t.id), l: () => focusUI('focus-address'),
    r: () => wc && wc.reload(), s: () => t?.kind === 'pdf' && savePDF(t), p: () => wc && t.kind === 'web' && wc.print(),
    '[': () => wc && wc.navigationHistory.goBack(), ']': () => wc && wc.navigationHistory.goForward(),
    ',': () => focusUI('open-panel', 'settings')
  };
  if (map[k]) { e.preventDefault(); map[k](); }
}

function cycleTab(dir) {
  const list = tabs.filter((x) => x.ws === activeWs());
  const i = list.findIndex((x) => x.id === activeId);
  if (list.length > 1) selectTab(list[(i + dir + list.length) % list.length].id);
}

function zoom(t, step) {
  const wc = wcOf(t);
  if (!wc) return;
  t.zoom = step === null ? 0 : Math.max(-3, Math.min(4, (t.zoom || 0) + step));
  wc.setZoomLevel(t.zoom);
  send('toast', `Zoom ${Math.round(Math.pow(1.2, t.zoom) * 100)} %`);
  pushTabs();
}

function reopenTab() {
  const c = closedStack.pop();
  if (c) newTab(c.url, { ws: c.ws }); else send('toast', 'Kein geschlossener Tab');
}

function toggleSplit(id) {
  if (split && (split.a === id || split.b === id)) { split = null; positionViews(); pushTabs(); return; }
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  // Partner: anderer zuletzt benutzter Tab im selben Bereich, sonst ein neuer Tab
  let other = tabs.filter((x) => x.ws === t.ws && x.id !== id && x.kind === 'web').sort((a, b) => b.lastActive - a.lastActive)[0];
  if (!other) other = newTab(undefined, { ws: t.ws, background: true });
  if (!other.view) { attachView(other); if (other.url) load(other, other.url); }
  split = { a: id, b: other.id };
  selectTab(id);
  send('toast', 'Geteilte Ansicht – zwei Tabs nebeneinander');
}

function devTools(t) {
  const wc = wcOf(t);
  if (!wc) return;
  if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' });
}

async function savePDF(t) {
  try { await pdf.save(t.view.webContents, t.filePath); send('toast', 'PDF gespeichert'); }
  catch { send('toast', 'Speichern fehlgeschlagen'); }
}

// Seitentext für KI und Vorlesen – nur sichtbarer Text, nie Formularwerte oder Passwörter
const PAGE_TEXT = `(() => {
  const pick = () => {
    const c = [...document.querySelectorAll('article, main, [role="main"]')].sort((a, b) => b.innerText.length - a.innerText.length)[0];
    return c && c.innerText.length > 400 ? c : document.body;
  };
  const el = pick();
  const text = (el ? el.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim();
  const sel = String(getSelection ? getSelection() : '').trim();
  return { text: text.slice(0, 60000), selection: sel.slice(0, 20000), title: document.title, url: location.href, lang: document.documentElement.lang || '' };
})()`;
async function pageText(t) {
  const wc = wcOf(t);
  if (!wc || t.kind !== 'web' || !t.url) return null;
  try { return await wc.executeJavaScriptInIsolatedWorld(1004, [{ code: PAGE_TEXT }]); } catch { return null; }
}

// Passwort in die Seite eintragen – nur auf der Seite, für die es gespeichert wurde
const FILL = (user, pass) => `(() => {
  const vis = (el) => !!(el && el.offsetParent !== null && !el.disabled && !el.readOnly);
  const pw = [...document.querySelectorAll('input[type="password"]')].find(vis);
  const set = (el, v) => { if (!el) return; const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  let u = null;
  const scope = (pw && pw.form) || document;
  const inputs = [...scope.querySelectorAll('input')].filter((i) => vis(i) && !['hidden','password','checkbox','radio','submit','button'].includes(i.type));
  if (pw) { const all = [...scope.querySelectorAll('input')]; const idx = all.indexOf(pw); u = inputs.filter((i) => all.indexOf(i) < idx).pop() || null; }
  u = u || document.querySelector('input[autocomplete="username"], input[type="email"]');
  if (vis(u) && ${JSON.stringify(user)}) set(u, ${JSON.stringify(user)});
  if (pw) set(pw, ${JSON.stringify(pass)});
  return !!(pw || u);
})()`;

// ---------- Kontextmenü auf Webseiten ----------
function pageMenu(tab, p) {
  const wc = wcOf(tab);
  if (!wc) return;
  const items = [];
  if (p.linkURL && /^https?:/i.test(p.linkURL)) {
    items.push({ label: 'Link in neuem Tab öffnen', click: () => newTab(p.linkURL, { ws: tab.ws, background: true }) });
    items.push({ label: 'Link kopieren (ohne Tracking)', click: () => clipboard.writeText(cleanURL(p.linkURL)) });
    items.push({ type: 'separator' });
  }
  if (p.selectionText) {
    const sel = p.selectionText.trim().slice(0, 300);
    items.push({ label: 'Kopieren', role: 'copy' });
    items.push({ label: `„${sel.slice(0, 24)}${sel.length > 24 ? '…' : ''}“ suchen`, click: () => newTab(toURL(sel), { ws: tab.ws }) });
    items.push({ label: 'Mit KI erklären', click: () => { win.webContents.focus(); send('ai-prompt', { text: 'Erkläre mir die markierte Stelle einfach und kurz.', selection: true }); } });
    items.push({ label: 'Mit KI übersetzen', click: () => { win.webContents.focus(); send('ai-prompt', { text: 'Übersetze die markierte Stelle ins Deutsche (falls schon Deutsch: ins Englische).', selection: true }); } });
    items.push({ type: 'separator' });
  }
  if (p.isEditable) items.push({ role: 'undo', label: 'Rückgängig' }, { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einfügen' }, { role: 'selectAll', label: 'Alles auswählen' }, { type: 'separator' });
  if (p.mediaType === 'image' && p.srcURL && /^https?:/.test(p.srcURL)) {
    items.push({ label: 'Bild speichern', click: () => wc.downloadURL(p.srcURL) }, { label: 'Bildadresse kopieren', click: () => clipboard.writeText(p.srcURL) }, { type: 'separator' });
  }
  items.push(
    { label: 'Zurück', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Neu laden', click: () => wc.reload() },
    { label: 'Seite übersetzen', enabled: tab.kind === 'web', click: () => translate(tab) },
    { label: 'Seite vorlesen', enabled: tab.kind === 'web', click: () => send('tts', 'start') },
    { type: 'separator' },
    { label: 'Untersuchen (Entwicklertools)', click: () => { wc.inspectElement(p.x, p.y); } }
  );
  Menu.buildFromTemplate(items).popup({ window: win });
}

function translate(t) {
  if (!t || !/^https?:/.test(t.url)) return;
  load(t, `https://translate.google.com/translate?sl=auto&tl=de&u=${encodeURIComponent(t.url)}`);
}

// ---------- Verbindung zum Fenster ----------
const SETTINGS_KEYS = ['blockAds', 'blockMalware', 'blockPhishing', 'freshLists', 'allowlist', 'blocklist', 'httpsOnly', 'cleanLinks', 'javaScript',
  'dnsProvider', 'keepSignedIn', 'appLock', 'bookmarks', 'rememberFrequent', 'bookmarkBar', 'searchEngine', 'neverSave', 'restoreSession',
  'tabLayout', 'sidebarCollapsed', 'googleExternal', 'suspendMinutes', 'historyDays', 'aiProvider', 'aiModels', 'aiInstructions', 'aiKeepHistory', 'workspaces', 'autoUpdate'];
const PRIVATE_KEYS = ['vpnCreds', 'passwords', 'aiKeys', 'lastSession', 'vpnServers', 'permissions'];

function publicSettings() {
  const s = store.all();
  for (const k of PRIVATE_KEYS) delete s[k];
  return s;
}

function registerIPC() {
  // Nur das eigene Fenster darf Befehle schicken – nie eine Webseite
  const fromUI = (e) => win && e.sender === win.webContents;
  const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (fromUI(e)) fn(e, ...a); });
  const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => (fromUI(e) ? fn(e, ...a) : null));

  // Updates
  handle('update:check', () => updater.check());
  handle('update:now', () => updater.updateNow());
  handle('update:auto', (_e, v) => updater.setAuto(v));
  handle('update:log', () => { const f = updater.logPath(); if (fs.existsSync(f)) shell.showItemInFolder(f); return fs.existsSync(f); });

  handle('state', () => ({
    update: updater.state(), version: app.getVersion(), platform: process.platform,
    settings: publicSettings(), vpn: vpn.state(), countries: vpn.COUNTRIES, blocker: blocker.info(),
    passwords: vault.list(), vaultOk: vault.available(), dns: Object.entries(DNS).map(([id, d]) => ({ id, name: d.name })),
    ai: ai.config(), aiProviders: Object.entries(ai.PROVIDERS).map(([id, p]) => ({ id, name: p.name, model: p.model, needsKey: p.needsKey, keyUrl: p.keyUrl })),
    watchlist: store.get('watchlist') || [], historyCount: history.count(), online: net.isOnline(),
    downloadDirName: path.basename(downloadDir())
  }));
  on('layout', (_e, l) => { layout = { ...layout, ...l }; positionViews(); });

  // Navigation & Tabs
  on('navigate', (_e, input) => { let t = active(); if (!t || t.kind === 'pdf') t = newTab(); load(t, toURL(input)); });
  on('tab:new', (_e, url) => newTab(url ? toURL(url) : undefined));
  on('tab:select', (_e, id) => selectTab(id));
  on('tab:close', (_e, id) => closeTab(id));
  on('tab:pin', (_e, id) => { const t = tabs.find((x) => x.id === id); if (t) { t.pinned = !t.pinned; tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)); pushTabs(); } });
  on('tab:duplicate', (_e, id) => { const t = tabs.find((x) => x.id === id); if (t && t.url && t.kind === 'web') newTab(t.url, { ws: t.ws, index: tabs.indexOf(t) + 1 }); });
  on('tab:move', (_e, id, toId) => {
    const from = tabs.findIndex((x) => x.id === id), to = tabs.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const [t] = tabs.splice(from, 1); tabs.splice(to, 0, t); pushTabs();
  });
  on('tab:toWorkspace', (_e, id, ws) => moveToWorkspace(id, ws));
  on('tab:closeOthers', (_e, id) => { for (const t of tabs.filter((x) => x.id !== id && x.ws === activeWs() && !x.pinned)) closeTab(t.id); });
  on('tab:split', (_e, id) => toggleSplit(id || activeId));
  on('tab:menu', (_e, id) => tabMenu(id));
  handle('tab:preview', async (_e, id) => {
    const t = tabs.find((x) => x.id === id); const wc = wcOf(t);
    if (!wc || !t.url || t.id === activeId) return null;
    try { const img = await wc.capturePage(); return img.isEmpty() ? null : img.resize({ width: 280 }).toDataURL(); } catch { return null; }
  });
  on('nav', (_e, cmd) => {
    const t = active(); const wc = wcOf(t); if (!wc) return;
    ({ back: () => wc.navigationHistory.goBack(), forward: () => wc.navigationHistory.goForward(), reload: () => (t.error && t.url ? load(t, t.url) : wc.reload()), stop: () => wc.stop() })[cmd]?.();
  });
  on('reopen-tab', () => reopenTab());
  on('find', (_e, { text, forward, next }) => { const wc = wcOf(active()); if (wc && text) wc.findInPage(text, { forward: forward !== false, findNext: !!next }); });
  on('find-stop', () => { const wc = wcOf(active()); if (wc) wc.stopFindInPage('clearSelection'); });
  on('zoom', (_e, step) => zoom(active(), step));
  on('translate', () => translate(active()));
  on('devtools', () => { const t = active(); if (t) devTools(t); });
  on('print', () => { const wc = wcOf(active()); if (wc) wc.print(); });
  handle('page:text', async () => pageText(active()));

  // Arbeitsbereiche
  on('ws:select', (_e, id) => selectWorkspace(id));
  handle('ws:save', (_e, list) => {
    if (!Array.isArray(list) || !list.length) return store.get('workspaces');
    const clean = list.slice(0, 12).map((w) => ({ id: String(w.id || crypto.randomUUID()).slice(0, 40), name: String(w.name || 'Bereich').slice(0, 30), color: /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : '#2A5BD7', icon: String(w.icon || '●').slice(0, 2) }));
    const ids = new Set(clean.map((w) => w.id));
    // Bereich entfernt → seine Tabs wandern in den ersten Bereich (nichts geht verloren)
    for (const t of tabs) if (!ids.has(t.ws)) t.ws = clean[0].id;
    store.set('workspaces', clean);
    if (!ids.has(store.get('activeWorkspace'))) store.set('activeWorkspace', clean[0].id);
    pushTabs();
    return clean;
  });

  // Verlauf
  handle('history:search', (_e, f) => history.search(f || {}));
  handle('history:suggest', (_e, q) => {
    const s = String(q || '').toLowerCase().trim();
    if (!s) return [];
    const bm = (store.get('bookmarks') || []).filter((b) => (b.title + ' ' + b.url).toLowerCase().includes(s)).slice(0, 3).map((b) => ({ url: b.url, title: b.title, kind: 'bookmark' }));
    const seen = new Set(bm.map((b) => b.url));
    const open = tabs.filter((t) => t.url && t.id !== activeId && (t.title + ' ' + t.url).toLowerCase().includes(s)).slice(0, 2).map((t) => ({ url: t.url, title: t.title, kind: 'tab', id: t.id }));
    const hist = history.suggest(s, 6).filter((h) => !seen.has(h.url)).map((h) => ({ ...h, kind: 'history' }));
    return [...open, ...bm, ...hist].slice(0, 8);
  });
  handle('history:remove', (_e, ids) => { history.remove(Array.isArray(ids) ? ids : [ids]); return true; });
  handle('history:clear', (_e, range) => { const r = range || {}; history.clear(r.from || 0, r.to || Infinity); return true; });

  // Lesezeichen
  handle('bookmarks:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Lesezeichen importieren (HTML-Datei aus Chrome, Safari, Edge oder Firefox)', properties: ['openFile'], filters: [{ name: 'Lesezeichen', extensions: ['html', 'htm'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const found = parseBookmarksHTML(fs.readFileSync(r.filePaths[0], 'utf8'));
    const list = store.get('bookmarks') || [];
    const have = new Set(list.map((b) => b.url));
    let added = 0;
    for (const b of found) if (!have.has(b.url)) { list.push(b); have.add(b.url); added++; }
    store.set('bookmarks', list);
    return { added, duplicates: found.length - added, bookmarks: list };
  });
  handle('bookmarks:export', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Lesezeichen exportieren', defaultPath: path.join(downloadDir(), 'ImmoAdv-Lesezeichen.html'), filters: [{ name: 'Lesezeichen', extensions: ['html'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, bookmarksHTML(store.get('bookmarks') || []));
    return path.basename(r.filePath);
  });

  // Passwörter
  handle('pw:save', (_e, tabId) => {
    const p = pwPending.get(tabId); if (!p) return false;
    pwPending.delete(tabId);
    const ok = vault.add(p);
    send('toast', ok ? 'Passwort sicher gespeichert' : 'Speichern nicht möglich (Systemverschlüsselung fehlt)');
    const t = tabs.find((x) => x.id === tabId); if (t && t.url) t.login = vault.forUrl(t.url);
    pushTabs();
    return ok;
  });
  handle('pw:dismiss', (_e, tabId, never) => {
    const p = pwPending.get(tabId); pwPending.delete(tabId);
    if (p && never) { const site = siteOf(hostOf(p.url)); store.set('neverSave', [...new Set([...(store.get('neverSave') || []), site])]); }
    pushTabs(); return true;
  });
  handle('pw:fill', async (_e, id) => {
    const t = active(); const wc = wcOf(t);
    if (!wc || t.kind !== 'web') return false;
    const entry = vault.list().find((x) => x.id === id);
    if (!entry || entry.site !== siteOf(hostOf(wc.getURL()))) return false;   // nie auf fremden Seiten
    const c = await vault.credentialsFor(id);
    if (!c) { send('toast', 'Freigabe abgebrochen'); return false; }
    try { return await wc.executeJavaScriptInIsolatedWorld(1005, [{ code: FILL(c.user, c.pass) }]); } catch { return false; }
  });
  handle('pw:list', () => vault.list());
  handle('pw:reveal', async (_e, id) => vault.reveal(id));
  handle('pw:delete', (_e, id) => { vault.remove(id); for (const t of tabs) if (t.url) t.login = vault.forUrl(t.url); pushTabs(); return vault.list(); });
  handle('pw:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Passwörter importieren (CSV aus Apple „Passwörter“, Google, Chrome, Edge, Firefox)', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const res = vault.importCSV(fs.readFileSync(r.filePaths[0], 'utf8'));
    res.passwords = vault.list();
    return res;
  });
  handle('pw:test-unlock', async () => vault.unlock());

  // NordVPN
  handle('vpn:login', async (_e, user, pass) => vpn.login(user, pass));
  handle('vpn:logout', async () => { await vpn.logout(); return vpn.state(); });
  handle('vpn:country', async (_e, code) => { await vpn.setCountry(code); return vpn.state(); });
  handle('vpn:recheck', async () => { const st = await vpn.recheck(); for (const t of tabs) if (t.error && t.url && t.kind === 'web') load(t, t.url); return st; });
  handle('vpn:log', () => { const f = path.join(app.getPath('userData'), 'vpn.log'); if (fs.existsSync(f)) shell.showItemInFolder(f); return fs.existsSync(f); });

  // Schutz
  on('blocked:allow', (_e, id) => { const t = tabs.find((x) => x.id === id); if (t && t.blocked) { blocker.allowOnce(t.blocked.url); load(t, t.blocked.url); } });
  handle('lists:refresh', async () => { await blocker.refresh(true); return blocker.info(); });
  handle('site-data:clear', () => clearSiteData());
  handle('permissions:list', () => store.get('permissions') || {});
  handle('permissions:reset', (_e, site) => { const all = { ...(store.get('permissions') || {}) }; if (site) delete all[site]; else for (const k of Object.keys(all)) delete all[k]; store.set('permissions', all); return all; });

  // KI-Assistent
  handle('ai:config', () => ai.config());
  handle('ai:setKey', (_e, provider, key) => ai.setKey(provider, key));
  handle('ai:ask', async (_e, req) => {
    const t = active();
    let page = null, selection = '';
    if (req.usePage || req.useSelection) {
      const p = await pageText(t);
      if (p) { if (req.usePage) page = p; if (req.useSelection) selection = p.selection; }
    }
    return ai.ask(browsingSession.fetch.bind(browsingSession), { convId: req.convId, question: req.question, page, selection, project: req.project }, (kind, data) => send('ai:' + kind, data));
  });
  on('ai:stop', (_e, id) => ai.stop(id));
  handle('ai:conversations', () => ai.conversations());
  handle('ai:conversation', (_e, id) => ai.conversation(id));
  handle('ai:delete', (_e, id) => { ai.deleteConversation(id); return ai.conversations(); });
  handle('ai:deleteAll', () => { ai.deleteAll(); return []; });
  handle('ai:export', async (_e, id) => {
    const c = ai.conversation(id); if (!c) return null;
    const md = `# ${c.title}\n\n` + c.messages.map((m) => `**${m.role === 'user' ? 'Du' : 'KI'}:**\n\n${m.content}${m.source ? `\n\n_Quelle: [${m.source.title}](${m.source.url})_` : ''}`).join('\n\n---\n\n');
    const target = uniquePath(downloadDir(), `KI-Gespräch ${new Date().toISOString().slice(0, 10)}.md`);
    fs.writeFileSync(target, md);
    return path.basename(downloadDir());
  });

  // Immobilien-Werkzeuge (wie bisher)
  handle('summary', async () => {
    const wc = wcOf(active());
    if (!wc || active().kind !== 'web' || !active().url) return null;
    try { return await wc.executeJavaScriptInIsolatedWorld(1003, [{ code: SUMMARY_SCRIPT }]); } catch { return null; }
  });
  handle('watch:add', (_e, item) => {
    const list = (store.get('watchlist') || []).filter((w) => w.url !== item.url);
    list.unshift({ ...item, id: crypto.randomUUID(), added: Date.now() });
    store.set('watchlist', list.slice(0, 50));
    return store.get('watchlist');
  });
  handle('watch:remove', (_e, id) => { store.set('watchlist', (store.get('watchlist') || []).filter((w) => w.id !== id)); return store.get('watchlist'); });
  handle('link:copy', () => { const t = active(); if (!t || t.kind !== 'web' || !t.url) return false; clipboard.writeText(cleanURL(t.url)); return true; });
  handle('screenshot', async () => {
    const t = active(); const wc = wcOf(t);
    if (!wc || !t.url) return null;
    const img = await wc.capturePage();
    const name = `Bildschirmfoto ${hostOf(t.url) || 'Seite'} ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-')}.png`;
    fs.writeFileSync(uniquePath(downloadDir(), name), img.toPNG());
    return path.basename(downloadDir());
  });
  handle('report:save', async (_e, { html, fileName }) => saveReport(html, fileName));

  // Downloads & PDF
  handle('downloads:list', () => downloads.map(({ item, ...d }) => d));
  on('downloads:show', (_e, id) => { const d = downloads.find((x) => x.id === id); if (d && fs.existsSync(d.file)) shell.showItemInFolder(d.file); });
  on('downloads:open', (_e, id) => { const d = downloads.find((x) => x.id === id); if (d && d.state === 'done' && fs.existsSync(d.file)) shell.openPath(d.file); });
  on('downloads:cancel', (_e, id) => { const d = downloads.find((x) => x.id === id); if (d && d.item) d.item.cancel(); });
  on('downloads:clear', () => { for (let i = downloads.length - 1; i >= 0; i--) if (!downloads[i].item) downloads.splice(i, 1); pushDownloads(); });
  handle('downloadDir:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Download-Ordner wählen', properties: ['openDirectory', 'createDirectory'], defaultPath: app.getPath('documents') });
    if (r.canceled || !r.filePaths[0]) return null;
    store.set('downloadDir', r.filePaths[0]);
    return path.basename(r.filePaths[0]);
  });
  handle('downloadDir:default', () => { store.set('downloadDir', app.getPath('downloads')); return path.basename(app.getPath('downloads')); });
  handle('downloadDir:open', () => shell.openPath(downloadDir()));
  on('pdf:open', () => openPDFDialog());
  on('pdf:save', () => { const t = active(); if (t?.kind === 'pdf') savePDF(t); });

  // Einstellungen
  handle('settings:set', (_e, obj) => {
    for (const k of Object.keys(obj || {})) if (SETTINGS_KEYS.includes(k)) store.set(k, obj[k]);
    if ('dnsProvider' in obj) applyDNS();
    if ('historyDays' in obj) history.prune();
    if ('restoreSession' in obj) saveSession(true);
    if ('blockAds' in obj || 'blockMalware' in obj || 'blockPhishing' in obj || 'freshLists' in obj) blocker.load();
    if ('javaScript' in obj) send('toast', 'Gilt für neu geöffnete Tabs');
    return publicSettings();
  });
  on('menu', () => showMenu());
  handle('default:status', () => isDefaultBrowser());
  handle('default:set', () => makeDefaultBrowser());
}

function toURL(input) {
  const s = String(input || '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^\s/]+\.[a-z0-9-]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  const q = encodeURIComponent(s);
  const engine = store.get('searchEngine') || 'google';
  if (engine === 'duckduckgo') return `https://duckduckgo.com/?q=${q}&kl=de-de`;
  if (engine === 'startpage') return `https://www.startpage.com/do/search?q=${q}&language=deutsch`;
  if (engine === 'bing') return `https://www.bing.com/search?q=${q}&setlang=de`;
  if (engine === 'ecosia') return `https://www.ecosia.org/search?q=${q}`;
  return `https://www.google.com/search?q=${q}&hl=de`;
}

function tabMenu(id) {
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  const ws = store.get('workspaces') || [];
  Menu.buildFromTemplate([
    { label: 'Neuer Tab daneben', click: () => newTab(undefined, { ws: t.ws, index: tabs.indexOf(t) + 1 }) },
    { label: 'Neu laden', enabled: !!wcOf(t), click: () => wcOf(t).reload() },
    { label: 'Duplizieren', enabled: t.kind === 'web' && !!t.url, click: () => newTab(t.url, { ws: t.ws, index: tabs.indexOf(t) + 1 }) },
    { label: t.pinned ? 'Lösen' : 'Anheften', click: () => { t.pinned = !t.pinned; tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)); pushTabs(); } },
    { label: 'Geteilte Ansicht mit diesem Tab', click: () => toggleSplit(t.id) },
    { label: 'In Bereich verschieben', enabled: ws.length > 1, submenu: ws.filter((w) => w.id !== t.ws).map((w) => ({ label: w.name, click: () => moveToWorkspace(t.id, w.id) })) },
    { label: 'Schlafen legen (Speicher freigeben)', enabled: !!t.view && t.id !== activeId && t.kind === 'web', click: () => suspend(t) },
    { type: 'separator' },
    { label: 'Andere Tabs schließen', click: () => { for (const x of tabs.filter((y) => y.id !== t.id && y.ws === t.ws && !y.pinned)) closeTab(x.id); } },
    { label: 'Schließen', click: () => closeTab(t.id) }
  ]).popup({ window: win });
}

function showMenu() {
  const t = active(); const wc = wcOf(t);
  const ws = store.get('workspaces') || [];
  const template = [
    { label: 'Neuer Tab', accelerator: 'CmdOrCtrl+T', click: () => newTab() },
    { label: 'Geschlossenen Tab wieder öffnen', accelerator: 'CmdOrCtrl+Shift+T', enabled: closedStack.length > 0, click: () => reopenTab() },
    { label: 'Geteilte Ansicht', accelerator: 'CmdOrCtrl+Shift+S', enabled: !!t, type: 'checkbox', checked: !!(split && t && (split.a === t.id || split.b === t.id)), click: () => t && toggleSplit(t.id) },
    { label: 'Tab in Bereich verschieben', enabled: !!t && ws.length > 1, submenu: ws.filter((w) => w.id !== t?.ws).map((w) => ({ label: w.name, click: () => moveToWorkspace(t.id, w.id) })) },
    { type: 'separator' },
    { label: 'KI-Assistent', accelerator: 'CmdOrCtrl+Shift+A', click: () => send('open-panel', 'ai') },
    { label: 'Zusammenfassen', accelerator: 'CmdOrCtrl+J', enabled: t?.kind === 'web' && !!t.url, click: () => send('open-panel', 'summary') },
    { label: 'Seite übersetzen', enabled: t?.kind === 'web' && !!t.url, click: () => translate(t) },
    { label: 'Seite vorlesen', enabled: t?.kind === 'web' && !!t.url, click: () => send('tts', 'start') },
    { label: 'Auf Seite suchen …', accelerator: 'CmdOrCtrl+F', click: () => send('find-open') },
    { label: 'Zoom', submenu: [
      { label: 'Vergrößern', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(active(), 0.5) },
      { label: 'Verkleinern', accelerator: 'CmdOrCtrl+-', click: () => zoom(active(), -0.5) },
      { label: 'Originalgröße', accelerator: 'CmdOrCtrl+0', click: () => zoom(active(), null) }
    ] },
    { label: 'Drucken …', accelerator: 'CmdOrCtrl+P', enabled: !!wc && t.kind === 'web', click: () => wc.print() },
    { type: 'separator' },
    { label: 'Verlauf', accelerator: 'CmdOrCtrl+H', click: () => send('open-panel', 'history') },
    { label: 'Lesezeichen', click: () => send('open-panel', 'bookmarks') },
    { label: 'Downloads', accelerator: 'CmdOrCtrl+E', click: () => send('open-panel', 'downloads') },
    { label: 'Passwörter', click: () => send('open-panel', 'passwords') },
    { label: 'Merkliste & Vergleich', click: () => send('open-panel', 'watch') },
    { type: 'separator' },
    { label: 'PDF öffnen & unterschreiben …', click: () => openPDFDialog() },
    ...(t?.kind === 'pdf' ? [{ label: 'PDF speichern', accelerator: 'CmdOrCtrl+S', click: () => savePDF(t) }] : []),
    { label: 'Bildschirmfoto der Seite', enabled: !!t?.url, click: () => send('screenshot') },
    { label: 'Entwicklertools', accelerator: 'F12', enabled: !!wc, click: () => devTools(t) },
    { type: 'separator' },
    { label: 'Datenschutz-Center', click: () => send('open-panel', 'privacy') },
    { label: 'Einstellungen', accelerator: 'CmdOrCtrl+,', click: () => send('open-panel', 'settings') }
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
    fs.writeFileSync(uniquePath(downloadDir(), fileName), data);
    return path.basename(downloadDir());
  } finally { w.destroy(); }
}

// ---------- Meldungen aus den Tabs (nur von echten Tabs, nie vom Fenster oder Fremden) ----------
function wireTabMessages() {
  const tabOf = (e) => tabs.find((t) => t.view && t.view.webContents === e.sender && t.kind === 'web');
  ipcMain.on('pw:submitted', (e, d) => {
    const t = tabOf(e);
    if (!t || !d || typeof d.pass !== 'string' || !d.pass || d.pass.length > 500) return;
    const url = e.sender.getURL();                                // Adresse vom Browser, nicht von der Seite
    const site = siteOf(hostOf(url));
    if (!site || (store.get('neverSave') || []).includes(site)) return;
    const user = String(d.user || '').slice(0, 200);
    if (vault.known(url, user, d.pass)) return;
    const update = vault.forUrl(url).some((x) => x.user === user);
    pwPending.set(t.id, { url, user, pass: d.pass, at: Date.now(), update });
    pushTabs();
  });
  ipcMain.on('pw:form', (e) => {
    const t = tabOf(e); if (!t) return;
    const saved = vault.forUrl(e.sender.getURL());
    t.login = saved.length ? saved : null;
    pushTabs();
  });
  // Link-Vorschau: fährt die Maus über einen Link, wird die Verbindung zu dieser Seite schon aufgebaut
  let pcCount = 0; setInterval(() => { pcCount = 0; }, 60000);
  ipcMain.on('preconnect', (e, origin) => {
    if (!tabOf(e) || ++pcCount > 30) return;
    if (typeof origin === 'string' && /^https?:\/\/[^/]+$/.test(origin)) preconnect(origin);
  });
}

// ---------- Start ----------
app.whenReady().then(async () => {
  // Optional: Windows Hello / Touch ID beim Start
  if (store.get('appLock')) {
    const r = await vault.unlock();
    if (!r.ok) return app.quit();
  }
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' },
      { label: 'Ablage', submenu: [{ label: 'Neuer Tab', accelerator: 'Cmd+T', click: () => newTab() }, { label: 'PDF öffnen …', click: () => openPDFDialog() }, { role: 'close' }] },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ]));
  } else Menu.setApplicationMenu(null);

  applyDNS();
  registerIPC();
  wireTabMessages();

  // Standard-Sitzung (Fenster-Oberfläche): kein Netzverkehr
  const def = session.defaultSession;
  def.setSpellCheckerEnabled(false);
  def.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^(https?|wss?|ftp):/i.test(d.url) }));

  blocker.load();
  browsingSession = createBrowsingSession();
  wireDownloads(browsingSession);
  await startupCleanup(browsingSession);
  vpn.onState((s) => {
    send('vpn', s);
    for (const t of tabs) { const wc = wcOf(t); if (wc && t.kind === 'web') wc.setWebRTCIPHandlingPolicy(s.status === 'on' ? 'disable_non_proxied_udp' : 'default_public_interface_only'); }
  });
  await vpn.init(browsingSession);
  await createWindow();

  updater.init((s) => send('update', s));
  // Malware-/Phishing-Listen: beim Start (verzögert) und danach täglich frisch
  setTimeout(() => blocker.refresh().then(() => send('blocker', { ...blocker.info(), stats: store.get('stats') })).catch(() => {}), 15000);
  setInterval(() => blocker.refresh().catch(() => {}), 6 * 3600 * 1000);
  setInterval(() => { send('blocker', { ...blocker.info(), stats: store.get('stats') }); }, 30000);
});

app.on('second-instance', (_e, argv) => { const t = argvTargets(argv); if (t.length) openTargets(t); else showWindow(); });
app.on('activate', () => showWindow());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => saveSession(true));
app.on('web-contents-created', (_e, wc) => {
  // Sicherheitsnetz: niemals <webview> für Webinhalte, keine Pop-up-Fenster
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));   // wird für Tabs danach gezielt ersetzt
});

