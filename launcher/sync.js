// ImmoAdv-Sync: Passwörter, Lesezeichen, Einstellungen und offene Tabs zwischen Windows, Mac und iPhone.
// Anmeldung mit dem ImmoAdv-Konto (inkl. 2-Faktor-Code), Inhalte Ende-zu-Ende verschlüsselt mit dem Sync-Passwort.
// Der Server (ImmoAdv-Datenbank) speichert nur Chiffretext – ohne Sync-Passwort kann dort niemand etwas lesen.
const crypto = require('node:crypto');
const os = require('node:os');
const { safeStorage } = require('electron');
const store = require('./store');
const vault = require('./vault');
const uploads = require('./uploads');
const C = require('./synccrypto');
const { siteOf } = require('../src/shared/lists');

const URL_BASE = 'https://mieoylqhtvghcnvaxutg.supabase.co';
const APIKEY = 'sb_publishable_vlerR4aelUQdlXbZV8753w_mgTiWghM';   // öffentlicher Schlüssel (kein Geheimnis); Zugriff regeln die Datenbank-Regeln
const SETTINGS_SYNCED = ['keepSignedIn', 'allowlist', 'blocklist', 'searchEngine', 'aiInstructions', 'neverSave', 'googleExternal'];   // Arbeitsbereiche/Firmendaten entfernt (05.11.2026)

