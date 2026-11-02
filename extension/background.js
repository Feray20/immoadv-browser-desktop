// ImmoAdv Browser – Hintergrund: verbindet Design, Blocker, NordVPN, spurloses Surfen, Passwort-Tresor,
// Immobilien-Werkzeuge und Updates. Alle Seiten der Erweiterung reden nur über die Nachrichten unten mit ihm.
'use strict';

let updateState = { status: 'idle' };
let vpnState = { status: 'nocreds' };
const broadcast = (type, data) => browser.runtime.sendMessage({ type, data }).catch(() => {});

const diag = { steps: [], errors: [] };
const step = (n) => { diag.steps.push(`${new Date().toISOString().slice(11, 19)} ${n}`); console.log('[ImmoAdv]', n); };
window.addEventListener('error', (e) => { diag.errors.push(String(e.message)); console.error('[ImmoAdv] Fehler', e.message); });
window.addEventListener('unhandledrejection', (e) => { diag.errors.push(String(e.reason && e.reason.message || e.reason)); console.error('[ImmoAdv] Fehler', e.reason); });

async function start() {
  step('Start');
  Theme.apply();
  // Blocker sofort (eigene Listen), Einstellungen vom Programm kommen dazu
  Blocker.init();
  const settingsReady = Settings.load();
  await Blocker.load();
  step(`Listen geladen: ${JSON.stringify(Blocker.info().counts)}`);
  await settingsReady;
  step(`Einstellungen geladen (Programm ${Native.connected ? 'verbunden' : 'nicht verbunden'})`);
  Vpn.onState((s) => { vpnState = s; broadcast('vpn', s); setIcon(); });
  Vpn.init();
  Vault.refreshSites();
  Traceless.init();
  Blocker.refresh().catch(() => {});
  browser.alarms.create('lists', { periodInMinutes: 360 });
  browser.alarms.create('history', { delayInMinutes: 2, periodInMinutes: 720 });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === 'lists') Blocker.refresh().catch(() => {});
    // Verlauf nur so lange aufbewahren wie eingestellt (wie Version 3)
    if (a.name === 'history') { const d = Number(Settings.get('historyDays')); if (d > 0) browser.history.deleteRange({ startTime: 0, endTime: Date.now() - d * 86400000 }).catch(() => {}); }
  });
  menus();
  // Daten aus Version 3 einmalig übernehmen (Lesezeichen)
  migrate().catch((e) => console.warn('Übernahme', e));
  try { updateState = await Native.call('update.state'); updateBadge(); setTimeout(offerUpdate, 4000); } catch (e) {}
}
let bmChain = Promise.resolve();
Native.on((ev, d) => {
  if (ev === 'sync') { syncState = d; broadcast('sync', d); }
  // Nacheinander anwenden (02.11.2026): parallel angelegte Ordner entstanden sonst mehrfach („Immobilien“ ×10).
  if (ev === 'bm.remote') bmChain = bmChain.then(() => applyRemoteBookmark(d)).catch((e) => console.warn('Lesezeichen vom anderen Gerät', e));
  // „Jetzt neu starten“ (Einstellungen, die einen Neustart brauchen): Browser sauber beenden, das Programm startet ihn neu.
  if (ev === 'restart') restartForUpdate();
  if (ev === 'openBg') {
    // Links aus der ImmoAdv-Software: neuer Tab hinten im zuletzt benutzten Fenster, ohne Fokuswechsel.
    browser.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null).then((w) => {
      for (const url of (d && d.urls) || []) browser.tabs.create({ url, active: false, ...(w && w.id != null ? { windowId: w.id } : {}) }).catch(() => {});
    });
    return;
  }
  if (ev === 'update') { updateState = d; broadcast('update', d); updateBadge(); if (d.status === 'restarting') restartForUpdate(); else offerUpdate(); }
});

