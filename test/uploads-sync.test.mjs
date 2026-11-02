// Upload-Verlauf über den Geräte-Abgleich (02.11.2026): Upload auf Gerät A erscheint auf Gerät B, Löschen kommt überall an,
// der Server sieht nur Chiffretext. Zwei getrennte Programm-Instanzen gegen einen nachgebauten Abgleich-Server – ohne Netz.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Module from 'node:module';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.IMMOADV_NO_REALTIME = '1';   // Tests ohne Netz
const launcher = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'launcher');

// ---------- nachgebauter Server (PostgREST-artig, nur was sync.js nutzt) ----------
const rows = new Map();   // rid → row
let clock = Date.parse('2026-11-02T10:00:00Z');
const jwt = (sub) => `x.${Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600, aal: 'aal1', email: 'f@x.de' })).toString('base64url')}.y`;
const keyRow = {};
async function fakeFetch(url, opt = {}) {
  const u = new URL(url);
  const ok = (j) => ({ ok: true, status: 200, text: async () => (j == null ? '' : JSON.stringify(j)) });
  if (u.pathname === '/auth/v1/token') return ok({ access_token: jwt('user-1'), refresh_token: 'r' });
  if (u.pathname === '/rest/v1/browser_sync_keys') return ok(keyRow.v ? [keyRow.v] : []);
  if (u.pathname === '/rest/v1/browser_sync' && opt.method === 'POST') {
    for (const r of JSON.parse(opt.body)) { if (r.kind === 'up') assert.ok(!/Lebenslauf|stepstone/i.test(r.data), 'Klartext beim Server!'); clock += 1; rows.set(r.rid, { ...r, updated_at: new Date(clock).toISOString() }); }
    return ok(null);
  }
  if (u.pathname === '/rest/v1/browser_sync') {
    const kind = u.searchParams.get('kind');
    let list = [...rows.values()];
    if (kind === 'eq.tabs') list = list.filter((r) => r.kind === 'tabs');
    else list = list.filter((r) => r.kind !== 'tabs');
    const or = u.searchParams.get('or');
    if (or) { const t = /updated_at\.gt\."([^"]+)"/.exec(or)[1]; list = list.filter((r) => r.updated_at >= t); }
    list.sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.rid.localeCompare(b.rid));
    return ok(list);
  }
  return { ok: false, status: 404, text: async () => '' };
}

// ---------- eine Programm-Instanz = eigener Speicher + frisch geladene Module ----------
function device(name) {
  const mem = { syncDevice: name };
  const watchers = new Set();
  const fakeStore = { get: (k) => mem[k], set: (k, v) => { mem[k] = v; watchers.forEach((f) => f(k)); }, onChange: (f) => { watchers.add(f); return () => watchers.delete(f); } };
  const orig = Module._load;
  Module._load = function (req, parent, ...rest) {
    if (req === 'electron') return { safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('X' + s), decryptString: (b) => b.toString().slice(1) }, app: { getPath: () => '/tmp' }, systemPreferences: {} };
    if (req === './store') return fakeStore;
    return orig.call(this, req, parent, ...rest);
  };
  for (const k of Object.keys(require.cache)) if (k.startsWith(launcher)) delete require.cache[k];
  const sync = require(path.join(launcher, 'sync.js'));
  const uploads = require(path.join(launcher, 'uploads.js'));
  Module._load = orig;
  return { mem, sync, uploads };
}

test('Upload auf dem PC → sofort auf dem zweiten Gerät; Löschen kommt überall an', async () => {
  const pc = device('pc-1'), mac = device('mac-1');
  // gleiche Anmeldung + gleicher Sync-Schlüssel auf beiden
  for (const d of [pc, mac]) d.mem.syncAuth = Buffer.from('X' + JSON.stringify({ refresh: 'r', email: 'f@x.de' })).toString('base64');
  const key = crypto.randomBytes(32).toString('base64');
  for (const d of [pc, mac]) d.mem.syncKey = Buffer.from('X' + key).toString('base64');
  pc.sync.init(fakeFetch, () => [], () => {}, () => {}, () => {});
  let macSaw = 0;
  mac.sync.init(fakeFetch, () => [], () => {}, () => {}, () => { macSaw++; });
  await pc.sync.runNow(); await mac.sync.runNow();

  pc.uploads.add([{ id: 'up-0000-0001', name: 'Lebenslauf.pdf', size: 1000, sha256: 'd'.repeat(64), at: Date.now(), url: 'https://www.stepstone.de/x', portal: 'StepStone', domain: 'stepstone.de' }],
    { id: 'pc-1', name: 'Windows-PC (feray)', platform: 'windows' });
  pc.uploads.setStatus(['up-0000-0001'], 'TRANSFER_COMPLETED', 'r9');
  await pc.sync.runNow();
  assert.ok([...rows.values()].some((r) => r.kind === 'up'), 'Upload nicht beim Server');

  await mac.sync.runNow();
  const got = mac.mem.uploads || [];
  assert.equal(got.length, 1);
  assert.equal(got[0].name, 'Lebenslauf.pdf');
  assert.equal(got[0].status, 'TRANSFER_COMPLETED');
  assert.equal(got[0].deviceName, 'Windows-PC (feray)');
  assert.ok(macSaw >= 1, 'Verlaufsseite wurde nicht benachrichtigt');

  // Löschen auf dem Mac → verschwindet auch am PC
  mac.uploads.remove(['up-0000-0001']);
  await mac.sync.runNow();
  await pc.sync.runNow();
  assert.equal((pc.mem.uploads || []).length, 0);
  // und kommt beim nächsten Abgleich nicht zurück
  await mac.sync.runNow(); await pc.sync.runNow();
  assert.equal((mac.mem.uploads || []).length, 0);
  assert.equal((pc.mem.uploads || []).length, 0);
  pc.sync.logout(); mac.sync.logout();
});
