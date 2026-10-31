// Veröffentlicht das Release erst, wenn Windows- UND Mac-Update-Dateien hochgeladen sind.
// Läuft nach jedem Build; der zweite fertige Build schaltet es frei.
import fs from 'node:fs';

const token = process.env.GH_TOKEN;
const repo = `${process.env.CIRCLE_PROJECT_USERNAME || 'Feray20'}/${process.env.CIRCLE_PROJECT_REPONAME || 'immoadv-browser-desktop'}`;
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tag = `v${version}`;
const api = (path, init = {}) => fetch(`https://api.github.com/repos/${repo}${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'immoadv-build', ...(init.headers || {}) }
});

const list = await (await api('/releases?per_page=30')).json();
const rel = Array.isArray(list) ? list.find((r) => r.tag_name === tag) : null;
if (!rel) { console.error(`Release ${tag} nicht gefunden`); process.exit(1); }
const names = rel.assets.map((a) => a.name);
const need = ['latest.yml', 'latest-mac.yml', `ImmoAdv-Browser-Setup-${version}.exe`, `ImmoAdv-Browser-${version}.dmg`];
const missing = need.filter((n) => !names.includes(n));
if (missing.length) { console.log(`Noch nicht veröffentlicht – es fehlt: ${missing.join(', ')} (der andere Build folgt).`); process.exit(0); }
if (!rel.draft) { console.log(`Release ${tag} ist bereits veröffentlicht.`); process.exit(0); }
const res = await api(`/releases/${rel.id}`, { method: 'PATCH', body: JSON.stringify({ draft: false, make_latest: 'true' }) });
if (!res.ok) { console.error(`Veröffentlichen fehlgeschlagen: ${res.status} ${await res.text()}`); process.exit(1); }
console.log(`Release ${tag} veröffentlicht – Updates sind jetzt für alle Programme sichtbar.`);