// ---------- Neue ImmoAdv-Version: Fenster wie in Version 3 (einmal je Version, „Später“ merkt sich das) ----------
let updateWin = null;
async function offerUpdate() {
  const u = updateState || {};
  if (!['available', 'downloading', 'ready'].includes(u.status) || !u.version) return;
  const { updateLater } = await browser.storage.local.get('updateLater');
  if (updateLater === u.version || updateWin) return;
  try {
    const w = await browser.windows.create({ url: browser.runtime.getURL('pages/update.html'), type: 'popup', width: 470, height: 520, allowScriptsToClose: true });
    updateWin = w.id;
  } catch (e) { /* kein Fenster offen – kommt beim nächsten Mal */ }
}
browser.windows.onRemoved.addListener((id) => { if (id === updateWin) updateWin = null; });
function updateBadge() {
  const on = ['available', 'downloading', 'ready'].includes((updateState || {}).status);
  browser.browserAction.setBadgeText({ text: on ? '↑' : '' }).catch(() => {});
  if (on) browser.browserAction.setBadgeBackgroundColor({ color: '#19C2B0' }).catch(() => {});
}

function setIcon() {
  const t = vpnState.status === 'on' ? 'NordVPN aktiv' : vpnState.loggedIn ? 'NordVPN verbindet …' : 'Geschützt';
  browser.browserAction.setTitle({ title: `ImmoAdv – ${t}` }).catch(() => {});
}

// Update installiert sich: Fenster schließen (Tabs bleiben gespeichert), das Programm startet den Browser neu
// Beenden über die Browser-Brücke (02.11.2026): Fenster einzeln schließen beendete Firefox am Mac nicht (alte Fassung lief
// weiter) und unter Windows stellte die Sitzung nur das letzte Fenster wieder her.
async function restartForUpdate() {
  await new Promise((r) => setTimeout(r, 1200));
  try { await browser.tabs.create({ url: browser.runtime.getURL('pages/cmd.html?c=quit'), active: false }); }
  catch { for (const w of await browser.windows.getAll()) await browser.windows.remove(w.id).catch(() => {}); }
}

// ---------- Geräte-Abgleich (Windows ⇄ Mac): Lesezeichen und offene Tabs an das Programm melden ----------
// Das Programm verschlüsselt alles Ende-zu-Ende mit dem Sync-Passwort; hier nur der Stand aus Firefox.
let syncState = null, bmTimer = null, tabTimer = null, applyingBm = 0;
const ROOT_IDS = new Set(['root________', 'toolbar_____', 'menu________', 'unfiled_____', 'mobile______']);
async function bookmarkList() {
  const out = [];
  const walk = (n, path) => {
    for (const c of n.children || []) {
      if (c.url) { if (/^https?:/i.test(c.url)) out.push({ title: c.title || '', url: c.url, folder: path }); }
      else if (c.children) walk(c, ROOT_IDS.has(c.id) ? (c.id === 'toolbar_____' ? '' : (c.title || 'Weitere')) : (path ? path + '/' : '') + (c.title || ''));
    }
  };
  const tree = await browser.bookmarks.getTree();
  walk(tree[0], '');
  return out;
}
function pushBookmarks() {
  clearTimeout(bmTimer);
  bmTimer = setTimeout(async () => { if (applyingBm) return pushBookmarks(); try { await Native.call('bm.local', { list: await bookmarkList() }); } catch (e) { /* Programm nicht bereit */ } }, 3000);
}
async function folderId(path) {
  const tree = await browser.bookmarks.getTree();
  const toolbar = (tree[0].children || []).find((c) => c.id === 'toolbar_____') || tree[0].children[1];
  let parent = toolbar;
  for (const name of String(path || '').split('/').filter(Boolean)) {
    const kids = await browser.bookmarks.getChildren(parent.id);
    parent = kids.find((k) => !k.url && k.title === name) || await browser.bookmarks.create({ parentId: parent.id, title: name });
  }
  return parent.id;
}
async function applyRemoteBookmark(op) {
  if (!op || !op.url) return;
  applyingBm++;
  try {
    const same = await browser.bookmarks.search({ url: op.url }).catch(() => []);
    if (op.deleted) { for (const b of same) await browser.bookmarks.remove(b.id).catch(() => {}); }
    else if (!same.length) await browser.bookmarks.create({ parentId: await folderId(op.folder), title: op.title || op.url, url: op.url });
    else if (op.title && same[0].title !== op.title) await browser.bookmarks.update(same[0].id, { title: op.title });
  } finally { setTimeout(() => { applyingBm = Math.max(0, applyingBm - 1); }, 1500); }
}
function pushTabs() {
  clearTimeout(tabTimer);
  tabTimer = setTimeout(async () => {
    try {
      const tabs = (await browser.tabs.query({})).filter((t) => !t.incognito && /^https?:/.test(t.url || '')).slice(0, 60).map((t) => ({ url: t.url, title: t.title || '' }));
      await Native.call('tabs.local', { tabs });
    } catch (e) { /* Programm nicht bereit */ }
  }, 5000);
}
for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) browser.bookmarks[ev].addListener(pushBookmarks);
browser.tabs.onUpdated.addListener((id, ch) => { if (ch.url || ch.title) pushTabs(); });
browser.tabs.onRemoved.addListener(pushTabs);
setTimeout(() => { pushBookmarks(); pushTabs(); }, 15000);

