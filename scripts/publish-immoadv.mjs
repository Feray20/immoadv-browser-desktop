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

const platform = process.argv[2];
const API = 'https://immoadv.de/api/browser/release';
const token = process.env.SYSTEM_ACCESSTOKEN;
const buildId = process.env.BUILD_BUILDID;
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!['windows', 'mac', 'feed'].includes(platform)) { console.error('Plattform fehlt (windows|mac|feed)'); process.exit(1); }
if (!token || !buildId) { console.error('Azure-Zugang fehlt (SYSTEM_ACCESSTOKEN / BUILD_BUILDID)'); process.exit(1); }

async function link(filename) {
  const r = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Azure-Build-Id': buildId, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload', version, filename }) });
  if (!r.ok) throw new Error(`${filename}: Upload-Link fehlgeschlagen (${r.status}) ${await r.text()}`);
  return (await r.json()).url;
}
if (platform === 'feed') {
  // Beide Versionsangaben aus den Artefakten der zwei Bau-Stufen; fehlt eine (Version schon veröffentlicht), bleibt sie.
  const dir = process.argv[3] || 'feeds';
  const L = [['windows', 'latest.yml'], ['mac', 'latest-mac.yml']].map(([p0, f]) => [path.join(dir, `feed-${p0}`, f), f]).filter(([fp]) => fs.existsSync(fp));
  for (const [fp, f] of L) {
    const put = await fetch(await link(f), { method: 'PUT', headers: { 'Content-Type': 'text/yaml', 'x-upsert': 'true' }, body: fs.readFileSync(fp) });
    if (!put.ok) throw new Error(`${f}: Hochladen fehlgeschlagen (${put.status})`);
    console.log(`${f} freigegeben (${version})`);
  }
  console.log(L.length ? `ImmoAdv Browser ${version} für ${L.length === 2 ? 'Windows und Mac' : 'eine Plattform'} freigegeben.` : 'Nichts freizugeben.');
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
    headers: { Authorization: `Bearer ${token}`, 'X-Azure-Build-Id': buildId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'upload', version, filename })
  });
  if (r.status === 409 && filename !== feed) { console.log(`${filename}: gibt es schon – nichts überschrieben.`); return 'skip'; }
  if (!r.ok) throw new Error(`${filename}: Upload-Link fehlgeschlagen (${r.status}) ${await r.text()}`);
  const { url } = await r.json();
  const body = fs.readFileSync(path.join(dist, filename));
  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': filename.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream', 'x-upsert': filename === feed ? 'true' : 'false' }, body });
  if (!put.ok) throw new Error(`${filename}: Hochladen fehlgeschlagen (${put.status}) ${(await put.text()).slice(0, 300)}`);
  console.log(`${filename} hochgeladen (${(body.length / 1048576).toFixed(1)} MB)`);
}

// Doppelter Bau derselben Version (02.11.2026, Fehler „Update lädt immer wieder“): Die Dateien des ersten Baus blieben
// liegen, die Versionsangabe (mit Prüfsumme) kam aber vom zweiten Bau – Datei und Prüfsumme passten nicht zusammen, jedes
// Update wurde verworfen und neu geladen. Gibt es die Dateien dieser Version schon, bleibt auch die Versionsangabe des
// ersten Baus stehen – beides stammt dann immer aus demselben Bau.
let skipped = 0;
for (const f of files) if ((await upload(f)) === 'skip') skipped++;
if (skipped) { fs.mkdirSync('feed', { recursive: true }); console.log(`Version ${version} ist schon veröffentlicht – ${feed} bleibt unverändert (passt zu den vorhandenen Dateien).`); process.exit(0); }
// Versionsangabe nicht sofort veröffentlichen, sondern für die gemeinsame Freigabe bereitlegen.
fs.mkdirSync('feed', { recursive: true });
fs.copyFileSync(path.join(dist, feed), path.join('feed', feed));
console.log(`ImmoAdv Browser ${version} (${platform}) hochgeladen – Freigabe folgt, sobald beide Systeme fertig sind.`);
