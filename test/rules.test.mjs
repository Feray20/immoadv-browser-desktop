import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseList, buildRules, cleanDomain, NEVER, CHUNK } from '../extension/lib/rules.js';

test('Zeilenformate werden erkannt', () => {
  assert.equal(parseLine('ads.example.com'), 'ads.example.com');
  assert.equal(parseLine('0.0.0.0 tracker.example.com'), 'tracker.example.com');
  assert.equal(parseLine('||pixel.example.net^'), 'pixel.example.net');
  assert.equal(parseLine('*.metrics.example.org'), 'metrics.example.org');
  assert.equal(parseLine('# Kommentar'), null);
  assert.equal(parseLine('! Kommentar'), null);
  assert.equal(parseLine('localhost'), null);
  assert.equal(parseLine('127.0.0.1'), null);
  assert.equal(parseLine('kein domain'), null);
  assert.equal(parseLine('Example.COM.'), 'example.com');
});

test('Subdomains bereits gelisteter Domains fallen weg, Schutzliste greift', () => {
  const d = parseList('example.com\nads.example.com\nx.y.example.com\nother.net\ngoogle.com\napple.com\n', NEVER);
  assert.deepEqual(d, ['example.com', 'other.net']);
});

test('Werbe-Regeln blockieren keine Seitenaufrufe', () => {
  const r = buildRules(['a.com', 'b.com'], 'werbung', 1);
  assert.equal(r.length, 1);
  assert.equal(r[0].action.type, 'block');
  assert.deepEqual(r[0].condition.excludedResourceTypes, ['main_frame']);
});

test('Malware-Regeln: Warnseite für Seitenaufruf, Block für den Rest, eindeutige IDs', () => {
  const domains = Array.from({ length: CHUNK + 5 }, (_, i) => `m${i}.example`);
  const r = buildRules(domains, 'malware', 100);
  assert.equal(r.length, 4);
  assert.equal(r[0].action.type, 'redirect');
  assert.equal(r[0].action.redirect.extensionPath, '/blocked.html#malware');
  assert.equal(r[1].action.type, 'block');
  assert.deepEqual(r.map((x) => x.id), [100, 101, 102, 103]);
  assert.equal(new Set(r.flatMap((x) => x.condition.requestDomains)).size, CHUNK + 5);
});

test('Eingaben werden zu sauberen Domains', () => {
  assert.equal(cleanDomain('https://www.Beispiel.de/pfad?x=1'), 'beispiel.de');
  assert.equal(cleanDomain('immoadv.de'), 'immoadv.de');
  assert.equal(cleanDomain('kein gültiger text'), null);
  assert.equal(cleanDomain(''), null);
});
