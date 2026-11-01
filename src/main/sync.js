// ImmoAdv-Sync: Passwörter, Lesezeichen, Einstellungen und offene Tabs zwischen Windows, Mac und iPhone.
// Anmeldung mit dem ImmoAdv-Konto (inkl. 2-Faktor-Code), Inhalte Ende-zu-Ende verschlüsselt mit dem Sync-Passwort.
// Der Server (ImmoAdv-Datenbank) speichert nur Chiffretext – ohne Sync-Passwort kann dort niemand etwas lesen.
const crypto = require('node:crypto');
const os = require('node:os');
const { safeStorage } = require('electron');
const store = require('./store');
const vault = require('./vault');
const C = require('../shared/synccrypto');
const { siteOf } = require('../shared/lists');

const URL_BASE = 'https://mieoylqhtvghcnvaxutg.supabase.co';
const APIKEY = 'sb_publishable_vlerR4aelUQdlXbZV8753w_mgTiWghM';   // öffentlicher Schlüssel (kein Geheimnis); Zugriff regeln die Datenbank-Regeln
const SETTINGS_SYNCED = ['keepSignedIn', 'allowlist', 'blocklist', 'searchEngine', 'workspaces', 'aiInstructions', 'neverSave', 'googleExternal'];

let fetcher = null;
let session = null;          // { access, refresh, exp, userId, email }
let syncKey = null;          // Buffer – nur im Arbeitsspeicher und verschlüsselt (DPAPI/Schlüsselbund) auf der Platte
let pendingMfa = null;       // { factorId }
let busy = false, again = false, timer = null, pushTimer = null;
let remoteTabs = [];         // Tabs der anderen Geräte
let getOpenTabs = () => [];
let notify = () => {};
const state = { status: 'off', email: '', lastSync: 0, message: '', counts: {} };
const emit = (patch) => { Object.assign(state, patch); notify({ ...state, remoteTabs }); };

const encLocal = (s) => safeStorage.encryptString(String(s)).toString('base64');
const decLocal = (b) => { try { return safeStorage.decryptString(Buffer.from(b, 'base64')); } catch { return null; } };
const deviceId = () => { let d = store.get('syncDevice'); if (!d) { d = crypto.randomUUID(); store.set('syncDevice', d); } return d; };
const deviceName = () => `${process.platform === 'darwin' ? 'Mac' : 'Windows-PC'} (${os.hostname().replace(/\.local$/, '')})`;

// ---------- HTTP ----------
async function http(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  if (auth) await ensureToken();
  const h = { apikey: APIKEY, 'content-type': 'application/json', ...headers };
  if (auth && session) h.authorization = `Bearer ${session.access}`;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetcher(URL_BASE + path, { method, headers: h, body: body == null ? undefined : JSON.stringify(body), signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!r.ok) { const e = new Error((json && (json.msg || json.message || json.error_description || json.error)) || `HTTP ${r.status}`); e.status = r.status; throw e; }
    return json;
  } finally { clearTimeout(t); }
}
const b64url = (s) => JSON.parse(Buffer.from(s.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
function takeSession(j) {
  const claims = b64url(j.access_token);
  session = { access: j.access_token, refresh: j.refresh_token, exp: claims.exp * 1000, userId: claims.sub, email: (j.user && j.user.email) || claims.email || state.email, aal: claims.aal };
  store.set('syncAuth', encLocal(JSON.stringify({ refresh: session.refresh, email: session.email })));
}
async function ensureToken() {
  if (session && Date.now() < session.exp - 60000) return;
  const saved = !session && store.get('syncAuth') ? JSON.parse(decLocal(store.get('syncAuth')) || 'null') : null;
  const refresh = session ? session.refresh : saved && saved.refresh;
  if (!refresh) throw Object.assign(new Error('Nicht angemeldet'), { status: 401 });
  const j = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refresh }, auth: false });
  takeSession(j);
}

