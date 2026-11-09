import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfjsTag } from '../scripts/fetch-vendor.mjs';

// 09.11.2026: 4.1.50 brach ab, weil die GitHub-Weiterleitung keinen Versionsnamen lieferte → Ersatzwege.
const res = (o) => ({ status: 200, ok: true, url: '', arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({}), text: async () => '', ...o });

test('PDF.js: Weiterleitung liefert die Version', async () => {
  assert.equal(await pdfjsTag(async () => res({ url: 'https://github.com/mozilla/pdf.js/releases/tag/v5.4.296' })), 'v5.4.296');
});

test('PDF.js: Weiterleitung ohne Version → API', async () => {
  const f = async (u) => u.includes('api.github.com') ? res({ json: async () => ({ tag_name: 'v5.4.296' }) }) : res({ url: 'https://github.com/mozilla/pdf.js/releases' });
  assert.equal(await pdfjsTag(f), 'v5.4.296');
});

test('PDF.js: API gesperrt → Atom-Feed', async () => {
  const f = async (u) => u.endsWith('.atom') ? res({ text: async () => '<link href="https://github.com/mozilla/pdf.js/releases/tag/v5.4.296"/>' })
    : u.includes('api.github.com') ? res({ status: 403, ok: false }) : res({ status: 429, ok: false, url: 'https://github.com/mozilla/pdf.js/releases/latest' });
  assert.equal(await pdfjsTag(f), 'v5.4.296');
});

test('PDF.js: alles scheitert → Fehler nennt die Gründe', async () => {
  await assert.rejects(pdfjsTag(async () => { throw new Error('offline'); }), /Weiterleitung: offline · API: offline · Feed: offline/);
});