// ---------- Version 3 → 4: Lesezeichen übernehmen ----------
async function migrate() {
  const done = (await browser.storage.local.get('migratedV4')).migratedV4;
  if (done) return;
  let data = null;
  try { data = await Native.call('migrate.v3'); } catch (e) { return; }   // Programm noch nicht bereit → nächster Start
  const tree = await browser.bookmarks.getTree();
  const toolbar = (tree[0].children || []).find((c) => c.id === 'toolbar_____') || tree[0].children[1];
  const existing = new Set((await browser.bookmarks.search({})).map((b) => b.url));
  const folders = new Map();
  for (const b of (data && data.bookmarks) || []) {
    if (!b || !/^https?:/.test(b.url) || existing.has(b.url)) continue;
    let parentId = toolbar.id;
    if (b.folder) {
      if (!folders.has(b.folder)) folders.set(b.folder, (await browser.bookmarks.create({ parentId: toolbar.id, title: b.folder })).id);
      parentId = folders.get(b.folder);
    }
    await browser.bookmarks.create({ parentId, title: b.title || b.url, url: b.url });
    existing.add(b.url);
  }
  await browser.storage.local.set({ migratedV4: true });
}

// ---------- Word/Excel/PowerPoint aus dem Internet: im ImmoAdv-Betrachter anzeigen statt nur herunterladen ----------
const OFFICE_TYPES = /(officedocument|msword|ms-excel|ms-powerpoint|opendocument\.(text|spreadsheet|presentation))/i;
browser.webRequest.onHeadersReceived.addListener((d) => {
  if (d.type !== 'main_frame' || d.method !== 'GET' || d.statusCode !== 200) return {};
  const h = (n) => ((d.responseHeaders || []).find((x) => x.name.toLowerCase() === n) || {}).value || '';
  if (!OFFICE_TYPES.test(h('content-type'))) return {};
  let name = (/filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(h('content-disposition')) || [])[1] || d.url.split('/').pop().split('?')[0] || 'Dokument';
  try { name = decodeURIComponent(name); } catch (e) {}
  return { redirectUrl: browser.runtime.getURL(`office/index.html?src=${encodeURIComponent(d.url)}&name=${encodeURIComponent(name)}`) };
}, { urls: ['https://*/*'], types: ['main_frame'] }, ['blocking', 'responseHeaders']);

