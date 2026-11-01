// Baut die ImmoAdv-Erweiterung (immoadv.xpi) für den Firefox-Motor.
// Quelle: extension/ + gemeinsame Bausteine aus src/shared (Listen, Rechner, Inserat-Leser) + Filterlisten aus vendor/lists
// + PDF-Werkzeug (Texterkennung) und Office-Betrachter. Ergebnis: vendor/extension/immoadv.xpi
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'vendor', 'extension');
const stage = path.join(out, 'build');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(path.join(root, 'extension'), stage, { recursive: true });

// Version wie das Programm (4.0.0 → Firefox-Erweiterung 4.0.0)
const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Gemeinsame Bausteine in Browser-Form
const lists = fs.readFileSync(path.join(root, 'src', 'shared', 'lists.js'), 'utf8')
  .replace(/module\.exports\s*=\s*(\{[^}]*\});?\s*$/m, 'self.ImmoLists = $1;');
if (!lists.includes('self.ImmoLists')) throw new Error('lists.js: Export nicht gefunden');
fs.writeFileSync(path.join(stage, 'lib', 'lists.js'), `'use strict';\n${lists}`);
fs.copyFileSync(path.join(root, 'src', 'shared', 'calculator.js'), path.join(stage, 'lib', 'calculator.js'));
const { LISTING_SCRIPT } = require(path.join(root, 'src', 'shared', 'listing.js'));
fs.writeFileSync(path.join(stage, 'lib', 'listing.js'), `// Liest Eckdaten aus einem Inserat (läuft nur lokal, Ergebnis an den Immobilien-Check)\n${LISTING_SCRIPT};\n`);

// Filterlisten (Werbung/Tracker, Malware, Phishing)
const listDir = path.join(root, 'vendor', 'lists');
fs.mkdirSync(path.join(stage, 'lists'), { recursive: true });
for (const f of ['werbung.json', 'malware.json', 'phishing.json', 'sources.json']) {
  const p = path.join(listDir, f);
  if (!fs.existsSync(p)) throw new Error(`Filterliste fehlt: ${f} (erst „npm run rules“)`);
  fs.copyFileSync(p, path.join(stage, 'lists', f));
}

// PDF-Werkzeug (Texterkennung, Geradeziehen) und Office-Betrachter als Seiten der Erweiterung
function copyDir(from, to, transform) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d, transform);
    else if (transform && /\.(mjs|js|html|css)$/.test(e.name)) fs.writeFileSync(d, transform(fs.readFileSync(s, 'utf8'), e.name));
    else fs.copyFileSync(s, d);
  }
  return true;
}
const fixPaths = (txt) => txt
  .replace(/(['"`])\/studio\/vendor\//g, '$1/studio/vendor/')
  .replace(/(['"`])\/build\/pdf\.mjs/g, '$1/pdfjs/build/pdf.mjs')
  .replace(/(['"`])\/build\/pdf\.worker\.mjs/g, '$1/pdfjs/build/pdf.worker.mjs');
copyDir(path.join(root, 'src', 'studio'), path.join(stage, 'studio'), fixPaths);
copyDir(path.join(root, 'vendor', 'studio'), path.join(stage, 'studio', 'vendor'));
copyDir(path.join(root, 'src', 'office'), path.join(stage, 'office'), (t, n) => {
  t = fixPaths(t);
  // Office-Seite: Dateien von Webseiten dürfen geladen werden (Erweiterung), sonst wie bisher abgeschottet
  return n === 'index.html' ? t.replace("connect-src 'self'", "connect-src 'self' https:") : t;
});
for (const d of ['studio', 'office']) fs.copyFileSync(path.join(root, 'src', 'shared', 'fileload.mjs'), path.join(stage, d, 'fileload.mjs'));
const pdfBuild = path.join(root, 'vendor', 'pdfjs', 'build');
if (fs.existsSync(pdfBuild)) {
  fs.mkdirSync(path.join(stage, 'pdfjs', 'build'), { recursive: true });
  for (const f of ['pdf.mjs', 'pdf.worker.mjs']) if (fs.existsSync(path.join(pdfBuild, f))) fs.copyFileSync(path.join(pdfBuild, f), path.join(stage, 'pdfjs', 'build', f));
}

// Packen (ZIP ohne Oberordner)
const JSZip = require('jszip');
const zip = new JSZip();
(function add(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) add(p, r); else zip.file(r, fs.readFileSync(p), { date: new Date('2026-01-01T00:00:00Z') });
  }
})(stage);
const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
fs.writeFileSync(path.join(out, 'immoadv.xpi'), buf);
console.log(`Erweiterung ${pkg.version}: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
