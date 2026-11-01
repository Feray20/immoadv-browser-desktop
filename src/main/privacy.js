// Datenschutz-Engine: eine zentrale Sitzung für alle Tabs mit Blocker, HTTPS-Zwang, sauberen Links,
// Berechtigungen (Kamera, Mikrofon, Standort …) und spurlosem Surfen.
const { session, dialog, BrowserWindow } = require('electron');
const store = require('./store');
const blocker = require('./blocker');
const { siteOf } = require('../shared/lists');

// Tracking-Zusätze in Links (Kampagnen-/Klick-IDs) – werden vor dem Laden entfernt
const TRACK_PARAMS = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|igsh|yclid|ttclid|twclid|li_fat_id|_hsenc|_hsmi|__hssc|__hstc|__hsfp|hsctatracking|oly_enc_id|oly_anon_id|vero_id|vero_conv|rb_clickid|s_cid|mkt_tok|_openstat|wickedid|epik|srsltid|sc_cid|trk|trkCampaign|ga_[a-z_]+)$/i;
function cleanURL(url) {
  try {
    const u = new URL(url);
    if (!u.search || (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith('/o/oauth'))) return url;
    let changed = false;
    for (const k of [...u.searchParams.keys()]) if (TRACK_PARAMS.test(k)) { u.searchParams.delete(k); changed = true; }
    return changed ? u.toString() : url;
  } catch { return url; }
}
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

function userAgent() {
  const major = process.versions.chrome.split('.')[0];
  const os = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'Windows NT 10.0; Win64; x64';
  // normaler Chrome-UA (reduziert) – Webseiten sehen einen ganz normalen Chrome, nicht Electron
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

// ---------- Berechtigungen: einmal fragen, Entscheidung je Seite merken ----------
const PERMS = {
  media: 'Kamera/Mikrofon', geolocation: 'deinen Standort', notifications: 'Mitteilungen senden', midi: 'MIDI-Geräte',
  'clipboard-read': 'die Zwischenablage lesen', 'display-capture': 'deinen Bildschirm teilen', 'idle-detection': 'erkennen, ob du aktiv bist',
  'window-management': 'Fenster auf allen Bildschirmen verwalten', 'storage-access': 'Daten seitenübergreifend speichern'
};
const ALWAYS = ['fullscreen', 'clipboard-sanitized-write', 'pointerLock'];

async function askPermission(wc, permission, details) {
  if (ALWAYS.includes(permission)) return true;
  const label = PERMS[permission];
  if (!label) return false;                               // unbekannt / selten gebraucht → nein
  const site = siteOf(hostOf(details.requestingUrl || wc.getURL()));
  const saved = (store.get('permissions') || {})[site] || {};
  if (permission in saved) return saved[permission];
  const win = BrowserWindow.fromWebContents(wc) || BrowserWindow.getAllWindows()[0];
  const what = permission === 'media' && details.mediaTypes ? details.mediaTypes.map((m) => (m === 'video' ? 'Kamera' : 'Mikrofon')).join(' und ') : label;
  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Erlauben', 'Blockieren'], defaultId: 1, cancelId: 1,
    title: 'Berechtigung', message: `${site} möchte ${what} verwenden.`, checkboxLabel: 'Für diese Seite merken', checkboxChecked: true
  });
  const allow = response === 0;
  if (checkboxChecked) {
    const all = { ...(store.get('permissions') || {}) };
    all[site] = { ...(all[site] || {}), [permission]: allow };
    store.set('permissions', all);
  }
  return allow;
}

