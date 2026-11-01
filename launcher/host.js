// Native-Messaging-Gegenstelle für die ImmoAdv-Erweiterung im Firefox-Motor.
// Firefox startet das ImmoAdv-Programm dafür selbst (eine Instanz pro Browser-Sitzung) und spricht über stdin/stdout.
// Nur die ImmoAdv-Erweiterung darf verbinden (allowed_extensions im Host-Manifest).
const { app, safeStorage, clipboard, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const vault = require('./vault');
const engine = require('./engine');
const updater = require('./updater');

const SECRET = ['vpnCreds', 'passwords', 'aiKeys', 'neverSave', 'lastSession'];
const SETTABLE = ['blockAds', 'blockMalware', 'blockPhishing', 'freshLists', 'allowlist', 'blocklist', 'httpsOnly', 'cleanLinks', 'dnsProvider',
  'keepSignedIn', 'traceless', 'vpnCountry', 'vpnServers', 'stats', 'autoUpdate', 'bookmarkBar', 'tabLayout', 'suspendMinutes', 'historyDays',
  'restoreSession', 'searchEngine', 'watchlist', 'aiProvider', 'aiModels', 'aiInstructions', 'aiKeepHistory', 'listsInfo'];
const ENGINE_KEYS = ['tabLayout', 'bookmarkBar', 'httpsOnly', 'dnsProvider', 'suspendMinutes', 'historyDays', 'restoreSession', 'searchEngine', 'downloadDir'];
const PROVIDERS = {
  anthropic: { name: 'Claude (Anthropic)', model: 'claude-sonnet-5-5', needsKey: true },
  openai: { name: 'ChatGPT (OpenAI)', model: 'gpt-5-mini', needsKey: true },
  ollama: { name: 'Ollama – lokal auf diesem Computer', model: 'llama3.2', needsKey: false }
};

// ---------- Nachrichtenrahmen: 4 Byte Länge (Little Endian) + JSON ----------
function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  if (body.length > 1024 * 1024 - 8) throw new Error('Antwort zu groß');
  const head = Buffer.alloc(4); head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}
const outputs = new Set();          // verbundene Firefox-Sitzungen (über die Weiterleitung) bzw. stdout
const event = (name, data) => { for (const o of outputs) { try { o.write(frame({ event: name, data })); } catch { /* zu */ } } };

const enc = (s) => safeStorage.encryptString(String(s)).toString('base64');
const dec = (b) => { try { return safeStorage.decryptString(Buffer.from(b, 'base64')); } catch { return null; } };
function publicSettings() {
  const all = store.all();
  for (const k of SECRET) delete all[k];
  all.vpnLoggedIn = !!store.get('vpnCreds');
  return all;
}

