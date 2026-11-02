// Upload-Verlauf (02.11.2026): Fingerabdruck, Adress-Bereinigung, Portal/Arbeitgeber, Speicher und Abgleich – ohne Netz
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Module from 'node:module';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const mem = {};
const watchers = new Set();
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('X' + s), decryptString: (b) => b.toString().slice(1) }, app: { getPath: () => '/tmp' } };
  if (req === './store' || req.endsWith('/store')) return { get: (k) => mem[k], set: (k, v) => { mem[k] = v; watchers.forEach((f) => f(k)); }, onChange: (f) => { watchers.add(f); return () => watchers.delete(f); } };
  return origLoad.call(this, req, ...rest);
};

const { Sha256, hashBlob } = require('../extension/lib/sha256.js');
const U = require('../extension/lib/uploads-core.js');
const store = require('../launcher/uploads.js');

const nodeHash = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('SHA-256: gleicher Wert wie Node/CryptoKit – auch über Stückgrenzen und bei leerer Datei', () => {
  const sizes = [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 4 * 1024 * 1024 + 7];
  for (const n of sizes) {
    const buf = crypto.randomBytes(n);
    const h = Sha256();
    // in ungleichen Stücken füttern
    let off = 0, step = 1;
    while (off < n) { h.update(buf.subarray(off, off + step)); off += step; step = (step * 7 + 3) % 997 + 1; }
    assert.equal(h.digestHex(), nodeHash(buf), `Größe ${n}`);
  }
  assert.equal(Sha256().digestHex(), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('SHA-256 einer Datei (Blob): Web-Krypto und Stück-Weg liefern dasselbe', async () => {
  const buf = crypto.randomBytes(300000);
  const blob = new Blob([buf]);
  assert.equal(await hashBlob(blob), nodeHash(buf));
  const h = Sha256(); h.update(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(h.digestHex(), nodeHash(buf));
});

test('Adresse: keine Zugangsschlüssel, Sitzungen, Tracking oder Mailadressen', () => {
  assert.equal(U.cleanUrl('https://karriere.firma.de/apply?jobId=4711&token=abc&session=1&utm_source=x&email=a%40b.de#step2'), 'https://karriere.firma.de/apply?jobId=4711');
  assert.equal(U.cleanUrl('https://user:pw@x.de/a'), 'https://x.de/a');
  assert.equal(U.cleanUrl('https://x.de/r/' + 'A'.repeat(48) + '/upload'), 'https://x.de/r/…/upload');
  assert.equal(U.cleanUrl('https://x.de/?ref=' + 'Zx9'.repeat(20)), 'https://x.de/');
  assert.equal(U.cleanUrl('file:///C:/geheim.pdf'), '');
  assert.equal(U.cleanUrl('kein link'), '');
});

test('Portal und Arbeitgeber: Arbeitgeber nur, wenn die Adresse ihn eindeutig nennt', () => {
  assert.deepEqual(U.detect('https://www.stepstone.de/stellenangebote--Logistiker-Darmstadt'), { portal: 'StepStone', employer: '' });
  assert.deepEqual(U.detect('https://de.indeed.com/viewjob?jk=1'), { portal: 'Indeed', employer: '' });
  assert.deepEqual(U.detect('https://roche.wd3.myworkdayjobs.com/de-DE/roche-ext/job/1'), { portal: 'Workday', employer: 'Roche' });
  assert.deepEqual(U.detect('https://te-connectivity.jobs.personio.de/job/1'), { portal: 'Personio', employer: 'Te Connectivity' });
  assert.deepEqual(U.detect('https://jobs.lever.co/acme/123/apply'), { portal: 'Lever', employer: 'Acme' });
  assert.deepEqual(U.detect('https://karriere.merckgroup.com/de/job/1'), { portal: 'karriere.merckgroup.com', employer: '' });
});

test('Dokumenttyp nur aus dem Dateinamen (Vermutung)', () => {
  assert.equal(U.docType('Lebenslauf_Feray.pdf'), 'Lebenslauf');
  assert.equal(U.docType('CV 2026.pdf'), 'Lebenslauf');
  assert.equal(U.docType('Anschreiben-Roche.pdf'), 'Anschreiben');
  assert.equal(U.docType('Arbeitszeugnis_VW.pdf'), 'Arbeitszeugnis');
  assert.equal(U.docType('Staplerschein.pdf'), 'Zertifikat');
  assert.equal(U.docType('scan0001.pdf'), 'Sonstiges');
});

test('Datensatz: kein erfundener Hash, Status startet bei „ausgewählt“', () => {
  const r = U.record({ id: 'a1b2c3d4e5', file: { name: 'Lebenslauf.pdf', size: 1234, mime: 'application/pdf', sha256: 'kaputt' }, pageUrl: 'https://www.stepstone.de/x?token=1', pageTitle: ' Bewerbung  Logistiker ', at: 5 });
  assert.equal(r.sha256, '');
  assert.equal(r.status, 'SELECTED');
  assert.equal(r.url, 'https://www.stepstone.de/x');
  assert.equal(r.title, 'Bewerbung Logistiker');
  assert.equal(r.docType, 'Lebenslauf');
});

test('Speicher: hinzufügen, Status nur vorwärts, löschen, Eintrag vom anderen Gerät', () => {
  mem.uploads = [];
  const dev = { id: 'dev-pc', name: 'Windows-PC (feray)', platform: 'windows' };
  const h = 'a'.repeat(64);
  const added = store.add([{ id: 'e1e1e1e1e1', name: 'Lebenslauf.pdf', size: 10, sha256: h, at: 100, status: 'TRANSFER_COMPLETED', url: 'javascript:alert(1)' }], dev);
  assert.deepEqual(added, ['e1e1e1e1e1']);
  assert.equal(mem.uploads[0].status, 'SELECTED');            // Erweiterung kann keinen Status vortäuschen
  assert.equal(mem.uploads[0].url, '');                       // nur http(s)
  assert.equal(mem.uploads[0].device, 'dev-pc');
  assert.deepEqual(store.add([{ id: 'e1e1e1e1e1', name: 'x' }], dev), []);   // doppelt → nicht nochmal
  store.setStatus(['e1e1e1e1e1'], 'TRANSFER_STARTED', 'r1');
  store.setStatus(['e1e1e1e1e1'], 'TRANSFER_COMPLETED', 'r1');
  store.setStatus(['e1e1e1e1e1'], 'SELECTED');
  assert.equal(mem.uploads[0].status, 'TRANSFER_COMPLETED');
  store.applyRemote({ id: 'f2f2f2f2f2', name: 'Anschreiben.pdf', size: 5, sha256: 'b'.repeat(64), at: 200, device: 'iphone', platform: 'ios', status: 'SELECTED' }, false);
  assert.equal(mem.uploads.length, 2);
  assert.equal(mem.uploads[0].id, 'f2f2f2f2f2');              // neueste zuerst
  store.applyRemote({ ...mem.uploads[1], status: 'SELECTED' }, false);   // älterer Stand vom anderen Gerät
  assert.equal(mem.uploads.find((x) => x.id === 'e1e1e1e1e1').status, 'TRANSFER_COMPLETED');
  store.applyRemote({ id: 'f2f2f2f2f2' }, true);
  assert.equal(mem.uploads.length, 1);
  assert.equal(store.remove(['e1e1e1e1e1']), 1);
  assert.equal(mem.uploads.length, 0);
});

test('Liste seitenweise (Nachrichten an die Erweiterung bleiben unter 1 MB)', () => {
  mem.uploads = [];
  const dev = { id: 'd', name: 'PC', platform: 'windows' };
  for (let i = 0; i < 40; i++) store.add(Array.from({ length: 50 }, (_, j) => ({ id: `id${String(i * 50 + j).padStart(8, '0')}`, name: 'Bewerbung_' + 'x'.repeat(200) + '.pdf', size: 1, sha256: 'c'.repeat(64), title: 't'.repeat(300), url: 'https://x.de/' + 'p'.repeat(900), at: i * 50 + j })), dev);
  assert.equal(mem.uploads.length, 2000);
  const p = store.page(0);
  assert.ok(Buffer.byteLength(JSON.stringify(p)) < 1024 * 1024 - 8, 'Seite zu groß');
  assert.equal(p.total, 2000);
  let n = 0, off = 0;
  while (off < 2000) { const q = store.page(off); assert.ok(q.items.length > 0); n += q.items.length; off += q.items.length; }
  assert.equal(n, 2000);
});
