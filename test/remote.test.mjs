// Claude-Connector (05.11.2026): Sperren im Browser – unabhängig vom Server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function load() {
  const ev = () => ({ addListener() {} });
  const browser = { tabs: { onRemoved: ev(), query: async () => [], get: async (id) => ({ id, url: 'https://www.paypal.com/x' }) }, storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { sendMessage: async () => {} }, browserAction: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} } };
  const ctx = { browser, console, URL, setTimeout, clearTimeout, AbortController, fetch: async () => { throw new Error('kein Netz'); }, Native: { call: async () => ({ access: 'x', device: 'd' }) } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'extension/lib/remote.js'), 'utf8') + '\n;this.Remote = Remote;', ctx);
  return ctx.Remote;
}

test('Claude: Banken, Zahlungen, Konten und interne Adressen gesperrt', () => {
  const R = load();
  for (const u of ['https://www.paypal.com/', 'https://banking.dkb.de/', 'https://www.sparkasse-dieburg.de/', 'https://accounts.google.com/', 'http://127.0.0.1:8080/', 'http://192.168.0.1/', 'file:///C:/x', 'moz-extension://x/pages/settings.html']) assert.equal(R.allowedUrl(u), false, u);
  for (const u of ['https://dev.azure.com/immoadv', 'https://www.ebay.de/sh/ord', 'https://github.com/']) assert.equal(R.allowedUrl(u), true, u);
});

test('Claude: gesperrte Seite lässt sich nicht teilen, Start ist aus', async () => {
  const R = load();
  await assert.rejects(R.share(5, true), /nicht geteilt/);
  assert.equal(R.shared(5), false);
  assert.equal(R.status().on, false);
});

// Audit 10.11.2026 (B02/B03/B04)
test('Claude: Sperrliste ergänzt – weitere Banken, Microsoft-Login, Finanzamt, Konsolen, Webmail, lokale Netze', () => {
  const R = load();
  for (const u of ['https://www.hanseaticbank.de/', 'https://www.barclaycard.de/', 'https://www.1822direkt.de/', 'https://app.mercury.com/', 'https://login.microsoftonline.com/', 'https://www.elster.de/', 'https://www.finanzamt-frankfurt.de/', 'https://www.bzst.de/', 'https://www.irs.gov/', 'https://dash.cloudflare.com/', 'https://supabase.com/dashboard', 'https://admin.immoadv.de/', 'https://git.immoadv.de/', 'https://outlook.office.com/mail', 'https://mail.google.com/', 'http://fritz.box/', 'http://nas.local/', 'http://0.0.0.0:11434/', 'http://100.64.1.2/', 'http://router/']) assert.equal(R.allowedUrl(u), false, u);
  for (const u of ['https://immoadv.de/wissen', 'https://www.kaufland.de/', 'https://www.amazon.de/dp/B000000000']) assert.equal(R.allowedUrl(u), true, u);
});

test('Claude: geteilte Tabs werden nach einem Neustart NICHT aus storage.local wiederhergestellt', async () => {
  const src = fs.readFileSync(path.join(root, 'extension/lib/remote.js'), 'utf8');
  assert.doesNotMatch(src, /storage\.local\.get\('remoteTabs'\)/);
  assert.doesNotMatch(src, /storage\.local\.set\(\{ remoteTabs/);
  assert.match(src, /storage\.session/);
});

test('Claude: Adresse wird direkt vor dem Ausführen erneut geprüft, die Seite vergleicht ihre Adresse', () => {
  const src = fs.readFileSync(path.join(root, 'extension/lib/remote.js'), 'utf8');
  const inPage = src.slice(src.indexOf('async function inPage'), src.indexOf('const info ='));
  assert.match(inPage, /allowedUrl\(t\.url\)/);
  assert.match(inPage, /host: new URL\(t\.url\)\.hostname/);
  const cs = fs.readFileSync(path.join(root, 'extension/content/remote.js'), 'utf8');
  assert.match(cs, /location\.hostname\)\.toLowerCase\(\) !== String\(m\.host\)/);
  assert.match(cs, /SECRET_NAME\.test/);
});
