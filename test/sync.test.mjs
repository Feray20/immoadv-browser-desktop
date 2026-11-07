// Geräte-Abgleich (02.11.2026): Verschlüsselung und Übernahme von Passwörtern – ohne Electron und ohne Netz
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mem = {};
const fakeElectron = {
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('X' + s), decryptString: (b) => b.toString().slice(1) },
  systemPreferences: {}, app: { getPath: () => '/tmp' }
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return fakeElectron;
  if (req.endsWith('/store') || req === './store') return { get: (k) => mem[k], set: (k, v) => { mem[k] = v; }, onChange: () => () => {} };
  return origLoad.call(this, req, ...rest);
};
const C = require('../launcher/synccrypto.js');
const vault = require('../launcher/vault.js');

test('Sync-Schlüssel: nur mit dem richtigen Sync-Passwort zu öffnen, Datensätze Ende-zu-Ende verschlüsselt', () => {
  const w = C.newWrappedKey('richtig-123');
  const k = C.unwrapKey('richtig-123', { salt: w.salt, iterations: w.iterations, wrapped_key: w.wrapped });
  assert.deepEqual(k, w.syncKey);
  assert.throws(() => C.unwrapKey('falsch-123', { salt: w.salt, iterations: w.iterations, wrapped_key: w.wrapped }));
  const box = C.seal(k, JSON.stringify({ pass: 'geheim' }));
  assert.ok(!Buffer.from(box, 'base64').toString('latin1').includes('geheim'));
  assert.equal(JSON.parse(C.open(k, box).toString()).pass, 'geheim');
  assert.equal(C.rid(k, 'pw', 'a\0b'), C.rid(k, 'pw', 'a\0b'));      // gleiche Kennung auf allen Geräten
});

test('Passwort vom anderen Gerät: neu, geändert, gelöscht – verschlüsselt abgelegt', () => {
  mem.passwords = [];
  vault.applySync({ site: 'ebay.de', host: 'signin.ebay.de', user: 'feray', pass: 'p1', changed: 1 }, false);
  assert.equal(mem.passwords.length, 1);
  assert.notEqual(mem.passwords[0].pass, 'p1');
  assert.equal(vault.plainEntries()[0].pass, 'p1');
  vault.applySync({ site: 'ebay.de', host: 'signin.ebay.de', user: 'feray', pass: 'p2', changed: 2 }, false);
  assert.equal(mem.passwords.length, 1);
  assert.equal(vault.plainEntries()[0].pass, 'p2');
  vault.applySync({ site: 'ebay.de', host: 'signin.ebay.de', user: 'feray' }, true);
  assert.equal(mem.passwords.length, 0);
});

test('Datenbank-Adresse (GO-3): nur erlaubte Adressen und öffentliche Schlüssel werden übernommen', () => {
  const sync = require('../launcher/sync.js');
  assert.equal(sync._db().url, 'https://mieoylqhtvghcnvaxutg.supabase.co');
  assert.equal(sync.pruefeConfig({ url: 'https://boese.example.com', key: 'sb_publishable_abcdefghijkl' }), null);
  assert.equal(sync.pruefeConfig({ url: 'https://db.immoadv.de', key: 'service_role_geheim' }), null);
  assert.deepEqual(sync.pruefeConfig({ url: 'https://db.immoadv.de/', key: 'sb_publishable_abcdefghijkl' }), { url: 'https://db.immoadv.de', key: 'sb_publishable_abcdefghijkl' });
  assert.equal(sync.setzeDatenbank({ url: 'https://boese.example.com', key: 'sb_publishable_abcdefghijkl' }), false);
  assert.equal(sync._db().url, 'https://mieoylqhtvghcnvaxutg.supabase.co');
  assert.equal(sync.setzeDatenbank({ url: 'https://db.immoadv.de', key: 'sb_publishable_abcdefghijkl' }), true);
  assert.equal(sync._db().url, 'https://db.immoadv.de');
});