// ---------- Anmeldung ----------
async function login(email, password) {
  try {
    const j = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: String(email).trim(), password: String(password) }, auth: false });
    takeSession(j);
    state.email = session.email;
    const factors = ((j.user && j.user.factors) || []).filter((f) => f.status === 'verified' && f.factor_type === 'totp');
    if (factors.length && session.aal !== 'aal2') { pendingMfa = { factorId: factors[0].id }; emit({ status: 'needMfa', message: '' }); return state; }
    return afterLogin();
  } catch (e) {
    emit({ status: 'needLogin', message: e.status === 400 ? 'E-Mail oder Passwort falsch' : 'Anmeldung nicht möglich – Internet prüfen' });
    return state;
  }
}
async function mfa(code) {
  if (!pendingMfa) return state;
  try {
    const ch = await http(`/auth/v1/factors/${pendingMfa.factorId}/challenge`, { method: 'POST', body: {} });
    const j = await http(`/auth/v1/factors/${pendingMfa.factorId}/verify`, { method: 'POST', body: { challenge_id: ch.id, code: String(code).replace(/\s/g, '') } });
    takeSession(j); pendingMfa = null;
    return afterLogin();
  } catch { emit({ status: 'needMfa', message: 'Code falsch oder abgelaufen' }); return state; }
}
async function afterLogin() {
  const rows = await http(`/rest/v1/browser_sync_keys?select=salt,iterations,wrapped_key&user_id=eq.${session.userId}`);
  emit({ status: 'needPassphrase', message: '', hasKey: !!(rows && rows[0]) });
  return state;
}
async function setPassphrase(pass) {
  if (!pass || String(pass).length < 8) { emit({ message: 'Mindestens 8 Zeichen' }); return state; }
  try {
    const rows = await http(`/rest/v1/browser_sync_keys?select=salt,iterations,wrapped_key&user_id=eq.${session.userId}`);
    if (rows && rows[0]) {
      try { syncKey = C.unwrapKey(pass, rows[0]); } catch { emit({ status: 'needPassphrase', hasKey: true, message: 'Sync-Passwort falsch' }); return state; }
    } else {
      const w = C.newWrappedKey(pass);
      await http('/rest/v1/browser_sync_keys', { method: 'POST', body: { user_id: session.userId, salt: w.salt, iterations: w.iterations, wrapped_key: w.wrapped } });
      syncKey = w.syncKey;
    }
    store.set('syncKey', encLocal(syncKey.toString('base64')));
    store.set('syncSeen', {}); store.set('syncCursor', null);
    emit({ status: 'on', message: '' });
    await runNow();
  } catch (e) { emit({ message: 'Fehler: ' + e.message }); }
  return state;
}
function logout() {
  session = null; syncKey = null; pendingMfa = null; remoteTabs = [];
  for (const k of ['syncAuth', 'syncKey', 'syncSeen', 'syncCursor']) store.set(k, null);
  clearInterval(timer); timer = null;
  emit({ status: 'needLogin', email: '', lastSync: 0, message: 'Abgemeldet – Daten auf diesem Gerät bleiben erhalten' });
}

// Feste Reihenfolge der Felder für Vergleiche (gleich auf allen Geräten; Sortierung zählt nicht als Änderung)
function canon(kind, b) {
  if (kind === 'pw') return JSON.stringify([b.site || '', b.user || '', b.pass || '']);
  if (kind === 'bm') return JSON.stringify([b.url || '', b.title || '', b.folder || '', (b.tags || []).join(',')]);
  if (kind === 'settings') return JSON.stringify(SETTINGS_SYNCED.map((k) => (b[k] === undefined ? null : b[k])));
  return JSON.stringify(b);
}

// ---------- Lokale Daten als Datensätze ----------
function localRecords() {
  const out = new Map();
  for (const p of vault.plainEntries()) {
    const nat = `${p.site}\0${p.user}`;
    out.set(C.rid(syncKey, 'pw', nat), { kind: 'pw', body: { site: p.site, host: p.host, user: p.user, pass: p.pass }, changed: p.changed });
  }
  (store.get('bookmarks') || []).forEach((b, i) => {
    if (!b || !b.url) return;
    out.set(C.rid(syncKey, 'bm', b.url), { kind: 'bm', body: { title: b.title || '', url: b.url, folder: b.folder || '', tags: b.tags || [], order: i } });
  });
  const st = {}; for (const k of SETTINGS_SYNCED) st[k] = store.get(k);
  out.set('settings:main', { kind: 'settings', body: st });
  return out;
}

let applying = false;
function applyRemote(row, body) {
  applying = true;
  try {
    if (row.kind === 'pw') vault.applySync({ ...body, changed: Number(row.changed_at) }, row.deleted);
    else if (row.kind === 'bm') {
      const list = [...(store.get('bookmarks') || [])];
      const i = list.findIndex((b) => b.url === body.url);
      if (row.deleted) { if (i >= 0) list.splice(i, 1); }
      else {
        const item = { title: body.title, url: body.url, folder: body.folder || '', tags: body.tags || [] };
        if (i >= 0) list[i] = { ...list[i], ...item };
        else list.splice(Math.min(Number(body.order) || list.length, list.length), 0, item);
      }
      store.set('bookmarks', list);
    } else if (row.kind === 'settings' && !row.deleted) {
      for (const k of SETTINGS_SYNCED) if (k in body && body[k] !== undefined) store.set(k, body[k]);
    }
  } finally { applying = false; }
}

