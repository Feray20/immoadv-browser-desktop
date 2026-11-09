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

// Neueste PDF.js-Version ermitteln – drei Wege nacheinander (09.11.2026: Build 4.1.50 brach auf PC und Mac mit
// „PDF.js-Version nicht gefunden“ ab, weil die Weiterleitung von GitHub keinen Versionsnamen mehr lieferte).
// 1. Weiterleitung /releases/latest (ohne API-Limit), 2. GitHub-API, 3. Atom-Feed der Releases.
// Jeder Fehlversuch wird mit Grund protokolliert, damit ein Abbruch im Build-Protokoll erklärbar ist.
const TAG_RE = /^v\d+\.\d+\.\d+$/;
export async function pdfjsTag(f = fetch) {
  const h = { 'User-Agent': 'immoadv-build' };
  const wege = [
    ['Weiterleitung', async () => { const r = await f('https://github.com/mozilla/pdf.js/releases/latest', { redirect: 'follow', headers: h }); await r.arrayBuffer().catch(() => {}); return { status: r.status, tag: String(r.url || '').split('/').pop() }; }],
    ['API', async () => { const r = await f('https://api.github.com/repos/mozilla/pdf.js/releases/latest', { headers: { ...h, Accept: 'application/vnd.github+json' } }); const j = r.ok ? await r.json() : {}; return { status: r.status, tag: String(j.tag_name || '') }; }],
    ['Feed', async () => { const r = await f('https://github.com/mozilla/pdf.js/releases.atom', { headers: h }); const t = r.ok ? await r.text() : ''; return { status: r.status, tag: (/\/releases\/tag\/(v\d+\.\d+\.\d+)/.exec(t) || [])[1] || '' }; }],
  ];
  const gruende = [];
  for (const [name, weg] of wege) {
    try { const { status, tag } = await weg(); if (TAG_RE.test(tag)) return tag; gruende.push(`${name}: HTTP ${status}, „${tag.slice(0, 40)}“`); }
    catch (e) { gruende.push(`${name}: ${e.message}`); }
  }
  throw new Error(`PDF.js-Version nicht gefunden (${gruende.join(' · ')})`);
}

async function pdfjs() {
  const dest = path.join(vendor, 'pdfjs');
  if (fs.existsSync(path.join(dest, 'web', 'viewer.html'))) return;
  const tag = await pdfjsTag();
  const ver = tag.slice(1);
  console.log(`PDF.js ${ver}`);
  const zip = path.join(vendor, `pdfjs-${ver}-dist.zip`);
  fs.writeFileSync(zip, await get(`https://github.com/mozilla/pdf.js/releases/download/${tag}/pdfjs-${ver}-dist.zip`));
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  // Windows 10/11 und macOS bringen „tar“ mit, das auch ZIP entpackt
  // unter Windows ausdrücklich das Windows-tar (bsdtar), nicht das GNU-tar aus Git Bash
  const tarExe = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  // Linux (Prüf-Vorschau): GNU-tar kann kein ZIP → unzip
  if (process.platform === 'linux') execFileSync('unzip', ['-q', zip, '-d', dest], { stdio: 'inherit' });
  else execFileSync(tarExe, ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  fs.rmSync(zip);
  if (!fs.existsSync(path.join(dest, 'web', 'viewer.html'))) throw new Error('PDF.js unvollständig entpackt');
}

// PDF-Studio: Texterkennung (Tesseract, Apache-2.0) + PDF-Bearbeitung (pdf-lib, MIT) – alles offline im Programm
async function studio() {
  const dest = path.join(vendor, 'studio');
  fs.mkdirSync(dest, { recursive: true });
  const nm = path.join(root, 'node_modules');
  const copy = (from, to) => { if (!fs.existsSync(from)) throw new Error('fehlt: ' + from); fs.copyFileSync(from, path.join(dest, to || path.basename(from))); };
  copy(path.join(nm, 'tesseract.js', 'dist', 'tesseract.min.js'));
  copy(path.join(nm, 'tesseract.js', 'dist', 'worker.min.js'));
  const core = path.join(nm, 'tesseract.js-core');
  const cores = fs.readdirSync(core).filter((f) => /^tesseract-core.*\.wasm\.js$/.test(f));
  if (!cores.length) throw new Error('tesseract.js-core ohne Kern-Dateien');
  for (const f of cores) copy(path.join(core, f));
  copy(path.join(nm, 'pdf-lib', 'dist', 'pdf-lib.min.js'));
  for (const lang of ['deu', 'eng']) {
    const f = path.join(dest, `${lang}.traineddata`);
    if (fs.existsSync(f) && fs.statSync(f).size > 500000) continue;
    const buf = await get(`https://github.com/tesseract-ocr/tessdata_fast/raw/main/${lang}.traineddata`);
    if (buf.length < 500000) throw new Error(`Sprachdaten ${lang} zu klein`);
    fs.writeFileSync(f, buf);
  }
  console.log('PDF-Studio-Bausteine bereit:', fs.readdirSync(dest).join(', '));
}

// Nur beim direkten Aufruf laden (der Test importiert nur pdfjsTag).
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && same(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
fs.mkdirSync(vendor, { recursive: true });
try {
  await pdfjs();
  await studio();
  console.log('Fertig: vendor/ ist bereit.');
} catch (e) {
  console.error('FEHLER:', (e && e.stack) || e);
  process.exit(1);
}
}
