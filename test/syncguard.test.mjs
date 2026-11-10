// Audit B01/B09 (10.11.2026): Der Abgleich löscht nichts auf allen Geräten, nur weil lokal etwas nicht lesbar oder leer ist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { deletionsAllowed } = createRequire(import.meta.url)('../launcher/syncguard.js');
const ok = { enc: true, total: 40, readable: 40, seen: 40, missing: 1 };
const bm = { local: 100, seen: 100, missing: 2 };

test('Normalfall: einzelne Löschungen gehen an die anderen Geräte', () => {
  assert.deepEqual(deletionsAllowed({ pw: ok, bm }), { pw: true, bm: true, why: [] });
});
test('Passwort nicht entschlüsselbar (z. B. Schlüsselbund verweigert) → keine Passwort-Löschungen', () => {
  const r = deletionsAllowed({ pw: { ...ok, readable: 0, missing: 40 }, bm });
  assert.equal(r.pw, false); assert.equal(r.bm, true); assert.match(r.why[0], /nicht lesbar/);
  assert.equal(deletionsAllowed({ pw: { ...ok, readable: 39 }, bm }).pw, false, 'schon eines reicht');
});
test('Verschlüsselung des Systems nicht verfügbar → keine Passwort-Löschungen', () => {
  assert.equal(deletionsAllowed({ pw: { ...ok, enc: false }, bm }).pw, false);
});
test('Lesezeichen-Liste leer → nie „alles gelöscht“; Massen-Verschwinden wird gebremst', () => {
  assert.equal(deletionsAllowed({ pw: ok, bm: { local: 0, seen: 100, missing: 100 } }).bm, false);
  assert.equal(deletionsAllowed({ pw: ok, bm: { local: 30, seen: 100, missing: 70 } }).bm, false);
  assert.equal(deletionsAllowed({ pw: { ...ok, missing: 25 }, bm }).pw, false);
  assert.equal(deletionsAllowed({ pw: ok, bm: { local: 2, seen: 4, missing: 2 } }).bm, true, 'kleine Bestände: echte Löschungen bleiben möglich');
});
