// Neue Browser-Version privat auf immoadv.de veröffentlichen (Azure Pipelines auf Ferays eigenen Rechnern).
// Lädt die Dateien aus dist/ hoch – Installer/Pakete zuerst, latest.yml bzw. latest-mac.yml ganz zum Schluss:
// erst dann sehen die installierten Browser die neue Version (nie ein halbfertiges Update).
// Anmeldung ohne Geheimnis: Kurzzeit-Zugang des Azure-Jobs + Build-Nummer, der Server fragt bei Azure nach.
// Aufruf: node scripts/publish-immoadv.mjs windows|mac   – Dateien hochladen, Versionsangabe nach feed/ legen
//        node scripts/publish-immoadv.mjs feed          – Freigabe: beide Versionsangaben (Windows + Mac) zusammen
// Gleicher Stand auf beiden Geräten (Wunsch Feray 03.11.2026: „Mac zeigt 4.1.27, lädt aber 4.1.17“): Die Versionsangaben
// gehen erst raus, wenn Windows UND Mac fertig gebaut sind (Stufe „Freigabe“ in azure-pipelines.yml). Vorher sah Windows
// die neue Version, während der Mac-Bau fehlte – die Geräte liefen auseinander.
import fs from 'node:fs';
import path from 'node:path';
import { tusUpload, TUS_AB } from './tus-upload.mjs';

const platform = process.argv[2];
const API = 'https://immoadv.de/api/browser/release';
const token = process.env.SYSTEM_ACCESSTOKEN;
const buildId = process.env.BUILD_BUILDID;
// Eigener Server (Forgejo, 09.11.2026): statt Azure-Zugang ein Bau-Schlüssel aus dem Forgejo-Actions-Geheimnis
// IMMOADV_BUILD_KEY – der Server kennt nur dessen Prüfsumme. Ist er gesetzt, wird er bevorzugt.
const buildKey = process.env.IMMOADV_BUILD_KEY;
const AUTH = buildKey ? { 'x-immoadv-build-key': buildKey } : { Authorization: `Bearer ${token}`, 'X-Azure-Build-Id': buildId };
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!['windows', 'mac', 'feed'].includes(platform)) { console.error('Plattform fehlt (windows|mac|feed)'); process.exit(1); }
if (!buildKey && (!token || !buildId)) { console.error('Zugang fehlt (IMMOADV_BUILD_KEY oder SYSTEM_ACCESSTOKEN / BUILD_BUILDID)'); process.exit(1); }

async function link(filename) {
  const r = await fetch(API, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload', version, filename }) });
  if (!r.ok) throw new Error(`${filename}: Upload-Link fehlgeschlagen (${r.status}) ${await r.text()}`);
  return (await r.json()).url;
}
if (platform === 'feed') {
  // Beide Versionsangaben aus den Artefakten der zwei Bau-Stufen – überall unterhalb des Ordners suchen (03.11.2026: 4.1.28
  // wurde gebaut, aber die Freigabe fand die Dateien nicht und veröffentlichte still nichts).
  const dir = process.argv[3] || 'feeds';
  const found = {};
  const walk = (d, depth = 0) => { if (depth > 6) return; let L = []; try { L = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of L) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, depth + 1); else if (e.name === 'latest.yml' || e.name === 'latest-mac.yml') found[e.name] ||= f; } };
  walk(dir);
  console.log(`Gesucht in ${dir}: ${Object.keys(found).length ? Object.entries(found).map(([k, v]) => `${k} → ${v}`).join(', ') : 'nichts gefunden'}`);
  for (const [f, fp] of Object.entries(found)) {
    const y = fs.readFileSync(fp, 'utf8');
    if (!y.includes(version)) { console.log(`${f}: gehört nicht zu ${version} – übersprungen`); continue; }
    const put = await fetch(await link(f), { method: 'PUT', headers: { 'Content-Type': 'text/yaml', 'x-upsert': 'true' }, body: y });
    if (!put.ok) throw new Error(`${f}: Hochladen fehlgeschlagen (${put.status})`);
    console.log(`${f} freigegeben (${version})`);
  }
  // Fehlt eine Angabe, obwohl gebaut wurde, ist das ein Fehler – nicht still durchlaufen.
  const leer = (() => { let x = false; const w2 = (d, depth = 0) => { if (depth > 6) return; let L = []; try { L = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of L) { if (e.isDirectory()) w2(path.join(d, e.name), depth + 1); else if (e.name === 'LEER.txt') x = true; } }; w2(dir); return x; })();
  if (!leer && (!found['latest.yml'] || !found['latest-mac.yml'])) { console.error('Versionsangabe fehlt – Freigabe nicht vollständig.'); process.exit(1); }
  console.log(`ImmoAdv Browser ${version} freigegeben.`);
  process.exit(0);
}

