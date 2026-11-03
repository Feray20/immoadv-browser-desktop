import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { aufraeumen, veraltet, versionVon } = require('../launcher/altdaten.js');

test('erkennt nur Update-Dateien des ImmoAdv Browsers', () => {
  assert.equal(versionVon('ImmoAdv-Browser-Setup-4.1.29.exe'), '4.1.29');
  assert.equal(versionVon('ImmoAdv-Browser-4.1.30-arm64-mac.zip'), '4.1.30');
  assert.equal(versionVon('ImmoAdv-Browser-4.1.30.dmg.blockmap'), '4.1.30');
  assert.equal(versionVon('Rechnung-4.1.29.pdf'), null);
  assert.equal(versionVon('ImmoAdv-Desktop-2.10.0.dmg'), null);
  assert.equal(versionVon('Firefox Setup 128.0.exe'), null);
});

test('nur ältere Versionen sind veraltet – gleiche und neuere bleiben', () => {
  assert.equal(veraltet('ImmoAdv-Browser-Setup-4.1.29.exe', '4.1.31'), true);
  assert.equal(veraltet('ImmoAdv-Browser-Setup-4.1.31.exe', '4.1.31'), false);
  assert.equal(veraltet('ImmoAdv-Browser-Setup-4.1.32.exe', '4.1.31'), false);
  assert.equal(veraltet('ImmoAdv-Browser-Setup-4.1.9.exe', '4.1.31'), true);   // numerisch, nicht als Text
  assert.equal(veraltet('ImmoAdv-Browser-Setup-4.2.0.exe', '4.1.31'), false);
});

test('räumt auf: alte Dateien weg, aktuelle/neuere/fremde bleiben, Merkzettel wird mitgenommen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'altdaten-'));
  const dl = path.join(dir, 'Downloads'); const cache = path.join(dir, 'pending');
  fs.mkdirSync(dl); fs.mkdirSync(cache);
  const leg = (d, n) => fs.writeFileSync(path.join(d, n), 'x');
  ['ImmoAdv-Browser-4.1.29.dmg', 'ImmoAdv-Browser-4.1.31.dmg', 'Steuer.pdf', 'ImmoAdv-Browser-4.1.30-arm64-mac.zip'].forEach((n) => leg(dl, n));
  ['ImmoAdv-Browser-Setup-4.1.29.exe', 'ImmoAdv-Browser-Setup-4.1.29.exe.blockmap'].forEach((n) => leg(cache, n));
  fs.writeFileSync(path.join(cache, 'update-info.json'), JSON.stringify({ fileName: 'ImmoAdv-Browser-Setup-4.1.29.exe' }));
  const motorNeu = path.join(dir, 'Motor.neu'); fs.mkdirSync(motorNeu);
  const papier = [];
  await aufraeumen({
    aktuell: '4.1.31',
    ordner: [{ pfad: dl, art: 'papierkorb' }, { pfad: cache, art: 'loeschen' }, { pfad: path.join(dir, 'fehlt'), art: 'loeschen' }],
    motorNeu,
    papierkorb: async (p) => { papier.push(path.basename(p)); fs.rmSync(p); },
    log: () => {},
  });
  assert.deepEqual(papier.sort(), ['ImmoAdv-Browser-4.1.29.dmg', 'ImmoAdv-Browser-4.1.30-arm64-mac.zip']);
  assert.deepEqual(fs.readdirSync(dl).sort(), ['ImmoAdv-Browser-4.1.31.dmg', 'Steuer.pdf']);
  assert.deepEqual(fs.readdirSync(cache), []);
  assert.equal(fs.existsSync(motorNeu), true, 'frischer Motor.neu bleibt (Installation könnte laufen)');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('neueres, schon geladenes Update bleibt samt Merkzettel liegen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'altdaten-'));
  fs.writeFileSync(path.join(dir, 'ImmoAdv-Browser-Setup-4.1.32.exe'), 'x');
  fs.writeFileSync(path.join(dir, 'update-info.json'), JSON.stringify({ fileName: 'ImmoAdv-Browser-Setup-4.1.32.exe' }));
  await aufraeumen({ aktuell: '4.1.31', ordner: [{ pfad: dir, art: 'loeschen' }], papierkorb: async () => {}, log: () => {} });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['ImmoAdv-Browser-Setup-4.1.32.exe', 'update-info.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});