// ---------- Kontextmenü ----------
function menus() {
  browser.menus.removeAll().then(() => {
    browser.menus.create({ id: 'immo-check', title: 'Immobilien-Check', contexts: ['page'] });
    browser.menus.create({ id: 'ai-page', title: 'KI: Seite zusammenfassen', contexts: ['page'] });
    browser.menus.create({ id: 'ai-sel', title: 'KI fragen zu „%s“', contexts: ['selection'] });
    browser.menus.create({ id: 'clean-link', title: 'Link kopieren (ohne Tracking)', contexts: ['link'] });
    browser.menus.create({ id: 'ocr', title: 'Text erkennen & gerade ausrichten', contexts: ['page'], documentUrlPatterns: ['*://*/*.pdf', '*://*/*.PDF', 'file:///*'] });
  });
  browser.menus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'clean-link') {
      await navigator.clipboard.writeText(Blocker.cleanURL(info.linkUrl)).catch(() => {});
    } else if (info.menuItemId === 'immo-check') {
      browser.pageAction.openPopup().catch(() => browser.tabs.create({ url: browser.runtime.getURL(`pages/immo.html?tab=${tab.id}`) }));
    } else if (info.menuItemId === 'ai-page' || info.menuItemId === 'ai-sel') {
      await browser.storage.session?.set?.({ aiPrompt: { tabId: tab.id, sel: info.selectionText || '', kind: info.menuItemId } }).catch(() => {});
      aiPrompt = { tabId: tab.id, sel: info.selectionText || '', kind: info.menuItemId };
      browser.sidebarAction.open().catch(() => {});
      broadcast('ai-prompt', aiPrompt);
    } else if (info.menuItemId === 'ocr') {
      browser.tabs.create({ url: browser.runtime.getURL(`studio/index.html?src=${encodeURIComponent(tab.url)}&auto=1`) });
    }
  });
}
let aiPrompt = null;

// ---------- Text einer Seite (für KI und Immobilien-Check) ----------
async function pageText(tabId) {
  try {
    const [r] = await browser.tabs.executeScript(tabId, { code: '({ title: document.title, url: location.href, text: (document.body ? document.body.innerText : "").slice(0, 60000) })' });
    return r;
  } catch (e) { return null; }
}
async function listing(tabId) {
  try {
    const [r] = await browser.tabs.executeScript(tabId, { file: '/lib/listing.js' });
    return r;
  } catch (e) { return null; }
}

