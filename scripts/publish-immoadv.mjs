// Neue Browser-Version privat auf immoadv.de veröffentlichen (Azure Pipelines auf Ferays eigenen Rechnern).
// Lädt die Dateien aus dist/ hoch – Installer/Pakete zuerst, latest.yml bzw. latest-mac.yml ganz zum Schluss:
// erst dann sehen die installierten Browser die neue Version (nie ein halbfertiges Update).
// Anmeldung ohne Geheimnis: Kurzzeit-Zugang des Azure-Jobs + Build-Nummer, der Server fragt bei Azure nach.
// Aufruf: node scripts/publish-immoadv.mjs windows|mac
import fs from 'node:fs';
import path from 'node:path';

const platform = process.argv[2];
const API = 'https://immoadv.de/api/browser/release';
const token = process.env.SYSTEM_ACCESSTOKEN;
const buildId = process.env.BUILD_BUILDID;
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!['windows', 'mac'].includes(platform)) { console.error('Plattform fehlt (windows|mac)'); process.exit(1); }
if (!token || !buildId) { console.error('Azure-Zugang fehlt (SYSTEM_ACCESSTOKEN / BUILD_BUILDID)'); process.exit(1); }

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
    headers: { Authorization: `Bearer ${token}`, 'X-Azure-Build-Id': buildId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'upload', version, filename })
  });
  if (r.status === 409 && filename !== feed) { console.log(`${filename}: gibt es schon – nichts überschrieben.`); return; }
  if (!r.ok) throw new Error(`${filename}: Upload-Link fehlgeschlagen (${r.status}) ${await r.text()}`);
  const { url } = await r.json();
  const body = fs.readFileSync(path.join(dist, filename));
  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': filename.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream', 'x-upsert': filename === feed ? 'true' : 'false' }, body });
  if (!put.ok) throw new Error(`${filename}: Hochladen fehlgeschlagen (${put.status}) ${(await put.text()).slice(0, 300)}`);
  console.log(`${filename} hochgeladen (${(body.length / 1048576).toFixed(1)} MB)`);
}

for (const f of files) await upload(f);
await upload(feed);
console.log(`ImmoAdv Browser ${version} (${platform}) auf immoadv.de veröffentlicht.`);
