// Schutz vor Datenverlust beim Geräte-Abgleich (Audit B01/B09, 10.11.2026) – reine Logik, ohne Electron und ohne Netz.
// Der Abgleich wertet „fehlt lokal“ als „gelöscht“ und schickt die Löschung an alle Geräte. Das ist nur richtig, wenn der
// lokale Bestand vollständig lesbar ist. Darum:
//  - Passwörter: keine Löschungen, wenn die Verschlüsselung des Systems (Schlüsselbund/DPAPI) nicht verfügbar ist oder auch
//    nur ein gespeichertes Passwort nicht entschlüsselt werden kann (z. B. Schlüsselbund verweigert nach einem Update).
//  - Lesezeichen: eine leere Liste ist nie „alles gelöscht“ (neues/beschädigtes Firefox-Profil, verlorenes Ereignis).
//  - Beide: fehlt auf einen Schlag mehr als die Hälfte (und mehr als 5), wird nichts gelöscht – lieber einmal zu viel
//    behalten als auf allen Geräten verlieren. Lokal Gelöschtes bleibt lokal gelöscht, nur nicht überall.
const MASSE_MIN = 5;
function massig(fehlt, bekannt) { return fehlt > MASSE_MIN && fehlt * 2 > bekannt; }

/**
 * @param {{ pw: { enc: boolean, total: number, readable: number, seen: number, missing: number }, bm: { local: number, seen: number, missing: number } }} s
 * @returns {{ pw: boolean, bm: boolean, why: string[] }}
 */
function deletionsAllowed(s) {
  const why = [];
  let pw = true, bm = true;
  if (!s.pw.enc) { pw = false; why.push('Passwörter: Verschlüsselung des Systems nicht verfügbar – keine Löschungen gesendet'); }
  else if (s.pw.readable < s.pw.total) { pw = false; why.push(`Passwörter: ${s.pw.total - s.pw.readable} nicht lesbar – keine Löschungen gesendet`); }
  else if (massig(s.pw.missing, s.pw.seen)) { pw = false; why.push(`Passwörter: ${s.pw.missing} auf einmal verschwunden – keine Löschungen gesendet`); }
  if (s.bm.local === 0 && s.bm.seen > 0) { bm = false; why.push('Lesezeichen: Liste leer – nicht als „alles gelöscht“ gewertet'); }
  else if (massig(s.bm.missing, s.bm.seen)) { bm = false; why.push(`Lesezeichen: ${s.bm.missing} auf einmal verschwunden – keine Löschungen gesendet`); }
  return { pw, bm, why };
}
module.exports = { deletionsAllowed, MASSE_MIN };