let copyTimer = null;
const handlers = {
  ping: () => ({ version: app.getVersion() }),
  'settings.get': () => publicSettings(),
  'settings.set': ({ patch }) => {
    const clean = {};
    for (const k of Object.keys(patch || {})) if (SETTABLE.includes(k)) clean[k] = patch[k];
    store.setMany(clean);
    return publicSettings();
  },
  'engine.set': async ({ patch = {} }) => {
    if (patch.makeDefault) {
      if (process.platform === 'darwin') { app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https'); return { message: 'Bitte in der Mac-Abfrage „ImmoAdv Browser verwenden“ wählen' }; }
      await shell.openExternal('ms-settings:defaultapps?registeredAppUser=' + encodeURIComponent('ImmoAdv Browser')).catch(() => shell.openExternal('ms-settings:defaultapps'));
      return { message: 'Windows-Einstellungen geöffnet: bei „ImmoAdv Browser“ auf „Als Standard festlegen“ klicken' };
    }
    if (patch.chooseDownloadDir) {
      const r = await dialog.showOpenDialog({ title: 'Download-Ordner wählen', properties: ['openDirectory', 'createDirectory'], defaultPath: store.get('downloadDir') || app.getPath('downloads') });
      if (r.canceled || !r.filePaths[0]) return { dir: null };
      store.set('downloadDir', r.filePaths[0]);
      return { dir: r.filePaths[0], restart: true };
    }
    if (patch.restart) { restartBrowser(); return { ok: true }; }
    const restart = Object.keys(patch).some((k) => ENGINE_KEYS.includes(k));
    if (restart) { try { engine.writeEngineConfig(); } catch (e) { engine.log('Motor-Einstellungen: ' + e.message); } }
    return { restart };
  },
  // NordVPN-Zugangsdaten: verschlüsselt (DPAPI/Schlüsselbund), an die Erweiterung nur in den Arbeitsspeicher
  'vpn.creds': () => { const b = store.get('vpnCreds'); if (!b) return null; const j = dec(b); try { return j ? JSON.parse(j) : null; } catch { return null; } },
  'vpn.login': ({ user, pass }) => {
    if (!user || !pass) throw new Error('Bitte beide Felder ausfüllen');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Systemverschlüsselung nicht verfügbar');
    store.set('vpnCreds', enc(JSON.stringify({ user: String(user).trim(), pass: String(pass).trim() })));
    return true;
  },
  'vpn.logout': () => { store.set('vpnCreds', null); return true; },
  // Passwort-Tresor
  'vault.list': () => vault.list(),
  'vault.forUrl': ({ url }) => vault.forUrl(String(url || '')),
  'vault.fill': async ({ id, url }) => {
    const entry = vault.list().find((x) => x.id === id);
    if (!entry || !vault.matches(entry, String(url || ''))) throw new Error('Passt nicht zu dieser Seite');
    const c = await vault.credentialsFor(id);
    if (!c) throw new Error('Freigabe abgebrochen');
    return c;
  },
  'vault.known': ({ url, user, pass }) => vault.known(url, user, pass),
  'vault.save': ({ url, user, pass }) => vault.add({ url, user, pass }),
  'vault.never': ({ url }) => { try { const h = new URL(url).hostname; return (store.get('neverSave') || []).some((d) => h === d || h.endsWith('.' + d)); } catch { return false; } },
  'vault.neverAdd': ({ url }) => { try { const h = new URL(url).hostname.replace(/^www\./, ''); store.set('neverSave', [...new Set([...(store.get('neverSave') || []), h])]); } catch {} return true; },
  'vault.delete': ({ id }) => { vault.remove(id); return vault.list(); },
  'vault.reveal': async ({ id }) => vault.reveal(id),
  'vault.copy': async ({ id }) => {
    const r = await vault.reveal(id); if (!r) return false;
    clipboard.writeText(r.pass);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { try { if (clipboard.readText() === r.pass) clipboard.clear(); } catch {} }, 30000);
    return true;
  },
  'vault.import': async () => {
    const r = await dialog.showOpenDialog({ title: 'Passwörter importieren (CSV)', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const res = vault.importCSV(fs.readFileSync(r.filePaths[0], 'utf8'));
    return res;
  },
  'vault.testUnlock': () => vault.unlock(),
  // KI: Schlüssel verschlüsselt; die Erweiterung fragt damit direkt beim Anbieter an (über NordVPN, falls an)
  'ai.config': () => {
    const provider = PROVIDERS[store.get('aiProvider')] ? store.get('aiProvider') : 'anthropic';
    const p = PROVIDERS[provider];
    const box = (store.get('aiKeys') || {})[provider];
    const key = box ? dec(box) : null;
    return { provider, name: p.name, model: (store.get('aiModels') || {})[provider] || p.model, needsKey: p.needsKey, hasKey: !p.needsKey || !!key, key: key || '' };
  },
  'ai.setKey': ({ provider, key }) => {
    if (!PROVIDERS[provider]) throw new Error('Unbekannter Anbieter');
    const all = { ...(store.get('aiKeys') || {}) };
    if (key) all[provider] = enc(String(key).trim()); else delete all[provider];
    store.set('aiKeys', all);
    return true;
  },
  // Updates
  'update.state': () => updater.state(),
  'update.check': () => { updater.check(); return updater.state(); },
  'update.now': () => { updater.updateNow(); return updater.state(); },
  // Version 3 → 4
  'migrate.v3': () => ({ bookmarks: store.get('bookmarks') || [] }),
  // Dateien vom Desktop (Office-Betrachter): nur Dateien, die das Programm selbst freigegeben hat
  'file.read': ({ token, offset = 0 }) => {
    const f = files.get(String(token || ''));
    if (!f) throw new Error('Datei nicht freigegeben');
    const fd = fs.openSync(f, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.max(0, Math.min(700 * 1024, size - offset));
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      return { name: path.basename(f), size, offset, data: buf.toString('base64') };
    } finally { fs.closeSync(fd); }
  }
};

// Freigegebene Dateien (vom Starter übergeben, z. B. Doppelklick auf eine Word-Datei)
const files = new Map();
function loadShared() {
  try {
    const f = path.join(app.getPath('userData'), 'freigaben.json');
    const list = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const [t, p] of Object.entries(list)) files.set(t, p);
  } catch { /* keine */ }
}

function restartBrowser() {
  // Starter im Hintergrund: wartet, bis der Motor zu ist, richtet ein und startet neu
  const { spawn } = require('node:child_process');
  const args = app.isPackaged ? ['--restart'] : [path.join(__dirname, '..'), '--restart'];
  spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref();
  event('restart', {});
}

// Nachrichten einer Verbindung lesen (gleiches Format wie Native Messaging)
function attach(input, output, onEnd) {
  outputs.add(output);
  let buf = Buffer.alloc(0);
  input.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const raw = buf.subarray(4, 4 + len).toString('utf8');
      buf = buf.subarray(4 + len);
      let msg; try { msg = JSON.parse(raw); } catch { continue; }
      handle(msg, output);
    }
  });
  const end = () => { outputs.delete(output); onEnd(); };
  input.on('end', end); input.on('error', end); input.on('close', end);
}

