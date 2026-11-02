// Version 4: Hintergrund der ImmoAdv-Erweiterung mit nachgebildeter Firefox-Schnittstelle (Blocker, saubere Links, VPN-Notaus)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function load({ creds = null } = {}) {
  const listsSrc = fs.readFileSync(path.join(root, 'src/shared/lists.js'), 'utf8').replace(/module\.exports\s*=\s*(\{[^}]*\});?\s*$/m, 'self.ImmoLists = $1;');
  const ev = () => { const l = []; return { addListener: (f) => l.push(f), removeListener: (f) => { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); }, _l: l }; };
  const storage = {}; const sent = [];
  const reply = (m) => ({ 'settings.get': { blockAds: true, allowlist: ['meinebank.de'] }, 'vpn.creds': creds, 'vault.list': [], 'update.state': { status: 'current' }, 'migrate.v3': { bookmarks: [] } }[m.cmd] ?? null);
  const browser = {
    runtime: { connectNative() { const p = { onMessage: ev(), onDisconnect: ev(), postMessage(m) { sent.push(m); setTimeout(() => p.onMessage._l.forEach((f) => f({ id: m.id, ok: true, data: reply(m) })), 1); } }; return p; },
      getURL: (p) => 'moz-extension://x/' + p, onMessage: ev(), sendMessage: async () => {}, getManifest: () => ({ version: '4.0.0' }) },
    storage: { local: { get: async (k) => (typeof k === 'string' ? { [k]: storage[k] } : Object.fromEntries((k || []).map((x) => [x, storage[x]]))), set: async (o) => Object.assign(storage, o), remove: async () => {} } },
    theme: { update: async () => {} }, webRequest: { onBeforeRequest: ev(), onAuthRequired: ev(), onHeadersReceived: ev(), onCompleted: ev(), onErrorOccurred: ev() }, webNavigation: { onCommitted: ev() },
    tabs: { onRemoved: ev(), onUpdated: ev(), query: async () => [], executeScript: async () => [] },
    browserAction: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    proxy: { onRequest: ev(), onError: ev() }, cookies: { getAll: async () => [] }, browsingData: { remove: async () => {} },
    alarms: { create() {}, onAlarm: ev() }, menus: { removeAll: async () => {}, create() {}, onClicked: ev() },
    bookmarks: { getTree: async () => [{ children: [{ id: 'menu________' }, { id: 'toolbar_____' }] }], search: async () => [], create: async () => ({ id: 'n' }), getChildren: async () => [], update: async () => ({}), remove: async () => {}, onCreated: ev(), onRemoved: ev(), onChanged: ev(), onMoved: ev() },
    windows: { getAll: async () => [], onRemoved: ev(), create: async () => ({ id: 1 }) }
  };
  const lists = { werbung: ['doubleclick.net'], malware: ['bad.example'], phishing: ['phish.example'], sources: {} };
  const ctx = { browser, console, crypto: globalThis.crypto, Intl, URLSearchParams, clearInterval, setTimeout, clearTimeout, setInterval, URL, TextEncoder, btoa, AbortController, navigator: { onLine: false }, window: { addEventListener() {} },
    fetch: async (u) => { const m = /lists\/(\w+)\.json/.exec(u); return m ? { ok: true, json: async () => lists[m[1]] } : { ok: false, status: 503, json: async () => null }; } };
  ctx.self = ctx; vm.createContext(ctx);
  let code = listsSrc + '\n;\n';
  for (const f of ['lib/native.js', 'lib/settings.js', 'lib/theme.js', 'lib/blocker.js', 'lib/vpn.js', 'lib/traceless.js', 'lib/vault.js', 'lib/uploads-core.js', 'lib/uploadtrack.js', 'background.js']) code += fs.readFileSync(path.join(root, 'extension', f), 'utf8') + '\n;\n';
  vm.runInContext(code, ctx, { filename: 'background.js' });
  return { browser, sent };
}
const j = (x) => JSON.parse(JSON.stringify(x));   // Objekte aus der Sandbox vergleichbar machen
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Blocker: Werbung fremder Seiten, Malware-Warnseite, Ausnahmen, saubere Links', async () => {
  const { browser } = load(); await wait(80);
  const raw = browser.webRequest.onBeforeRequest._l[0]; const on = (d) => j(raw(d));
  assert.deepEqual(on({ url: 'https://ad.doubleclick.net/a.js', type: 'script', tabId: 1, documentUrl: 'https://www.spiegel.de/' }), { cancel: true });
  assert.deepEqual(on({ url: 'https://ad.doubleclick.net/a.js', type: 'script', tabId: 1, documentUrl: 'https://www.meinebank.de/' }), {});   // Ausnahme
  assert.match(on({ url: 'https://bad.example/x', type: 'main_frame', tabId: 1 }).redirectUrl, /blocked\.html\?k=malware/);
  assert.deepEqual(on({ url: 'https://shop.de/?utm_source=a&id=2', type: 'main_frame', tabId: 1 }), { redirectUrl: 'https://shop.de/?id=2' });
});

