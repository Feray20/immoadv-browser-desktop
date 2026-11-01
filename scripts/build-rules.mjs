// Baut die Filterregeln der ImmoAdv-Erweiterung aus gepflegten, seriösen Listen
// und schreibt Version + Herkunft. Läuft bei jedem Build (CircleCI).
// Aufruf: node scripts/build-rules.mjs            → Listen laden (Fehler = Build-Abbruch, nie leere Listen ausliefern)
//         node scripts/build-rules.mjs --offline  → kleine Testregeln für die lokale Entwicklung
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseList, buildRules, NEVER } from '../extension/lib/rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'extension', 'rules');
const offline = process.argv.includes('--offline');

export const LISTS = {
  werbung: {
    name: 'HaGeZi Multi PRO (Werbung, Tracking, Fingerprinting, Telemetrie)',
    license: 'GPL-3.0',
    home: 'https://github.com/hagezi/dns-blocklists',
    urls: [
      'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/pro-onlydomains.txt',
      'https://raw.githubusercontent.com/hagezi/dns-blocklists/refs/heads/main/wildcard/pro-onlydomains.txt',
      'https://raw.githubusercontent.com/hagezi/dns-blocklists/refs/heads/main/dnsmasq/pro.txt',
      'https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/wildcard/pro-onlydomains.txt'
    ],
    min: 50000
  },
  malware: {
    name: 'URLhaus (abuse.ch) über malware-filter',
    license: 'CC0-1.0',
    home: 'https://gitlab.com/malware-filter/urlhaus-filter',
    urls: ['https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains.txt', 'https://curbengh.github.io/urlhaus-filter/urlhaus-filter-domains.txt'],
    min: 200
  },
  phishing: {
    name: 'Phishing-Filter (OpenPhish, PhishTank, PhishStats) über malware-filter',
    license: 'CC0-1.0',
    home: 'https://gitlab.com/malware-filter/phishing-filter',
    urls: ['https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt', 'https://curbengh.github.io/phishing-filter/phishing-filter-domains.txt'],
    min: 500
  }
};

const SAMPLE = {
  werbung: 'doubleclick.net\ngoogle-analytics.com\ngoogletagmanager.com\nhotjar.com\nclarity.ms\ncriteo.com\n',
  malware: 'malware.testing.google.test\n',
  phishing: 'phishing-test.immoadv-test.invalid\n'
};

async function download(urls) {
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'immoadv-build' } });
      if (r.ok) return await r.text();
      console.warn(`  ${u}: HTTP ${r.status}`);
    } catch (e) { console.warn(`  ${u}: ${e.message}`); }
  }
  return null;
}

fs.mkdirSync(out, { recursive: true });
const sources = {};
for (const [kind, l] of Object.entries(LISTS)) {
  const text = offline ? SAMPLE[kind] : await download(l.urls);
  if (!text) throw new Error(`Liste „${kind}“ konnte nicht geladen werden – Abbruch, damit kein Programm ohne Schutz ausgeliefert wird.`);
  const domains = parseList(text, NEVER);
  if (!offline && domains.length < l.min) throw new Error(`Liste „${kind}“ hat nur ${domains.length} Einträge – vermutlich defekt. Abbruch.`);
  const rules = buildRules(domains, kind, 1);
  fs.writeFileSync(path.join(out, `${kind}.json`), JSON.stringify(rules));
  sources[kind] = { name: l.name, license: l.license, home: l.home, count: domains.length, date: new Date().toISOString() };
  console.log(`${kind}: ${domains.length} Domains → ${rules.length} Regeln`);
}
fs.writeFileSync(path.join(out, 'sources.json'), JSON.stringify(sources, null, 2));

// Version überall gleich: package.json ist die einzige Quelle
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const m of ['extension/manifest.json', 'theme/manifest.json']) {
  const f = path.join(root, m);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.version = version;
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
}
fs.writeFileSync(path.join(root, 'extension', 'version.json'), JSON.stringify({ version }) + '\n');
console.log(`Version ${version} eingetragen.`);