let fetcher = null;
let session = null;          // { access, refresh, exp, userId, email }
let syncKey = null;          // Buffer – nur im Arbeitsspeicher und verschlüsselt (DPAPI/Schlüsselbund) auf der Platte
let pendingMfa = null;       // { factorId }
let busy = false, again = false, timer = null, pushTimer = null;
let remoteTabs = [];         // Tabs der anderen Geräte
let getOpenTabs = () => [];
let notify = () => {};
let onBookmark = () => {};
const recentRemote = new Map();   // URL → Zeit: gerade vom anderen Gerät gekommen, Firefox legt sie noch an   // Lesezeichen vom anderen Gerät → Firefox (über die Erweiterung)
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
  let j;
  // Abgelaufener/ungültiger Anmeldeschlüssel meldet Supabase mit 400 – dann neu anmelden statt endlos „neuer Versuch gleich“.
  try { j = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refresh }, auth: false }); }
  catch (e) { if (e.status === 400) e.status = 401; throw e; }
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
// Mit Google anmelden (Wunsch Feray 02.11.2026) – gleiches ImmoAdv-Konto wie auf immoadv.de, auf Windows, Mac und iPhone.
// Ablauf wie bei Desktop-Apps üblich: kurzer Empfänger nur auf 127.0.0.1 (zufälliger Port), Anmeldung im normalen Tab
// über immoadv.de/auth/app (Google), die Seite reicht die Anmeldedaten im #-Teil nur an diesen lokalen Empfänger weiter.
let googleSrv = null;
function loginGoogle() {
  const http0 = require('node:http');
  if (googleSrv) { try { googleSrv.close(); } catch {} googleSrv = null; }
  const nonce = crypto.randomBytes(16).toString('hex');
  emit({ message: '' });
  return new Promise((resolve) => {
    const srv = http0.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && u.pathname === '/immoadv-sync') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
        res.end(`<!doctype html><meta charset="utf-8"><title>ImmoAdv Browser</title><body style="font:16px -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:90vh;color:#222"><p id="m">Anmeldung wird übernommen …</p><script>
          var h=location.hash.slice(1);history.replaceState(null,'',location.pathname);
          fetch('/immoadv-sync/t?n=${nonce}',{method:'POST',body:h}).then(function(r){return r.text()}).then(function(t){document.getElementById('m').textContent=t;setTimeout(function(){window.close()},1500)}).catch(function(){document.getElementById('m').textContent='Fehler – bitte erneut versuchen.'});
        </script>`);
        return;
      }
      if (req.method === 'POST' && u.pathname === '/immoadv-sync/t' && u.searchParams.get('n') === nonce) {
        let b = ''; req.on('data', (c) => { b += c; if (b.length > 20000) req.destroy(); });
        req.on('end', async () => {
          const q = new URLSearchParams(b);
          let msg = 'Angemeldet – du kannst diesen Tab schließen.';
          try {
            if (!q.get('access_token') || !q.get('refresh_token')) throw new Error(q.get('error_description') || 'Anmeldung abgebrochen');
            takeSession({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token') });
            const me = await http('/auth/v1/user').catch(() => null);
            if (me && me.email) { session.email = me.email; state.email = me.email; }
            const factors = ((me && me.factors) || []).filter((f) => f.status === 'verified' && f.factor_type === 'totp');
            if (factors.length && session.aal !== 'aal2') { pendingMfa = { factorId: factors[0].id }; emit({ status: 'needMfa', message: '' }); msg = 'Fast fertig – bitte im ImmoAdv Browser den 2-Faktor-Code eingeben.'; }
            else await afterLogin();
          } catch (e) { msg = 'Anmeldung nicht möglich: ' + String(e.message || e).slice(0, 120); emit({ status: 'needLogin', message: msg }); }
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(msg);
          setTimeout(() => { try { srv.close(); } catch {} if (googleSrv === srv) googleSrv = null; }, 500);
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    srv.listen(0, '127.0.0.1', () => {
      googleSrv = srv;
      setTimeout(() => { try { srv.close(); } catch {} if (googleSrv === srv) googleSrv = null; }, 10 * 60_000);
      resolve({ url: `https://immoadv.de/auth/app?provider=google&loopback=${srv.address().port}` });
    });
  });
}
async function mfa(code) {
  if (!pendingMfa) return state;
  try {
    const ch = await http(`/auth/v1/factors/${pendingMfa.factorId}/challenge`, { method: 'POST', body: {} });
    const j = await http(`/auth/v1/factors/${pendingMfa.factorId}/verify`, { method: 'POST', body: { challenge_id: ch.id, code: String(code).replace(/\s/g, '') } });
    takeSession(j);
    const r = await afterLogin();
    pendingMfa = null;
    return r;
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
    // Nach Abmelden/Anmelden lief der Minuten-Takt nicht mehr – jetzt sofort wieder starten.
    clearInterval(timer); timer = setInterval(runNow, 60000);
    await runNow();
    realtimeStart();
  } catch (e) { emit({ message: 'Fehler: ' + e.message }); }
  return state;
}
function logout() {
  session = null; syncKey = null; pendingMfa = null; remoteTabs = [];
  for (const k of ['syncAuth', 'syncKey', 'syncSeen', 'syncCursor']) store.set(k, null);
  clearInterval(timer); timer = null;
  realtimeStop();
  emit({ status: 'needLogin', email: '', lastSync: 0, message: 'Abgemeldet – Daten auf diesem Gerät bleiben erhalten' });
}

// Feste Reihenfolge der Felder für Vergleiche (gleich auf allen Geräten; Sortierung zählt nicht als Änderung)
function canon(kind, b) {
  if (kind === 'pw') return JSON.stringify([b.site || '', b.user || '', b.pass || '']);
  if (kind === 'bm') return JSON.stringify([b.url || '', b.title || '', b.folder || '', (b.tags || []).join(',')]);
  if (kind === 'settings') return JSON.stringify(SETTINGS_SYNCED.map((k) => (b[k] === undefined ? null : b[k])));
  if (kind === 'up') return JSON.stringify(uploads.FIELDS.map((k) => (b[k] === undefined ? null : b[k])));
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
  // Upload-Verlauf (02.11.2026): je Upload ein Datensatz, Kennung aus der Ereignis-ID
  for (const u of uploads.all()) out.set(C.rid(syncKey, 'up', u.id), { kind: 'up', body: u });
  const st = {}; for (const k of SETTINGS_SYNCED) st[k] = store.get(k);
  out.set('settings:main', { kind: 'settings', body: st });
  return out;
}

let applying = false;
let uploadsChanged = false;   // vom anderen Gerät kam ein Upload-Eintrag → Verlaufsseiten sofort neu zeichnen
let onUploads = () => {};
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
      if (!row.deleted) recentRemote.set(body.url, Date.now()); else recentRemote.delete(body.url);
      try { onBookmark({ deleted: !!row.deleted, url: body.url, title: body.title || '', folder: body.folder || '' }); } catch { /* nie kritisch */ }
    } else if (row.kind === 'up') {
      if (uploads.applyRemote(body, row.deleted)) uploadsChanged = true;
    } else if (row.kind === 'settings' && !row.deleted) {
      for (const k of SETTINGS_SYNCED) if (k in body && body[k] !== undefined && !(body[k] === null && ['spaces', 'firm'].includes(k))) store.set(k, body[k]);   // leere Felder älterer Geräte überschreiben nichts
    }
  } finally { applying = false; }
}