// ---------- Nachrichten der Seiten ----------
browser.runtime.onMessage.addListener((m, sender) => {
  const tabId = sender.tab ? sender.tab.id : -1;
  switch (m && m.type) {
    case 'diag': return Promise.resolve(diag);
    case 'state': return Promise.race([ready, new Promise((r) => setTimeout(r, 6000))]).then(() => ({
      settings: Settings.all(), vpn: vpnState, update: updateState, lists: Blocker.info(), countries: Vpn.COUNTRIES,
      native: Native.connected, version: browser.runtime.getManifest().version
    }));
    case 'settings:set': return Settings.set(m.patch || {});
    case 'blocked:allow': Blocker.allowOnce(m.url); return Promise.resolve(true);
    case 'blocked:count': return Promise.resolve(Blocker.blockedOn(m.tabId));
    case 'lists:refresh': return Blocker.refresh(true).then(() => Blocker.info());
    case 'vpn:login': return Vpn.login(m.user, m.pass);
    case 'vpn:logout': return Vpn.logout();
    case 'vpn:country': return Vpn.setCountry(m.code);
    case 'vpn:recheck': return Vpn.recheck();
    case 'screenshot': return (async () => {
      const data = await browser.tabs.captureVisibleTab(m.windowId);
      const url = URL.createObjectURL(await (await fetch(data)).blob());
      await browser.downloads.download({ url, filename: `Bildschirmfoto ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`, saveAs: false });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    })();
    case 'update:later': return browser.storage.local.set({ updateLater: m.version }).then(() => true);
    case 'update:check': return Native.call('update.check').catch((e) => ({ status: 'error', message: e.message }));
    case 'update:now': return Native.call('update.now', {}, 30 * 60000).catch((e) => ({ status: 'error', message: e.message }));
    case 'engine:set': return Native.call('engine.set', { patch: m.patch }).catch((e) => ({ ok: false, error: e.message }));
    case 'site:clear': return Traceless.wipeNow(m.site).then(() => true);
    case 'page:text': return pageText(m.tabId);
    case 'page:listing': return listing(m.tabId);
    case 'ai:prompt': { const p = aiPrompt; aiPrompt = null; return Promise.resolve(p); }
    case 'ai:ask': return Native.call('ai.ask', { req: m.req }, 180000);
    case 'ai:config': return Native.call('ai.config').catch(() => ({}));
    case 'ai:setKey': return Native.call('ai.setKey', { provider: m.provider, key: m.key });
    case 'report:save': return Native.call('report.save', { html: m.html, fileName: m.fileName }, 120000);
    case 'watch:add': { const w = [...(Settings.get('watchlist') || []), { ...m.item, id: Date.now(), added: Date.now() }].slice(-200); return Settings.set({ watchlist: w }).then(() => w); }
    case 'watch:remove': { const w = (Settings.get('watchlist') || []).filter((x) => x.id !== m.id); return Settings.set({ watchlist: w }).then(() => w); }
    // Passwörter
    case 'pw:forUrl': return Vault.forUrl(m.url);
    case 'pw:fill': return Vault.fill(m.id, sender.tab ? sender.tab.url : m.url).catch(() => null);
    case 'pw:submitted': Vault.offer(tabId, m); return Promise.resolve(true);
    case 'pw:pending': return Promise.resolve(Vault.takePending(tabId, m.url));
    case 'pw:decide': return Vault.decide(tabId, m.choice);
    case 'pw:list': return Native.call('vault.list');
    case 'pw:delete': return Native.call('vault.delete', { id: m.id }).then((r) => { Vault.refreshSites(); return r; });
    case 'pw:update': return Native.call('vault.update', { id: m.id, user: m.user, pass: m.pass, url: m.url }).then((r) => { Vault.refreshSites(); return r; });
    case 'pw:add': return Native.call('vault.add', { url: m.url, user: m.user, pass: m.pass }).then((r) => { Vault.refreshSites(); return r; });
    case 'perf:info': {
      const t0 = performance.now();
      return Native.call('perf.info', {}, 8000).then((h) => ({ ...h, pingMs: Math.round(performance.now() - t0) })).catch((e) => ({ error: e.message, pingMs: null }))
        .then(async (h) => { const tabs = await browser.tabs.query({}).catch(() => []); return { ...h, tabs: tabs.length, discarded: tabs.filter((x) => x.discarded).length, blockedNow: Blocker.blockedOn ? tabs.reduce((a, x) => a + (Blocker.blockedOn(x.id) || 0), 0) : null }; });
    }
    case 'pw:deleteMany': return Native.call('vault.deleteMany', { ids: m.ids }).then((r) => { Vault.refreshSites(); return r; });
    case 'pw:copy': return Native.call('vault.copy', { id: m.id }, 130000);
    case 'pw:reveal': return Native.call('vault.reveal', { id: m.id }, 130000);
    case 'pw:import': return Native.call('vault.import', {}, 300000).then((r) => { Vault.refreshSites(); return r; });
    // Geräte-Abgleich
    case 'sync:state': return Native.call('sync.state').catch((e) => ({ status: 'error', message: e.message }));
    case 'sync:login': return Native.call('sync.login', { email: m.email, password: m.password }, 30000).catch((e) => ({ status: 'needLogin', message: e.message }));
    case 'sync:google': return Native.call('sync.google', {}, 15000).then((r) => { if (r && r.url) browser.tabs.create({ url: r.url }); return { status: 'waitGoogle' }; }).catch((e) => ({ status: 'needLogin', message: e.message }));
    case 'sync:mfa': return Native.call('sync.mfa', { code: m.code }, 30000).catch((e) => ({ status: 'needMfa', message: e.message }));
    case 'sync:pass': return Native.call('sync.pass', { pass: m.pass }, 120000).catch((e) => ({ status: 'needPassphrase', message: e.message }));
    case 'sync:logout': return Native.call('sync.logout').catch((e) => ({ status: 'error', message: e.message }));
    case 'sync:now': pushBookmarks(); pushTabs(); return Native.call('sync.now', {}, 120000).catch((e) => ({ status: 'error', message: e.message }));
    case 'file:read': return Native.call('file.read', { token: m.token, offset: m.offset || 0 }, 60000).catch((e) => ({ error: e.message }));
    default: return undefined;
  }
});

const ready = start().catch((e) => { diag.errors.push(String(e && e.message || e)); console.error('[ImmoAdv] Start', e); });
