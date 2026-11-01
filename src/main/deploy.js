// Stellt die ImmoAdv-Schicht (Erweiterung + Design) für Chrome bereit und hält sie aktuell.
// Chrome lädt sie aus diesem Ordner; neue Versionen übernimmt die Erweiterung von selbst (ohne Neustart).
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { paths } = require('./chrome');

const source = (name) => (app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, '..', '..', name));
const readVersion = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).version; } catch { return null; } };

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  // version.json zuletzt – erst dann erkennt die Erweiterung die neue Version
  fs.cpSync(from, to, { recursive: true, force: true, filter: (src) => path.basename(src) !== 'version.json' && path.basename(src) !== 'package.json' });
  const v = path.join(from, 'version.json');
  if (fs.existsSync(v)) fs.copyFileSync(v, path.join(to, 'version.json'));
}

/** Kopiert neue Versionen in die Chrome-Ordner. Gibt zurück, ob etwas aktualisiert wurde. */
function deploy() {
  let changed = false;
  const ext = source('extension');
  const target = paths.extension();
  if (readVersion(ext) !== readVersion(target) || !fs.existsSync(path.join(target, 'manifest.json'))) {
    copyDir(ext, target); changed = true;
  }
  const theme = source('theme');
  if (fs.existsSync(theme)) {
    const m = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')).version; } catch { return null; } };
    if (m(theme) !== m(paths.theme())) { fs.mkdirSync(paths.theme(), { recursive: true }); fs.cpSync(theme, paths.theme(), { recursive: true, force: true }); changed = true; }
  }
  return changed;
}

/** Status für das Datenschutz-Center (die Erweiterung liest diese Datei) */
function writeLauncherInfo(info) {
  try {
    fs.mkdirSync(paths.extension(), { recursive: true });
    const f = path.join(paths.extension(), 'launcher.json');
    fs.writeFileSync(f + '.tmp', JSON.stringify({ ...info, appVersion: app.getVersion(), platform: process.platform, at: new Date().toISOString() }));
    fs.renameSync(f + '.tmp', f);
  } catch { /* nicht kritisch */ }
}

/**
 * Übernahme aus dem alten ImmoAdv Browser (Version 1.x mit Tor):
 * • Lesezeichen → werden in Chrome als Ordner „Aus altem ImmoAdv Browser“ angelegt
 * • alte Einstellungsdatei wird vorher gesichert, nichts wird gelöscht
 * • Tor-Daten, Cookies und Sitzungen werden bewusst NICHT übernommen
 */
function migrateV1(store) {
  if (store.get('migratedFromV1')) return;
  const ud = app.getPath('userData');
  const old = path.join(ud, 'einstellungen.json');
  if (fs.existsSync(old)) {
    try {
      const backup = path.join(ud, 'Sicherung-alter-Browser');
      fs.mkdirSync(backup, { recursive: true });
      fs.copyFileSync(old, path.join(backup, 'einstellungen.json'));
      const data = JSON.parse(fs.readFileSync(old, 'utf8'));
      const bookmarks = (Array.isArray(data.bookmarks) ? data.bookmarks : []).filter((b) => b && /^https?:\/\//.test(b.url));
      if (bookmarks.length) {
        fs.mkdirSync(paths.extension(), { recursive: true });
        fs.writeFileSync(path.join(paths.extension(), 'import.json'), JSON.stringify({ id: 'v1-lesezeichen', title: 'Aus altem ImmoAdv Browser', bookmarks }));
      }
    } catch { /* alte Datei unlesbar → nichts übernehmen */ }
  }
  // Der alte Browser startete sich mit Windows/Mac im Hintergrund (für Tor) – das braucht es nicht mehr
  try { app.setLoginItemSettings({ openAtLogin: false, openAsHidden: false, args: [] }); } catch {}
  try { app.setLoginItemSettings({ openAtLogin: false, args: ['--hidden'] }); } catch {}
  store.set('migratedFromV1', true);
}

module.exports = { deploy, writeLauncherInfo, migrateV1, source };