function common() {
  loadShared();
  updater.setBeforeInstall(() => event('update', { ...updater.state(), status: 'restarting' }));
  updater.init((s) => event('update', s));
}

/** Direkt über stdin/stdout (Mac/Linux-Entwicklung) */
function start() {
  common();
  attach(process.stdin, process.stdout, () => { store.flush(); if (updater.state().status !== 'installing') app.quit(); });
}

/** Hintergrund-Dienst für die Weiterleitung (Windows: benannte Pipe, Mac: Socket) – endet, wenn kein Firefox mehr verbunden ist */
function startServer() {
  const net = require('node:net');
  const os = require('node:os');
  const user = String(process.env.USERNAME || process.env.USER || os.userInfo().username || 'nutzer').replace(/[^\w.-]/g, '_');
  const PIPE = process.platform === 'win32' ? `\\\\.\\pipe\\immoadv-browser-${user}` : path.join(os.tmpdir(), `immoadv-browser-${user}.sock`);
  if (process.platform !== 'win32') { try { fs.unlinkSync(PIPE); } catch { /* keiner */ } }
  common();
  let idle = null;
  const checkIdle = () => {
    clearTimeout(idle);
    if (outputs.size) return;
    idle = setTimeout(() => { if (!outputs.size && updater.state().status !== 'installing' && updater.state().status !== 'downloading') { store.flush(); app.quit(); } }, 90 * 1000);
  };
  const server = net.createServer((conn) => { clearTimeout(idle); attach(conn, conn, checkIdle); });
  server.on('error', (e) => { engine.log('Dienst: ' + e.message); app.quit(); });   // läuft schon (zweiter Start) → beenden
  server.listen(PIPE, () => { if (process.platform !== 'win32') { try { fs.chmodSync(PIPE, 0o600); } catch {} } checkIdle(); });
}

async function handle(msg, out) {
  const send = (o) => { try { out.write(frame(o)); } catch { /* Verbindung weg */ } };
  const fn = handlers[msg.cmd];
  if (!fn) return send({ id: msg.id, ok: false, error: 'Unbekannter Befehl' });
  try { send({ id: msg.id, ok: true, data: await fn(msg) }); }
  catch (e) { send({ id: msg.id, ok: false, error: String((e && e.message) || e) }); }
}

module.exports = { start, startServer };
