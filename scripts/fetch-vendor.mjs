// Lädt beim Bauen die offiziellen Bausteine herunter und prüft sie:
//  • Tor Expert Bundle (tor + Snowflake/obfs4-Brücken) direkt vom Tor-Projekt, SHA-256 geprüft
//  • PDF.js-Viewer (Mozilla) für das PDF-Werkzeug
// Aufruf: node scripts/fetch-vendor.mjs <win|mac> <x64|arm64|universal>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
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

function findGpg() {
  const candidates = ['gpg', 'C:\\Program Files\\Git\\usr\\bin\\gpg.exe', 'C:\\Program Files (x86)\\GnuPG\\bin\\gpg.exe', '/opt/homebrew/bin/gpg', '/usr/local/bin/gpg'];
  for (const c of candidates) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch { /* nächster */ }
  }
  return null;
}

// Web Key Directory: Hash des Namens „torbrowser“ (SHA-1, z-base-32) → Schlüssel direkt von torproject.org
function wkdHash(local) {
  const alphabet = 'ybndrfg8ejkmcpqxot1uwisza345h769';
  const bytes = crypto.createHash('sha1').update(local.toLowerCase()).digest();
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

async function verifySignature(sumsText, sigBuf) {
  const gpg = findGpg();
  if (!gpg) { console.warn('WARNUNG: gpg nicht gefunden – nur SHA-256-Prüfung über HTTPS.'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'torsig-'));
  try {
    const h = wkdHash('torbrowser');
    let key;
    try { key = await get(`https://openpgpkey.torproject.org/.well-known/openpgpkey/torproject.org/hu/${h}?l=torbrowser`); }
    catch { key = await get(`https://torproject.org/.well-known/openpgpkey/hu/${h}?l=torbrowser`); }
    fs.writeFileSync(path.join(dir, 'key.gpg'), key);
    fs.writeFileSync(path.join(dir, 'sums.txt'), sumsText);
    fs.writeFileSync(path.join(dir, 'sums.txt.asc'), sigBuf);
    const home = ['--homedir', dir, '--batch', '--no-tty'];
    execFileSync(gpg, [...home, '--import', path.join(dir, 'key.gpg')], { stdio: 'ignore' });
    let out = '';
    try {
      out = execFileSync(gpg, [...home, '--status-fd', '1', '--verify', path.join(dir, 'sums.txt.asc'), path.join(dir, 'sums.txt')], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch (e) { out = e.stdout ? e.stdout.toString() : ''; }
    if (!/\[GNUPG:\] VALIDSIG /.test(out) || !out.includes(TOR_KEY)) {
      throw new Error('Signatur des Tor-Pakets ungültig – Abbruch.');
    }
    console.log('Tor-Signatur geprüft.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function pdfjs() {
  const dest = path.join(vendor, 'pdfjs');
  if (fs.existsSync(path.join(dest, 'web', 'viewer.html'))) return;
  // neueste Version über die Weiterleitung von GitHub (ohne API-Limit)
  const res = await fetch('https://github.com/mozilla/pdf.js/releases/latest', { redirect: 'follow', headers: { 'User-Agent': 'immoadv-build' } });
  await res.arrayBuffer().catch(() => {});
  const tag = (res.url || '').split('/').pop();
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('PDF.js-Version nicht gefunden');
  const ver = tag.slice(1);
  console.log(`PDF.js ${ver}`);
  const zip = path.join(vendor, `pdfjs-${ver}-dist.zip`);
  fs.writeFileSync(zip, await get(`https://github.com/mozilla/pdf.js/releases/download/${tag}/pdfjs-${ver}-dist.zip`));
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  // Windows 10/11 und macOS bringen „tar“ mit, das auch ZIP entpackt
  execFileSync('tar', ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  fs.rmSync(zip);
  if (!fs.existsSync(path.join(dest, 'web', 'viewer.html'))) throw new Error('PDF.js unvollständig entpackt');
}

fs.mkdirSync(vendor, { recursive: true });
try {
  console.log('Lade PDF.js …');
  await pdfjs();

} catch (e) { out = e.stdout ? e.stdout.toString() : ''; }
    if (!/\[GNUPG:\] VALIDSIG /.test(out) || !out.includes(TOR_KEY)) {
      throw new Error('Signatur des Tor-Pakets ungültig – Abbruch.');
    }
    console.log('Tor-Signatur geprüft.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function pdfjs() {
  const dest = path.join(vendor, 'pdfjs');
  if (fs.existsSync(path.join(dest, 'web', 'viewer.html'))) return;
  // neueste Version über die Weiterleitung von GitHub (ohne API-Limit)
  const res = await fetch('https://github.com/mozilla/pdf.js/releases/latest', { redirect: 'follow', headers: { 'User-Agent': 'immoadv-build' } });
  await res.arrayBuffer().catch(() => {});
  const tag = (res.url || '').split('/').pop();
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('PDF.js-Version nicht gefunden');
  const ver = tag.slice(1);
  console.log(`PDF.js ${ver}`);
  const zip = path.join(vendor, `pdfjs-${ver}-dist.zip`);
  fs.writeFileSync(zip, await get(`https://github.com/mozilla/pdf.js/releases/download/${tag}/pdfjs-${ver}-dist.zip`));
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  // Windows 10/11 und macOS bringen „tar“ mit, das auch ZIP entpackt
  execFileSync('tar', ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  fs.rmSync(zip);
  if (!fs.existsSync(path.join(dest, 'web', 'viewer.html'))) throw new Error('PDF.js unvollständig entpackt');
}

fs.mkdirSync(vendor, { recursive: true });
try {
  console.log('Lade PDF.js …');
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
} catch (e) {
  console.error('FEHLER:', e && e.stack || e);
  process.exit(1);
}
