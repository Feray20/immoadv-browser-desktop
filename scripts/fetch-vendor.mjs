// Lädt beim Bauen die offiziellen Bausteine herunter und prüft sie:
//  • Tor Expert Bundle (tor + Snowflake/obfs4-Brücken) direkt vom Tor-Projekt, SHA-256 geprüft
//  • PDF.js-Viewer (Mozilla) für das PDF-Werkzeug
// Aufruf: node scripts/fetch-vendor.mjs <win|mac> <x64|arm64|universal>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import extractZip from 'extract-zip';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor');
const [platform = process.platform === 'win32' ? 'win' : 'mac', arch = 'x64'] = process.argv.slice(2);

async function get(url, as = 'buffer') {
  const res = await fetch(url, { headers: { 'User-Agent': 'immoadv-build' } });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
  return as === 'json' ? res.json() : as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
}

async function torBundle(osName, a, dest) {
  // aktuelle stabile Tor-Browser-Version → passendes Expert Bundle
  const info = await get('https://aus1.torproject.org/torbrowser/update_3/release/downloads.json', 'json');
  const v = info.version;
  const name = `tor-expert-bundle-${osName}-${a}-${v}.tar.gz`;
  const base = `https://dist.torproject.org/torbrowser/${v}/`;
  console.log(`Tor ${v}: ${name}`);
  const [file, sums, sig] = await Promise.all([
    get(base + name), get(base + 'sha256sums-signed-build.txt', 'text'), get(base + 'sha256sums-signed-build.txt.asc')
  ]);
  await verifySignature(sums, sig);
  const hash = crypto.createHash('sha256').update(file).digest('hex');
  const line = sums.split('\n').find(l => l.trim().endsWith(name));
  if (!line || !line.startsWith(hash)) throw new Error(`Prüfsumme stimmt nicht für ${name} – Abbruch.`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const tmp = path.join(vendor, name);
  fs.writeFileSync(tmp, file);
  await tar.x({ file: tmp, cwd: dest });
  fs.rmSync(tmp);
  fs.writeFileSync(path.join(dest, 'VERSION'), v);
}

// Echtheit: Prüfsummen-Datei muss vom Signaturschlüssel der Tor-Browser-Entwickler signiert sein
const TOR_KEY = 'EF6E286DDA85EA2A4BA7DE684E2C6E8793298290';
async function verifySignature(sumsText, sigBuf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'torsig-'));
  try {
    fs.writeFileSync(path.join(dir, 'sums.txt'), sumsText);
    fs.writeFileSync(path.join(dir, 'sums.txt.asc'), sigBuf);
    const home = ['--homedir', dir, '--batch', '--no-tty'];
    // Schlüssel direkt vom Tor-Projekt (Web Key Directory), wie in der offiziellen Anleitung
    execFileSync('gpg', [...home, '--auto-key-locate', 'nodefault,wkd', '--locate-keys', 'torbrowser@torproject.org'], { stdio: 'ignore' });
    const out = execFileSync('gpg', [...home, '--status-fd', '1', '--verify', path.join(dir, 'sums.txt.asc'), path.join(dir, 'sums.txt')]).toString();
    if (!out.includes(`VALIDSIG ${TOR_KEY}`) && !new RegExp(`VALIDSIG \\S+ .*${TOR_KEY}`).test(out)) {
      throw new Error('Signatur des Tor-Pakets ungültig – Abbruch.');
    }
    console.log('Tor-Signatur geprüft.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function pdfjs() {
  const dest = path.join(vendor, 'pdfjs');
  if (fs.existsSync(path.join(dest, 'web', 'viewer.html'))) return;
  // neueste Version über die Weiterleitung von GitHub (ohne API-Limit)
  const res = await fetch('https://github.com/mozilla/pdf.js/releases/latest', { redirect: 'manual' });
  const tag = (res.headers.get('location') || '').split('/').pop();
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('PDF.js-Version nicht gefunden');
  const ver = tag.slice(1);
  console.log(`PDF.js ${ver}`);
  const zip = path.join(vendor, `pdfjs-${ver}-dist.zip`);
  fs.writeFileSync(zip, await get(`https://github.com/mozilla/pdf.js/releases/download/${tag}/pdfjs-${ver}-dist.zip`));
  fs.rmSync(dest, { recursive: true, force: true });
  await extractZip(zip, { dir: dest });
  fs.rmSync(zip);
}

fs.mkdirSync(vendor, { recursive: true });
await pdfjs();
if (platform === 'win') {
  await torBundle('windows', 'x86_64', path.join(vendor, 'tor', 'win-x64'));
} else {
  const arches = arch === 'universal' ? ['arm64', 'x64'] : [arch];
  for (const a of arches) {
    await torBundle('macos', a === 'arm64' ? 'aarch64' : 'x86_64', path.join(vendor, 'tor', `mac-${a}`));
  }
}
console.log('Fertig: vendor/ ist bereit.');