const dist = 'dist';
const all = fs.readdirSync(dist).filter((f) => fs.statSync(path.join(dist, f)).isFile());
const feed = platform === 'windows' ? 'latest.yml' : 'latest-mac.yml';
const files = platform === 'windows'
  ? all.filter((f) => f.startsWith(`ImmoAdv-Browser-Setup-${version}.exe`))
  : all.filter((f) => f.startsWith(`ImmoAdv-Browser-${version}`) && /\.(dmg|zip)(\.blockmap)?$/.test(f));
if (!all.includes(feed)) { console.error(`${feed} fehlt in dist/`); process.exit(1); }
if (!files.length) { console.error(`Keine Dateien für ${version} in dist/`); process.exit(1); }

async function upload(filename) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'upload', version, filename })
  });
  if (r.status === 409 && filename !== feed) { console.log(`${filename}: gibt es schon – nichts überschrieben.`); return 'skip'; }
  if (!r.ok) throw new Error(`${filename}: Upload-Link fehlgeschlagen (${r.status}) ${await r.text()}`);
  const { url } = await r.json();
  const body = fs.readFileSync(path.join(dist, filename));
  const type = filename.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream';
  if (body.length > TUS_AB) {
    await tusUpload(url, body, { contentType: type, upsert: filename === feed });
  } else {
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type, 'x-upsert': filename === feed ? 'true' : 'false' }, body });
    if (!put.ok) throw new Error(`${filename}: Hochladen fehlgeschlagen (${put.status}) ${(await put.text()).slice(0, 300)}`);
  }
  console.log(`${filename} hochgeladen (${(body.length / 1048576).toFixed(1)} MB)`);
}

// Doppelter Bau derselben Version (02.11.2026, Fehler „Update lädt immer wieder“): Die Dateien des ersten Baus blieben
// liegen, die Versionsangabe (mit Prüfsumme) kam aber vom zweiten Bau – Datei und Prüfsumme passten nicht zusammen, jedes
// Update wurde verworfen und neu geladen. Gibt es die Dateien dieser Version schon, bleibt auch die Versionsangabe des
// ersten Baus stehen – beides stammt dann immer aus demselben Bau.
let skipped = 0;
for (const f of files) if ((await upload(f)) === 'skip') skipped++;
if (skipped) { fs.mkdirSync('feed', { recursive: true }); fs.writeFileSync(path.join('feed', 'LEER.txt'), 'Version schon veröffentlicht – nichts freizugeben.'); console.log(`Version ${version} ist schon veröffentlicht – ${feed} bleibt unverändert (passt zu den vorhandenen Dateien).`); process.exit(0); }
// Versionsangabe nicht sofort veröffentlichen, sondern für die gemeinsame Freigabe bereitlegen.
fs.mkdirSync('feed', { recursive: true });
fs.copyFileSync(path.join(dist, feed), path.join('feed', feed));
console.log(`ImmoAdv Browser ${version} (${platform}) hochgeladen – Freigabe folgt, sobald beide Systeme fertig sind.`);
