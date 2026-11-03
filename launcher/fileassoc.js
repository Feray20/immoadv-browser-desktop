// „Dateien immer mit ImmoAdv Browser öffnen“ (Wunsch Feray 02.11.2026: aus der ImmoAdv-Software in den Browser umgezogen).
// PDF und Bilder öffnen per Doppelklick im ImmoAdv Browser (PDF-Werkzeuge bzw. Bild-Bearbeitung).
// status(): welche Endungen öffnen noch NICHT mit dem Browser (leer = fertig) – nur lesen.
// makeDefault(): Mac → sofort für alle Typen gesetzt („fertig“); Windows → Standard-Apps-Seite des Browsers geöffnet
// („einstellungen“), weil Windows Programme den Standard nicht selbst umstellen lässt.
const { execFile, spawn } = require('node:child_process');

const BUNDLE_ID = 'de.immoadv.browser.desktop';
// Endung → Dateityp (UTI) am Mac. Gleiche Liste wie die Anmeldung im Installer (Windows) bzw. electron-builder (Mac).
// Nur PDF und Bilder (03.11.2026, Feray: „Office-Dokumente auf ImmoAdv Admin, Bilder und PDFs auf den Browser“) – Word,
// Excel, PowerPoint und CSV öffnet die ImmoAdv-Software. Vorher standen sie hier mit drin: macOS nahm sie nicht an (der
// Browser meldet sie seit 4.1.28 nicht mehr an), deshalb blieb „Als Standard festlegen“ nie auf „Fertig“.
const TYPES = [
  ['pdf', 'com.adobe.pdf'],
  ['png', 'public.png'],
  ['jpg', 'public.jpeg'],
  ['gif', 'com.compuserve.gif'],
  ['webp', 'org.webmproject.webp'],
  ['bmp', 'com.microsoft.bmp']
];
// Windows: ProgId je Endung aus build/installer.nsh
const progId = (ext) => (ext === 'pdf' ? 'ImmoAdvBrowserPDF' : `ImmoAdvBrowser.${ext}`);

const run = (cmd, args, timeout = 15000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? null : String(out || '')));
});

// ---------- Mac: Launch Services über JavaScript for Automation (ohne Zusatzprogramm) ----------
function jxa(set) {
  const list = JSON.stringify(TYPES.map(([e, t]) => [e, t]));
  return `ObjC.import('CoreServices');
var L = ${list}, out = [];
for (var i = 0; i < L.length; i++) {
  var t = $(L[i][1]);
  ${set ? `$.LSSetDefaultRoleHandlerForContentType(t, 0xFFFFFFFF, $('${BUNDLE_ID}'));` : ''}
  var h = $.LSCopyDefaultRoleHandlerForContentType(t, 0xFFFFFFFF);
  var id = h ? ObjC.castRefToObject(h).js : '';
  if (String(id).toLowerCase() !== '${BUNDLE_ID}') out.push(L[i][0]);
}
JSON.stringify(out);`;
}
async function macRun(set) {
  const out = await run('osascript', ['-l', 'JavaScript', '-e', jxa(set)]);
  if (out == null) return null;
  try { const r = JSON.parse(out.trim()); return Array.isArray(r) ? r : null; } catch { return null; }
}

// ---------- Windows: Auswahl des Nutzers lesen (UserChoiceLatest / UserChoice) ----------
async function winChoice(ext) {
  const base = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${ext}`;
  for (const k of ['UserChoiceLatest', 'UserChoice']) {
    const out = await run('reg', ['query', `${base}\\${k}`, '/v', 'ProgId'], 8000);
    const m = out && /ProgId\s+REG_\w+\s+(.+)/i.exec(out);
    if (m) return m[1].trim();
  }
  return '';
}

async function status() {
  if (process.platform === 'darwin') return macRun(false);
  if (process.platform !== 'win32') return null;
  const res = await Promise.all(TYPES.map(async ([e]) => [e, await winChoice(e)]));
  return res.filter(([e, p]) => p.toLowerCase() !== progId(e).toLowerCase()).map(([e]) => e);
}

async function makeDefault() {
  if (process.platform === 'darwin') {
    const missing = await macRun(true);
    if (missing == null) throw new Error('macOS hat die Änderung nicht angenommen.');
    return { result: 'fertig', missing };
  }
  if (process.platform !== 'win32') throw new Error('Auf diesem System nicht verfügbar.');
  // „start“ übergibt die Adresse an Windows selbst (wie Win+R) – öffnet zuverlässig die Einstellungen (ImmoAdv 01.11.2026).
  const url = 'ms-settings:defaultapps?registeredAppUser=' + encodeURIComponent('ImmoAdv Browser');
  const ch = spawn('cmd.exe', ['/C', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
  ch.on('error', () => {});
  ch.unref();
  return { result: 'einstellungen', missing: await status() };
}

module.exports = { status, makeDefault, TYPES };