test('NordVPN: ohne Anmeldung direkt, mit Anmeldung nie ungeschützt (Notaus) und lokale Geräte direkt', async () => {
  const off = load(); await wait(80);
  assert.deepEqual(j(off.browser.proxy.onRequest._l[0]({ url: 'https://x.de/', tabId: 1 })), { type: 'direct' });
  const on = load({ creds: { user: 'u', pass: 'p' } }); await wait(120);
  const pr = on.browser.proxy.onRequest._l[0]; const px = (d) => j(pr(d));
  const r = px({ url: 'https://x.de/', tabId: 1 });
  const first = Array.isArray(r) ? r[0] : r;
  assert.equal(first.type, 'https');                          // kein Rückfall auf „direct“, auch ohne Serverliste
  assert.notEqual(first.host, undefined);
  assert.deepEqual(px({ url: 'http://192.168.1.10/', tabId: 1 }), { type: 'direct' });
});

test('Upload-Verlauf: Auswahl wird mit bereinigter Adresse gemeldet, Übertragung ehrlich verfolgt', async () => {
  const { browser, sent } = load(); await wait(80);
  const onMsg = browser.runtime.onMessage._l[0];
  const tab = { id: 7, url: 'https://roche.wd3.myworkdayjobs.com/de-DE/ext/job/1/apply?token=geheim', title: 'Bewerbung Logistiker' };
  const ok = await onMsg({ type: 'upload:selected', via: 'input', frameUrl: tab.url, files: [{ name: 'Lebenslauf.pdf', size: 5000, mime: 'application/pdf', sha256: 'e'.repeat(64) }] }, { tab });
  assert.equal(ok, true);
  const add = sent.find((m) => m.cmd === 'uploads.add');
  assert.ok(add, 'nicht an das Programm gemeldet');
  const r = add.recs[0];
  assert.equal(r.url, 'https://roche.wd3.myworkdayjobs.com/de-DE/ext/job/1/apply');
  assert.equal(r.portal, 'Workday'); assert.equal(r.employer, 'Roche'); assert.equal(r.status, 'SELECTED'); assert.equal(r.docType, 'Lebenslauf');
  // Anfrage dieses Tabs mit dem Dateinamen im Formular → Übertragung gestartet, 200 → übertragen
  const before = browser.webRequest.onBeforeRequest._l.at(-1), done = browser.webRequest.onCompleted._l.at(-1);
  before({ requestId: 'q1', tabId: 7, method: 'POST', url: 'https://x/upload', requestBody: { formData: { file: ['Lebenslauf.pdf'] } } });
  done({ requestId: 'q1', tabId: 7, statusCode: 200 });
  await wait(10);
  const st = sent.filter((m) => m.cmd === 'uploads.status').map((m) => m.status);
  assert.deepEqual(st, ['TRANSFER_STARTED', 'TRANSFER_COMPLETED']);
  // Anfrage eines anderen Tabs oder ohne Datei → keine Zuordnung
  before({ requestId: 'q2', tabId: 8, method: 'POST', url: 'https://x/upload', requestBody: { formData: { file: ['Lebenslauf.pdf'] } } });
  before({ requestId: 'q3', tabId: 7, method: 'POST', url: 'https://x/log', requestBody: { formData: { a: ['b'] } } });
  await wait(10);
  assert.equal(sent.filter((m) => m.cmd === 'uploads.status').length, 2);
});
