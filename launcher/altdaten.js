// Alte Update-Dateien nach dem Update entfernen (Feray 03.11.2026: „wenn die Updates installiert sind, alle alten
// Browser-Daten löschen, nur die aktuellste mit Anmeldedaten“). Ohne Electron, damit es testbar ist.
// Betrifft nur Dateien des ImmoAdv Browsers mit einer Versionsnummer im Namen, die ÄLTER als die laufende Version ist:
//   • eigener Update-Zwischenspeicher (Mac: <Profil-Ordner>/update, Windows: %LOCALAPPDATA%\immoadv-browser-updater\pending)
//     → endgültig löschen (nur heruntergeladene Installer, keine Nutzerdaten)
//   • alte Installer/Archive in „Downloads“ → in den Papierkorb (wiederherstellbar)
//   • liegengebliebener halbfertiger Motor („Motor.neu“) → löschen
// Ein bereits geladenes NEUERES Update bleibt liegen. Profil, Passwörter, Lesezeichen, Anmeldungen und Downloads
// anderer Art werden nie angefasst.
const fs = require('node:fs');
const path = require('node:path');

const DATEI = /^ImmoAdv-Browser-(?:Setup-)?(\d{1,3}\.\d{1,3}\.\d{1,4})(?:-arm64(?:-mac)?|-x64|-universal(?:-mac)?)?\.(?:exe|dmg|zip)(?:\.blockmap|\.part)?$/i;

function teile(v) { return String(v).split('.').map((x) => parseInt(x, 10) || 0); }
/** a < b ? */
function aelter(a, b) {
  const x = teile(a), y = teile(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
}

/** Versionsnummer einer Browser-Update-Datei oder null */
function versionVon(name) { const m = DATEI.exec(String(name)); return m ? m[1] : null; }

/** Gehört die Datei zu einer älteren Version als `aktuell`? (gleiche/neuere Version → nein) */
function veraltet(name, aktuell) { const v = versionVon(name); return Boolean(v && aelter(v, aktuell)); }

/**
 * @param {{ aktuell: string, ordner: Array<{ pfad: string, art: 'loeschen'|'papierkorb' }>, motorNeu?: string,
 *           papierkorb: (p: string) => Promise<void>, log: (m: string) => void }} o
 * @returns {Promise<string[]>} entfernte Pfade
 */
async function aufraeumen(o) {
  const weg = [];
  for (const { pfad, art } of o.ordner) {
    let namen = [];
    try { namen = fs.readdirSync(pfad); } catch { continue; }
    for (const n of namen) {
      if (!veraltet(n, o.aktuell)) continue;
      const voll = path.join(pfad, n);
      try {
        if (!fs.statSync(voll).isFile()) continue;
        if (art === 'papierkorb') await o.papierkorb(voll); else fs.rmSync(voll, { force: true });
        weg.push(voll);
        o.log(`Aufräumen: alte Update-Datei ${art === 'papierkorb' ? 'in den Papierkorb' : 'gelöscht'} – ${voll}`);
      } catch (e) { o.log(`Aufräumen: ${voll} – ${e.message}`); }
    }
    // Windows: Merkzettel des Updaters zeigt auf eine gelöschte Datei → mit entfernen, sonst sucht er sie
    const info = path.join(pfad, 'update-info.json');
    try {
      const f = JSON.parse(fs.readFileSync(info, 'utf8')).fileName;
      if (f && !fs.existsSync(path.join(pfad, String(f)))) { fs.rmSync(info, { force: true }); weg.push(info); }
    } catch { /* keiner da */ }
  }
  if (o.motorNeu) {
    // nur wenn seit über einer Stunde liegengeblieben – sonst läuft vielleicht gerade eine Motor-Installation
    try { if (fs.existsSync(o.motorNeu) && Date.now() - fs.statSync(o.motorNeu).mtimeMs > 3600_000) { fs.rmSync(o.motorNeu, { recursive: true, force: true }); weg.push(o.motorNeu); o.log('Aufräumen: halbfertigen Motor entfernt'); } } catch (e) { o.log('Aufräumen (Motor.neu): ' + e.message); }
  }
  return weg;
}

module.exports = { aufraeumen, veraltet, versionVon, aelter };
