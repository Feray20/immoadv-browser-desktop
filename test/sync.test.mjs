// Geräte-Abgleich: zwei Geräte gegen einen nachgebauten Server (PostgREST/GoTrue-Teilmenge), ohne Electron
import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../src/shared/synccrypto.js');

// ---- nachgebauter Server ----
const db = { keys: null, rows: new Map(), clock: 0 };
const jwt = (o) => 'x.' + Buffer.from(JSON.stringify(o)).toString('base64url') + '.y';
const USER = 'u-1';
async function server(url, opt = {}) {
  const u = new URL(url); const body = opt.body ? JSON.parse(opt.body) : null;
  const ok = (j) => ({ ok: true, status: 200, text: async () => (j == null ? '' : JSON.stringify(j)) });
  if (u.pathname === '/auth/v1/token') {
    if (body.password && body.password !== 'richtig') return { ok: false, status: 400, text: async () => '{"msg":"invalid"}' };
    return ok({ access_token: jwt({ sub: USER, exp: Date.now() / 1000 + 3600, aal: 'aal1' }), refresh_token: 'r', user: { email: 'f@x.de', factors: [] } });
  }
  assert.ok(opt.headers.authorization, 'ohne Anmeldung kein Zugriff');
  if (u.pathname === '/rest/v1/browser_sync_keys') {
    if (opt.method === 'POST') { db.keys = body; return ok(null); }
    return ok(db.keys ? [db.keys] : []);
  }
  if (u.pathname === '/rest/v1/browser_sync') {
    if (opt.method === 'POST') { for (const r of body) { db.clock++; db.rows.set(r.rid, { ...r, updated_at: String(db.clock).padStart(8, '0') }); } return ok(null); }
    const gt = u.searchParams.get('updated_at'); const after = gt ? gt.replace('gt.', '') : '';
    return ok([...db.rows.values()].filter((r) => r.updated_at > after).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)));
  }
  throw new Error('unbekannt ' + u.pathname);
}

// ---- ein „Gerät“ = eigene Modul-Instanzen von store/vault/sync ----
function device(name) {
  const mem = { bookmarks: [], passwords: [] };
  const listeners = [];
  const store = { get: (k) => mem[k], set: (k, v) => { mem[k] = v; listeners.forEach((l) => l(k)); }, onChange: (f) => listeners.push(f) };
  const electron = { safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('E' + s), decryptString: (b) => b.toString().slice(1) }, systemPreferences: {} };
  const orig = Module._load;
  for (const k of Object.keys(require.cache)) if (/src[\\/](main|shared)/.test(k)) delete require.cache[k];
  Module._load = function (req, ...r) { if (req === 'electron') return electron; if (req === './store') return store; return orig.call(this, req, ...r); };
  const vault = require('../src/main/vault.js');
  const sync = require('../src/main/sync.js');
  Module._load = orig;
  mem.syncDevice = name;
  return { mem, store, vault, sync };
}

test('Verschlüsselung: Rundweg, falsches Sync-Passwort scheitert', () => {
  const w = C.newWrappedKey('geheim123');
  assert.deepEqual(C.unwrapKey('geheim123', { salt: w.salt, iterations: w.iterations, wrapped_key: w.wrapped }), w.syncKey);
  assert.throws(() => C.unwrapKey('falsch!!', { salt: w.salt, iterations: w.iterations, wrapped_key: w.wrapped }));
  assert.equal(C.open(w.syncKey, C.seal(w.syncKey, 'Hallo')).toString(), 'Hallo');
  assert.match(C.rid(w.syncKey, 'pw', 'a.de\0u'), /^pw:[0-9a-f]{32}$/);
});

test('Zwei Geräte: Passwort und Lesezeichen wandern, Löschen wird übernommen, Server sieht nur Chiffretext', async () => {
  const A = device('A');
  A.vault.add({ url: 'https://www.immowelt.de/login', user: 'feray', pass: 'Pw-1' });
  A.store.set('bookmarks', [{ title: 'ImmoAdv', url: 'https://immoadv.de', folder: '', tags: [] }]);
  A.sync.init(server, () => [{ url: 'https://a.de', title: 'A' }], () => {});
  await A.sync.login('f@x.de', 'richtig');
  assert.equal(A.sync.state().status, 'needPassphrase');
  await A.sync.setPassphrase('mein-sync-pw');
  assert.equal(A.sync.state().status, 'on');
  const raw = JSON.stringify([...db.rows.values()]);
  assert.ok(!raw.includes('Pw-1') && !raw.includes('immowelt') && !raw.includes('immoadv.de'), 'nur Chiffretext auf dem Server');

  const B = device('B');
  B.sync.init(server, () => [{ url: 'https://b.de', title: 'B' }], () => {});
  await B.sync.login('f@x.de', 'richtig');
  await B.sync.setPassphrase('falsches-pw');
  assert.equal(B.sync.state().status, 'needPassphrase');
  await B.sync.setPassphrase('mein-sync-pw');
  assert.equal(B.sync.state().status, 'on');
  assert.equal(B.vault.plainEntries()[0].pass, 'Pw-1');
  assert.equal(B.mem.bookmarks[0].url, 'https://immoadv.de');
  assert.equal(B.sync.state().remoteTabs[0].tabs[0].url, 'https://a.de');

  // B ändert Passwort und löscht das Lesezeichen → A übernimmt
  B.vault.add({ url: 'https://immowelt.de', user: 'feray', pass: 'Pw-2' });
  B.store.set('bookmarks', []);
  await new Promise((r) => setTimeout(r, 5));
  await B.sync.runNow();
  await A.sync.runNow();
  assert.equal(A.vault.plainEntries()[0].pass, 'Pw-2');
  assert.equal(A.mem.bookmarks.length, 0);
  // kein Hin-und-her: weitere Läufe schreiben nichts Neues
  const n = db.clock; await A.sync.runNow(); await B.sync.runNow(); await A.sync.runNow();
  assert.equal(db.clock, n);
});
