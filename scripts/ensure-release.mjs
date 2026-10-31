// Legt das GitHub-Release für die aktuelle Version an (falls es noch fehlt),
// damit electron-builder die Installer anschließend hochladen kann.
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

const existing = await api(`/releases/tags/${tag}`);
if (existing.ok) { console.log(`Release ${tag} existiert bereits.`); process.exit(0); }

const res = await api('/releases', {
  method: 'POST',
  body: JSON.stringify({ tag_name: tag, target_commitish: process.env.CIRCLE_SHA1 || 'main', name: `ImmoAdv Browser ${version}`, body: notes, draft: false, prerelease: false })
});
if (!res.ok) { console.error(`Release konnte nicht angelegt werden: ${res.status} ${await res.text()}`); process.exit(1); }
console.log(`Release ${tag} angelegt.`);