// ---------- Abgleich ----------
async function runNow() {
  if (!syncKey || state.status !== 'on') return;
  if (busy) { again = true; return; }
  busy = true;
  try {
    const seen = { ...(store.get('syncSeen') || {}) };
    // 1) Neues vom Server holen
    let cursor = store.get('syncCursor');
    for (let page = 0; page < 20; page++) {
      const q = `/rest/v1/browser_sync?select=rid,kind,data,deleted,device,changed_at,updated_at&order=updated_at.asc&limit=500${cursor ? `&updated_at=gt.${encodeURIComponent(cursor)}` : ''}`;
      const rows = await http(q);
      if (!rows || !rows.length) break;
      for (const row of rows) {
        cursor = row.updated_at;
        let body = null;
        try { body = JSON.parse(C.open(syncKey, row.data).toString('utf8')); } catch { continue; }   // nicht entschlüsselbar → überspringen
        if (row.kind === 'tabs') {
          if (row.device !== deviceId()) { remoteTabs = remoteTabs.filter((d) => d.device !== row.device); if (!row.deleted && body.tabs && body.tabs.length) remoteTabs.push({ device: row.device, name: body.name, platform: body.platform, at: body.at, tabs: body.tabs.slice(0, 60) }); }
          continue;
        }
        const mine = seen[row.rid];
        if (mine && mine.c >= Number(row.changed_at)) continue;    // eigener/neuerer Stand liegt schon vor
        applyRemote(row, body);
        seen[row.rid] = { c: Number(row.changed_at), h: row.deleted ? 'x' : C.mac(syncKey, canon(row.kind, body)), k: row.kind };
      }
      store.set('syncCursor', cursor);
      if (rows.length < 500) break;
    }
    // 2) Eigene Änderungen hochladen (neu, geändert, gelöscht)
    const local = localRecords();
    const now = Date.now();
    const up = [];
    for (const [rid, r] of local) {
      const h = C.mac(syncKey, canon(r.kind, r.body));
      if (seen[rid] && seen[rid].h === h) continue;
      const changed = Math.max(now, (seen[rid] && seen[rid].c + 1) || 0);
      up.push({ user_id: session.userId, rid, kind: r.kind, data: C.seal(syncKey, JSON.stringify(r.body)), deleted: false, device: deviceId(), changed_at: changed });
      seen[rid] = { c: changed, h, k: r.kind };
    }
    for (const [rid, s] of Object.entries(seen)) {
      if ((s.k === 'pw' || s.k === 'bm') && s.h !== 'x' && !local.has(rid)) {
        const changed = Math.max(now, s.c + 1);
        up.push({ user_id: session.userId, rid, kind: s.k, data: C.seal(syncKey, '{}'), deleted: true, device: deviceId(), changed_at: changed });
        seen[rid] = { c: changed, h: 'x', k: s.k };
      }
    }
    // offene Tabs dieses Geräts
    const tabs = getOpenTabs().filter((t) => /^https?:/.test(t.url)).slice(0, 60).map((t) => ({ url: t.url, title: String(t.title || '').slice(0, 120) }));
    const tabsHash = C.mac(syncKey, JSON.stringify(tabs));
    const tabsRid = `tabs:${deviceId()}`;
    if (!seen[tabsRid] || seen[tabsRid].h !== tabsHash) {
      up.push({ user_id: session.userId, rid: tabsRid, kind: 'tabs', data: C.seal(syncKey, JSON.stringify({ name: deviceName(), platform: process.platform, at: now, tabs })), deleted: false, device: deviceId(), changed_at: now });
      seen[tabsRid] = { c: now, h: tabsHash, k: 'tabs' };
    }
    for (let i = 0; i < up.length; i += 200) {
      await http('/rest/v1/browser_sync?on_conflict=user_id,rid', { method: 'POST', body: up.slice(i, i + 200), headers: { prefer: 'resolution=merge-duplicates,return=minimal' } });
    }
    store.set('syncSeen', seen);
    const counts = { passwords: vault.plainEntries().length, bookmarks: (store.get('bookmarks') || []).length };
    emit({ status: 'on', lastSync: Date.now(), message: '', counts });
  } catch (e) {
    if (e.status === 401 || e.status === 403) emit({ status: 'needLogin', message: 'Bitte neu anmelden' });
    else emit({ message: 'Abgleich gerade nicht möglich – neuer Versuch gleich' });
  } finally {
    busy = false;
    if (again) { again = false; setTimeout(runNow, 500); }
  }
}

function schedulePush() {
  if (applying || state.status !== 'on') return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(runNow, 2500);
}

function init(fetchFn, openTabsFn, onState) {
  fetcher = fetchFn; getOpenTabs = openTabsFn || getOpenTabs; notify = onState || notify;
  store.onChange((k) => { if (['passwords', 'bookmarks', ...SETTINGS_SYNCED].includes(k)) schedulePush(); });
  const k = store.get('syncKey') && decLocal(store.get('syncKey'));
  const auth = store.get('syncAuth') && JSON.parse(decLocal(store.get('syncAuth')) || 'null');
  if (k && auth) {
    syncKey = Buffer.from(k, 'base64'); state.email = auth.email || '';
    emit({ status: 'on' });
    setTimeout(runNow, 4000);
  } else emit({ status: auth ? 'needLogin' : 'off' });
  clearInterval(timer);
  timer = setInterval(runNow, 60000);
}

module.exports = {
  init, login, mfa, setPassphrase, logout, runNow, tabsChanged: () => { if (state.status === 'on') { clearTimeout(pushTimer); pushTimer = setTimeout(runNow, 15000); } },
  state: () => ({ ...state, remoteTabs }), forSite: (u) => siteOf(u)
};
