const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/shared/calculator.js');

test('Hessen: 6 % Grunderwerbsteuer, Nebenkosten und Rate', () => {
  const r = C.calculate({ price: 300000, area: 80, coldRent: 1000, land: 'Hessen', equity: 60000, zins: 3.6, tilgung: 2, makler: 3.57, notar: 2, costs: 0 });
  assert.strictEqual(r.grest, 18000);
  assert.strictEqual(Math.round(r.nebenkosten), 18000 + 10710 + 6000);
  assert.strictEqual(Math.round(r.total), 334710);
  assert.strictEqual(Math.round(r.loan), 274710);
  assert.strictEqual(Math.round(r.rate * 100) / 100, Math.round(274710 * 0.056 / 12 * 100) / 100);
  assert.strictEqual(r.pricePerSqm, 3750);
  assert.strictEqual(r.brutto, 4);
  assert.strictEqual(r.faktor, 25);
  assert.ok(r.restschuld10 < r.loan && r.restschuld10 > 0);
});

test('Bayern 3,5 %, Brandenburg 6,5 %', () => {
  assert.strictEqual(C.calculate({ price: 100000, land: 'Bayern' }).grest, 3500);
  assert.strictEqual(C.calculate({ price: 100000, land: 'Brandenburg' }).grest, 6500);
});

test('PLZ → Bundesland', () => {
  assert.strictEqual(C.landFromZip('60311'), 'Hessen');
  assert.strictEqual(C.landFromZip('80331'), 'Bayern');
  assert.strictEqual(C.landFromZip('10115'), 'Berlin');
  assert.strictEqual(C.landFromZip('50667'), 'Nordrhein-Westfalen');
  assert.strictEqual(C.landFromZip('01067'), 'Sachsen');
  assert.strictEqual(C.landFromZip('70173'), 'Baden-Württemberg');
});

test('Deutsche Zahlen lesen', () => {
  assert.strictEqual(C.parseGerman('349.000 €'), 349000);
  assert.strictEqual(C.parseGerman('85,5 m²'), 85.5);
  assert.strictEqual(C.parseGerman('1.250,50'), 1250.5);
  assert.strictEqual(C.parseGerman(420000), 420000);
  assert.strictEqual(C.parseGerman('k. A.'), null);
});