// ---------- Abgleich ----------
// Wer während eines laufenden Abgleichs fragt („Datei prüfen“), wartet auf den nächsten vollständigen Lauf.
const waiters = [];
async function runNow() {
  if (!syncKey || state.status !== 'on') return;
  if (busy) { again = true; return new Promise((r) => waiters.push(r)); }
  busy = true;
  const mine = waiters.splice(0);
  uploads.beginBatch();   // viele Upload-Einträge vom anderen Gerät: einmal speichern statt je Eintrag
  try {
    const seen = { ...(store.get('syncSeen') || {}) };
    const local0 = localRecords();   // für Löschungen (kommen ohne Inhalt) und Konflikte
    // 1) Neues vom Server holen
    // Cursor aus Zeit + Datensatz-ID (02.11.2026): Viele Einträge eines Hochladens haben dieselbe Zeit – mit „nur Zeit größer“
    // gingen beim ersten Abgleich großer Bestände Einträge dauerhaft verloren. Dazu 5 Minuten Überlappung je Lauf gegen
    // abweichende Uhren; doppelt Gelesenes ist harmlos (bekannter Stand wird übersprungen).
    let saved = store.get('syncCursor');
    if (typeof saved === 'string') saved = { t: saved, rid: '' };
    let cursor = saved && saved.t ? { t: new Date(Date.parse(saved.t) - 5 * 60000).toISOString(), rid: '' } : null;
    let newest = saved && saved.t ? saved : null;
    // Tabs der anderen Geräte immer vollständig lesen (sonst nach jedem Neustart leer)
    try {
      const tabRows = await http('/rest/v1/browser_sync?select=rid,kind,data,deleted,device,changed_at&kind=eq.tabs');
      const list = [];
      for (const row of tabRows || []) {
        if (row.device === deviceId() || row.deleted) continue;
        try { const b = JSON.parse(C.open(syncKey, row.data).toString('utf8')); if (b.tabs && b.tabs.length) list.push({ device: row.device, name: b.name, platform: b.platform, at: b.at, tabs: b.tabs.slice(0, 60) }); } catch { /* nicht lesbar */ }
      }
      remoteTabs = list;
    } catch { /* nächster Lauf */ }
    for (let page = 0; page < 20; page++) {
      const filt = cursor ? `&or=${encodeURIComponent(`(updated_at.gt."${cursor.t}",and(updated_at.eq."${cursor.t}",rid.gt."${cursor.rid}"))`)}` : '';
      const q = `/rest/v1/browser_sync?select=rid,kind,data,deleted,device,changed_at,updated_at&kind=neq.tabs&order=updated_at.asc,rid.asc&limit=500${filt}`;
      const rows = await http(q);
      if (!rows || !rows.length) break;
      for (const row of rows) {
        cursor = { t: row.updated_at, rid: row.rid };
        if (!newest || Date.parse(row.updated_at) > Date.parse(newest.t) || (row.updated_at === newest.t && row.rid > newest.rid)) newest = cursor;
        let body = null;
        try { body = JSON.parse(C.open(syncKey, row.data).toString('utf8')); } catch { continue; }   // nicht entschlüsselbar → überspringen
        const mine = seen[row.rid];
        if (mine && mine.c >= Number(row.changed_at)) continue;    // eigener/neuerer Stand liegt schon vor
        const loc = local0.get(row.rid);
        // Löschung (02.11.2026): kommt ohne Inhalt – den Eintrag über seine ID hier auf dem Gerät finden. Vorher wurde
        // nichts gelöscht und der Eintrag gleich wieder hochgeladen (kam überall zurück).
        if (row.deleted && (row.kind === 'pw' || row.kind === 'bm' || row.kind === 'up')) {
          if (loc) applyRemote(row, loc.body);
          seen[row.rid] = { c: Number(row.changed_at), h: 'x', k: row.kind };
          continue;
        }
        // Offline geänderter, neuerer eigener Stand gewinnt gegen einen älteren vom anderen Gerät (wird gleich hochgeladen).
        if (loc && row.kind === 'pw' && mine && mine.h !== C.mac(syncKey, canon(row.kind, loc.body)) && (Number(loc.changed) || 0) > Number(row.changed_at)) {
          seen[row.rid] = { ...mine, c: Number(row.changed_at) };
          continue;
        }
        applyRemote(row, body);
        seen[row.rid] = { c: Number(row.changed_at), h: row.deleted ? 'x' : C.mac(syncKey, canon(row.kind, body)), k: row.kind };
      }
      // Gemerkten Stand zusammen mit dem Cursor sichern – bricht der Lauf danach ab, gingen fremde Einträge sonst als „neu“ zurück
      if (newest) { store.set('syncSeen', seen); store.set('syncCursor', newest); }
      if (rows.length < 500) break;
    }
    applying = true; try { uploads.endBatch(); } finally { applying = false; }
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
    // Upload-Verlauf: Löschungen nur für Einträge, die Feray selbst gelöscht hat (nie wegen fehlender/unlesbarer Einträge)
    const removed = uploads.removedIds();
    const removedRids = new Set(removed.map((id) => C.rid(syncKey, 'up', id)));
    for (const [rid, s] of Object.entries(seen)) {
      if (s.k === 'up' && !removedRids.has(rid)) continue;
      if ((s.k === 'pw' || s.k === 'bm' || s.k === 'up') && s.h !== 'x' && !local.has(rid)) {
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
    // updated_at mitschicken: rückt den Lese-Cursor der anderen Geräte auch dann vor, wenn die Datenbank die Zeit beim
    // Überschreiben nicht selbst setzt (ein Datenbank-Trigger hat Vorrang).
    const stamp = new Date().toISOString();
    for (const r of up) r.updated_at = stamp;
    for (let i = 0; i < up.length; i += 200) {
      await http('/rest/v1/browser_sync?on_conflict=user_id,rid', { method: 'POST', body: up.slice(i, i + 200), headers: { prefer: 'resolution=merge-duplicates,return=minimal' } });
    }
    store.set('syncSeen', seen);
    if (removed.length) uploads.clearRemoved(removed);
    if (uploadsChanged) { uploadsChanged = false; try { onUploads(); } catch { /* nie kritisch */ } }
    const counts = { passwords: vault.plainEntries().length, bookmarks: (store.get('bookmarks') || []).length, uploads: uploads.all().length };
    emit({ status: 'on', lastSync: Date.now(), message: '', counts });
    if (!rt) realtimeStart();
  } catch (e) {
    if (e.status === 401 || e.status === 403) { realtimeStop(); emit({ status: 'needLogin', message: 'Bitte neu anmelden' }); }
    else emit({ message: 'Abgleich gerade nicht möglich – neuer Versuch gleich' });
  } finally {
    applying = true; try { uploads.endBatch(); } finally { applying = false; }
    busy = false;
    for (const r of mine) r();
    if (again) { again = false; setTimeout(runNow, 500); }
  }
}

function schedulePush(fast) {
  if (applying || state.status !== 'on') return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(runNow, fast ? 300 : 2500);   // neuer Upload: sofort zu den anderen Geräten
}

function init(fetchFn, openTabsFn, onState, onBm, onUp) {
  fetcher = fetchFn; getOpenTabs = openTabsFn || getOpenTabs; notify = onState || notify; onBookmark = onBm || onBookmark; onUploads = onUp || onUploads;
  store.onChange((k) => { if (k === 'uploads') schedulePush(true); else if (['passwords', 'bookmarks', ...SETTINGS_SYNCED].includes(k)) schedulePush(); });
  const k = store.get('syncKey') && decLocal(store.get('syncKey'));
  const auth = store.get('syncAuth') && JSON.parse(decLocal(store.get('syncAuth')) || 'null');
  if (k && auth) {
    syncKey = Buffer.from(k, 'base64'); state.email = auth.email || '';
    emit({ status: 'on' });
    setTimeout(runNow, 4000);
    setTimeout(realtimeStart, 5000);
  } else emit({ status: auth ? 'needLogin' : 'off' });
  clearInterval(timer);
  timer = setInterval(runNow, 60000);
}

// ---------- Sofort-Abgleich (02.11.2026, Feray: Upload auf dem iPhone muss sofort am PC sichtbar sein) ----------
// Statt nur jede Minute nachzusehen, hört das Programm über Supabase Realtime mit, wenn ein anderes Gerät etwas in den
// Abgleich schreibt, und gleicht dann sofort ab. Die Nachricht enthält nur Chiffretext; die Datenbank-Regeln (RLS) gelten.
// Fällt die Verbindung weg, bleibt der Minuten-Takt als Rückfallebene – nie doppelte Abgleiche (runNow bündelt).
let rt = null, rtRef = 0, rtBeat = null, rtRetry = 0, rtTimer = null, rtPull = null, rtToken = '';
function realtimeStop() {
  clearInterval(rtBeat); rtBeat = null; clearTimeout(rtTimer); rtTimer = null;
  if (rt) { try { rt.onclose = null; rt.close(); } catch { /* zu */ } }
  rt = null;
}
async function realtimeStart() {
  if (typeof WebSocket !== 'function' || process.env.IMMOADV_NO_REALTIME || state.status !== 'on' || !syncKey) return;
  if (rt && (rt.readyState === 0 || rt.readyState === 1)) return;
  try { await ensureToken(); } catch { return; }
  realtimeStop();
  const topic = 'realtime:immoadv-sync';
  const ws = new WebSocket(`${URL_BASE.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(APIKEY)}&vsn=1.0.0`);
  rt = ws;
  const sendRt = (event, payload, t = topic) => { try { ws.send(JSON.stringify({ topic: t, event, payload, ref: String(++rtRef), join_ref: '1' })); } catch { /* zu */ } };
  ws.onopen = () => {
    rtToken = session.access;
    sendRt('phx_join', { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table: 'browser_sync', filter: `user_id=eq.${session.userId}` }] }, access_token: rtToken });
    rtBeat = setInterval(async () => {
      sendRt('heartbeat', {}, 'phoenix');
      // Anmeldeschlüssel läuft stündlich ab → neuen an den Kanal geben
      try { await ensureToken(); if (session && session.access !== rtToken) { rtToken = session.access; sendRt('access_token', { access_token: rtToken }); } } catch { /* nächster Takt */ }
    }, 25000);
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.event === 'phx_reply' && m.payload && m.payload.status === 'ok') rtRetry = 0;
    if (m.event !== 'postgres_changes') return;
    const rec = (m.payload && m.payload.data && (m.payload.data.record || m.payload.data.old_record)) || {};
    if (rec.device && rec.device === deviceId()) return;    // eigene Änderung
    clearTimeout(rtPull); rtPull = setTimeout(runNow, 400);
  };
  ws.onclose = () => {
    clearInterval(rtBeat); rtBeat = null;
    if (rt !== ws) return;
    rt = null;
    if (state.status !== 'on') return;
    rtTimer = setTimeout(realtimeStart, Math.min(120000, 2000 * Math.pow(2, rtRetry++)));
  };
  ws.onerror = () => { /* onclose folgt */ };
}

// Lesezeichen, die gerade vom anderen Gerät kamen und in Firefox noch fehlen, nicht als „gelöscht“ werten (2 Minuten Schonfrist)
function keepRecent(list) {
  const now = Date.now(), have = new Set(list.map((b) => b.url)), out = [...list];
  for (const [url, t] of recentRemote) {
    if (now - t > 120000) { recentRemote.delete(url); continue; }
    if (!have.has(url)) { const b = (store.get('bookmarks') || []).find((x) => x.url === url); if (b) out.push(b); }
  }
  return out;
}

module.exports = {
  keepRecent,
  init, login, loginGoogle, mfa, setPassphrase, logout, runNow, tabsChanged: () => { if (state.status === 'on') { clearTimeout(pushTimer); pushTimer = setTimeout(runNow, 15000); } },
  state: () => ({ ...state, remoteTabs }), forSite: (u) => siteOf(u)
};
