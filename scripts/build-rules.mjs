// Lädt beim Build gepflegte, seriöse Filterlisten und legt sie als Domainlisten ins Programm.
// Aufruf: node scripts/build-rules.mjs            → Listen laden (Fehler = Abbruch, nie ohne Schutz ausliefern)
//         node scripts/build-rules.mjs --offline  → kleine Testlisten für die lokale Entwicklung
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parseList } = require('../src/shared/lists.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'vendor', 'lists');
const offline = process.argv.includes('--offline');

export const LISTS = {
  werbung: {
    name: 'HaGeZi Multi PRO (Werbung, Tracking, Fingerprinting, Telemetrie)', license: 'GPL-3.0', home: 'https://github.com/hagezi/dns-blocklists', min: 50000,
    urls: ['https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/pro-onlydomains.txt',
      'https://raw.githubusercontent.com/hagezi/dns-blocklists/refs/heads/main/dnsmasq/pro.txt',
      'https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/wildcard/pro-onlydomains.txt']
  },
  malware: {
    name: 'URLhaus (abuse.ch) über malware-filter', license: 'CC0-1.0', home: 'https://gitlab.com/malware-filter/urlhaus-filter', min: 200,
    urls: ['https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains.txt', 'https://curbengh.github.io/urlhaus-filter/urlhaus-filter-domains.txt']
  },
  phishing: {
    name: 'Phishing-Filter (OpenPhish, PhishTank, PhishStats) über malware-filter', license: 'CC0-1.0', home: 'https://gitlab.com/malware-filter/phishing-filter', min: 500,
    urls: ['https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt', 'https://curbengh.github.io/phishing-filter/phishing-filter-domains.txt']
  }
};
const SAMPLE = { werbung: 'doubleclick.net\ngoogle-analytics.com\ngoogletagmanager.com\nhotjar.com\n', malware: 'malware-test.immoadv-test.invalid\n', phishing: 'phishing-test.immoadv-test.invalid\n' };

async function download(urls) {
  for (const u of urls) {
    try { const r = await fetch(u, { headers: { 'User-Agent': 'immoadv-build' } }); if (r.ok) return await r.text(); console.warn(`  ${u}: HTTP ${r.status}`); }
    catch (e) { console.warn(`  ${u}: ${e.message}`); }
  }
  return null;
}

fs.mkdirSync(out, { recursive: true });
const sources = {};
for (const [kind, l] of Object.entries(LISTS)) {
  const text = offline ? SAMPLE[kind] : await download(l.urls);
  if (!text) throw new Error(`Liste „${kind}“ konnte nicht geladen werden – Abbruch, damit kein Programm ohne Schutz ausgeliefert wird.`);
  const domains = parseList(text);
  if (!offline && domains.length < l.min) throw new Error(`Liste „${kind}“ hat nur ${domains.length} Einträge – vermutlich defekt. Abbruch.`);
  fs.writeFileSync(path.join(out, `${kind}.json`), JSON.stringify(domains));
  sources[kind] = { name: l.name, license: l.license, home: l.home, count: domains.length, date: new Date().toISOString(), urls: l.urls };
  console.log(`${kind}: ${domains.length} Domains`);
}
fs.writeFileSync(path.join(out, 'sources.json'), JSON.stringify(sources, null, 2));
