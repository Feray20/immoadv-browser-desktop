import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseLine, parseList, cleanDomain, siteOf, inSet, NEVER } = require('../src/shared/lists.js');
const { parseBookmarksHTML, bookmarksHTML } = require('../src/shared/bookmarks.js');

test('Filterlisten: Zeilenformate werden erkannt', () => {
  assert.equal(parseLine('ads.example.com'), 'ads.example.com');
  assert.equal(parseLine('0.0.0.0 tracker.example.com'), 'tracker.example.com');
  assert.equal(parseLine('||pixel.example.net^'), 'pixel.example.net');
  assert.equal(parseLine('local=/ads.example.de/'), 'ads.example.de');
  assert.equal(parseLine('# Kommentar'), null);
  assert.equal(parseLine('localhost'), null);
});

test('Filterlisten: wichtige Seiten werden nie blockiert, Subdomains greifen', () => {
  const list = parseList('example.com\nads.example.com\ngoogle.com\napple.com\n', NEVER);
  assert.ok(!list.includes('google.com'));
  assert.ok(!list.includes('apple.com'));
  const set = new Set(list);
  assert.ok(inSet(set, 'x.ads.example.com'));
  assert.ok(inSet(set, 'example.com'));
  assert.ok(!inSet(set, 'myexample.com'));
});

test('Registrierbare Domain (Spurlos/Passwörter)', () => {
  assert.equal(siteOf('www.immobilienscout24.de'), 'immobilienscout24.de');
  assert.equal(siteOf('login.example.co.uk'), 'example.co.uk');
  assert.equal(cleanDomain('https://www.Example.com/pfad'), 'example.com');
});

test('Lesezeichen: Import aus Chrome-HTML mit Ordnern, Export und Re-Import', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
    <DT><H3>Lesezeichenleiste</H3><DL><p>
      <DT><A HREF="https://immoadv.de/" ADD_DATE="1">ImmoAdv</A>
      <DT><H3>Immobilien</H3><DL><p>
        <DT><A HREF="https://www.immowelt.de/" TAGS="suche,kauf">Immowelt &amp; Co</A>
      </DL><p>
    </DL><p>
    <DT><A HREF="javascript:alert(1)">Böse</A>
  </DL><p>`;
  const b = parseBookmarksHTML(html);
  assert.equal(b.length, 2);
  assert.deepEqual(b[0], { title: 'ImmoAdv', url: 'https://immoadv.de/', folder: '', tags: [] });
  assert.equal(b[1].folder, 'Immobilien');
  assert.equal(b[1].title, 'Immowelt & Co');
  assert.deepEqual(b[1].tags, ['suche', 'kauf']);
  const again = parseBookmarksHTML(bookmarksHTML(b));
  assert.deepEqual(again, b);
});
