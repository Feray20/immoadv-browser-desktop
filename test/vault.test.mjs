// Passwort-Import (CSV) – mit nachgebildeter Systemverschlüsselung, ohne Electron
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
  if (req.endsWith('/store') || req === './store') return { get: (k) => mem[k], set: (k, v) => { mem[k] = v; } };
  return origLoad.call(this, req, ...rest);
};
const vault = require('../launcher/vault.js');

test('CSV aus Apple „Passwörter“ wird verschlüsselt übernommen', () => {
  const csv = 'Title,URL,Username,Password,Notes,OTPAuth\n"Immowelt","https://www.immowelt.de/login","feray@example.de","geh,eim""1",,\nOhne,,x,y,,\n';
  const r = vault.importCSV(csv);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 1);
  const stored = mem.passwords[0];
  assert.equal(stored.site, 'immowelt.de');
  assert.notEqual(stored.pass, 'geh,eim"1');                 // nie im Klartext
  assert.ok(vault.known('https://immowelt.de/x', 'feray@example.de', 'geh,eim"1'));
  assert.deepEqual(vault.forUrl('https://m.immowelt.de/'), [{ id: stored.id, user: 'feray@example.de', host: 'www.immowelt.de', url: 'https://www.immowelt.de/login' }]); // genauer Link der Anmeldeseite (03.11.2026)
});

test('Google-Export (name,url,username,password) und unbekanntes Format', () => {
  assert.equal(vault.importCSV('name,url,username,password\nx,https://a.example.com,u,p\n').added, 1);
  assert.ok(vault.importCSV('foo,bar\n1,2\n').error);
});

test('genau nach Link: Eintrag vom selben Host steht vorne', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const vault = require('../launcher/vault.js');
  vault.add({ url: 'https://signin.ebay.de/ws/eBayISAPI.dll', user: 'shop@example.de', pass: 'a1' });
  vault.add({ url: 'https://developer.ebay.com/signin', user: 'dev@example.de', pass: 'b2' });
  const l = vault.forUrl('https://developer.ebay.com/signin?ru=x');
  assert.equal(l[0].user, 'dev@example.de');
  assert.equal(l[0].url, 'https://developer.ebay.com/signin');
});
