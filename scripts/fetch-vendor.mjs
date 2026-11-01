// Lädt beim Bauen den PDF.js-Viewer (Mozilla) für das PDF-Werkzeug.
// Aufruf: node scripts/fetch-vendor.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor');

async function get(url, as = 'buffer') {
  const res = await fetch(url, { headers: { 'User-Agent': 'immoadv-build' } });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
  return as === 'json' ? res.json() : as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
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
  // unter Windows ausdrücklich das Windows-tar (bsdtar), nicht das GNU-tar aus Git Bash
  const tarExe = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tarExe, ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  fs.rmSync(zip);
  if (!fs.existsSync(path.join(dest, 'web', 'viewer.html'))) throw new Error('PDF.js unvollständig entpackt');
}

fs.mkdirSync(vendor, { recursive: true });
try {
  await pdfjs();
  console.log('Fertig: vendor/ ist bereit.');
} catch (e) {
  console.error('FEHLER:', (e && e.stack) || e);
  process.exit(1);
}
