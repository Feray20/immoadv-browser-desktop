// Legt das GitHub-Release für die aktuelle Version als ENTWURF an (unsichtbar für die Programme),
// damit electron-builder die Installer hochladen kann. Erst finalize-release.mjs veröffentlicht es,
// wenn alle Update-Dateien da sind – so sieht nie ein Programm ein halbfertiges Update.
import fs from 'node:fs';

const token = process.env.GH_TOKEN;
const repo = `${process.env.CIRCLE_PROJECT_USERNAME || 'Feray20'}/${process.env.CIRCLE_PROJECT_REPONAME || 'immoadv-browser-desktop'}`;
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tag = `v${version}`;
const notes = fs.existsSync('NEUERUNGEN.md') ? fs.readFileSync('NEUERUNGEN.md', 'utf8') : '';
if (!token) { console.error('GH_TOKEN fehlt'); process.exit(1); }

const api = (path, init = {}) => fetch(`https://api.github.com/repos/${repo}${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'immoadv-build', ...(init.headers || {}) }
});

// Entwürfe tauchen unter /releases/tags nicht auf – deshalb die Liste durchsuchen
const list = await (await api('/releases?per_page=30')).json();
const rel = Array.isArray(list) ? list.find((r) => r.tag_name === tag) : null;

if (rel) {
  const names = rel.assets.map((a) => a.name);
  const complete = names.includes('latest.yml') && names.includes('latest-mac.yml');
  if (!rel.draft && !complete) {
    // veröffentlicht, aber unvollständig → zurück auf Entwurf, damit die Programme keinen Fehler sehen
    await api(`/releases/${rel.id}`, { method: 'PATCH', body: JSON.stringify({ draft: true }) });
    console.log(`Release ${tag} war unvollständig – wieder auf Entwurf gesetzt.`);
  } else console.log(`Release ${tag} existiert bereits (Entwurf: ${rel.draft}).`);
  process.exit(0);
}

const res = await api('/releases', {
  method: 'POST',
  body: JSON.stringify({ tag_name: tag, target_commitish: process.env.CIRCLE_SHA1 || 'main', name: `ImmoAdv Browser ${version}`, body: notes, draft: true, prerelease: false })
});
if (!res.ok) { console.error(`Release konnte nicht angelegt werden: ${res.status} ${await res.text()}`); process.exit(1); }
console.log(`Release ${tag} als Entwurf angelegt.`);