/** Die eine Sitzung für alle Tabs. Dauerhaft – Spurlos-Regeln entfernen Daten gezielt (siehe unten). */
function createBrowsingSession() {
  const ses = session.fromPartition('persist:immoadv', { cache: true });
  ses.setUserAgent(userAgent(), 'de-DE,de;q=0.9,en;q=0.8');
  ses.setSpellCheckerEnabled(false);                      // würde Wörterbücher von Google laden
  ses.setPermissionRequestHandler((wc, perm, cb, details) => { askPermission(wc, perm, details || {}).then(cb, () => cb(false)); });
  ses.setPermissionCheckHandler((wc, perm, origin) => {
    if (ALWAYS.includes(perm)) return true;
    const site = siteOf(hostOf(origin || (wc && wc.getURL()) || ''));
    return !!((store.get('permissions') || {})[site] || {})[perm];
  });
  ses.setDevicePermissionHandler(() => false);            // USB/HID/Seriell/Bluetooth: grundsätzlich nein
  ses.setDisplayMediaRequestHandler(async (req, cb) => {
    const wc = req.frame && req.frame.top ? require('electron').webContents.fromFrame(req.frame) : null;
    const ok = wc ? await askPermission(wc, 'display-capture', { requestingUrl: req.securityOrigin }) : false;
    if (!ok) return cb({});
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    cb(sources[0] ? { video: sources[0] } : {});
  });

  const upgraded = new Set();
  ses.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url;
    if (!/^https?:/.test(url)) return cb({});
    const isMain = details.resourceType === 'mainFrame';
    // HTTPS-Zwang. Leitet ein Server trotzdem auf http zurück, wird abgebrochen statt endlos umzuleiten.
    if (store.get('httpsOnly') !== false && url.startsWith('http:') && isMain && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)) {
      const secure = 'https:' + url.slice(5);
      if (upgraded.has(secure)) return cb({ cancel: true });
      upgraded.add(secure);
      return cb({ redirectURL: secure });
    }
    if (store.get('cleanLinks') !== false && (isMain || details.resourceType === 'subFrame')) {
      const clean = cleanURL(url);
      if (clean !== url) return cb({ redirectURL: clean });
    }
    const wc = details.webContents;
    const page = isMain ? url : (wc && !wc.isDestroyed() ? wc.getURL() : details.referrer);
    const hit = blocker.check(details, page);
    if (hit) {
      blocker.record(wc ? wc.id : -1, hit.kind, url, isMain || details.resourceType === 'subFrame');
      return cb({ cancel: true });
    }
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    delete h['X-Client-Data'];
    h['Sec-GPC'] = '1';                                    // „Global Privacy Control“: Daten nicht verkaufen/teilen
    cb({ requestHeaders: h });
  });

  return ses;
}

// ---------- Spurlos surfen ----------
const keep = (site) => (store.get('keepSignedIn') || []).some((d) => site === d || site.endsWith('.' + d));
const timers = new Map();

/** Beim Start: Cookies aller Seiten löschen, bei denen du nicht angemeldet bleiben willst; Zwischenspeicher leeren */
async function startupCleanup(ses) {
  try {
    for (const c of await ses.cookies.get({})) {
      const site = siteOf(String(c.domain || '').replace(/^\./, ''));
      if (!keep(site)) await ses.cookies.remove(`http${c.secure ? 's' : ''}://${String(c.domain).replace(/^\./, '')}${c.path || '/'}`, c.name).catch(() => {});
    }
    await ses.clearCache();
  } catch { /* nicht kritisch */ }
}

/** Seite verlassen/Tab zu: nach kurzer Pause alle Daten dieser Seite löschen, wenn kein Tab sie mehr offen hat */
function siteLeft(ses, site, stillOpen) {
  if (!site || keep(site)) return;
  clearTimeout(timers.get(site));
  timers.set(site, setTimeout(async () => {
    timers.delete(site);
    if (stillOpen(site)) return;
    try {
      for (const c of await ses.cookies.get({})) {
        const d = String(c.domain || '').replace(/^\./, '');
        if (siteOf(d) === site) await ses.cookies.remove(`http${c.secure ? 's' : ''}://${d}${c.path || '/'}`, c.name).catch(() => {});
      }
      for (const origin of [`https://${site}`, `https://www.${site}`, `http://${site}`]) {
        await ses.clearStorageData({ origin, storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem', 'websql'] }).catch(() => {});
      }
    } catch { /* nicht kritisch */ }
  }, 8000));
}

/** Sicherheits-Einstellungen für jede Webansicht (Tab) */
function tabPreferences(ses) {
  return {
    session: ses,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    javascript: store.get('javaScript') !== false,
    webviewTag: false,
    safeDialogs: true,
    navigateOnDragDrop: false,
    spellcheck: false,
    autoplayPolicy: 'document-user-activation-required',
    preload: require('node:path').join(__dirname, '..', 'preload', 'tab-preload.js')
  };
}

module.exports = { cleanURL, createBrowsingSession, tabPreferences, userAgent, hostOf, startupCleanup, siteLeft, keep };
