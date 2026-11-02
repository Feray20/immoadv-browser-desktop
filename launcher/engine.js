// Firefox-Motor (ESR) des ImmoAdv Browsers: offiziell von Mozilla laden, Signatur prüfen, in den eigenen Programmordner legen
// (kein normales Firefox auf dem Computer, keine Admin-Rechte), ImmoAdv-Profil, Oberfläche und Erweiterung einrichten, starten.
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const store = require('./store');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const EXT_ID = 'browser@immoadv.de';
const EXT_UUID = '6f1a5c1e-3d2b-4e8a-9b7c-1d2e3f4a5b6c';     // feste Adresse moz-extension://… der ImmoAdv-Seiten
const MOZILLA_TEAM_ID = '43AQ936H96';                            // Apple-Entwickler-ID der Mozilla Corporation
const DOWNLOAD = {
  win32: 'https://download.mozilla.org/?product=firefox-esr-latest-ssl&os=win64&lang=de',
  darwin: 'https://download.mozilla.org/?product=firefox-esr-latest-ssl&os=osx&lang=de',
  linux: 'https://download.mozilla.org/?product=firefox-esr-latest-ssl&os=linux64&lang=de'
};
const DNS = {
  quad9: 'https://dns.quad9.net/dns-query', mullvad: 'https://dns.mullvad.net/dns-query', cloudflare: 'https://mozilla.cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query', system: ''
};
const SEARCH = { google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing', ecosia: 'Ecosia', startpage: 'Startpage' };

const base = () => app.getPath('userData');
const paths = {
  engine: () => path.join(base(), 'Motor'),
  profile: () => path.join(base(), 'Profil'),
  resources: () => (app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'vendor')),
  bundledXpi: () => path.join(paths.resources(), 'extension', 'immoadv.xpi'),
  engineFiles: () => (app.isPackaged ? path.join(process.resourcesPath, 'engine') : path.join(__dirname, '..', 'engine'))
};

function log(msg) {
  try {
    const f = path.join(base(), 'motor.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 300 * 1024) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* egal */ }
}

/** Ordner, in dem die Motor-Dateien liegen (Windows/Linux: Programmordner, Mac: Firefox.app/Contents/Resources) */
function appDir() {
  if (isMac) return path.join(paths.engine(), 'Firefox.app', 'Contents', 'Resources');
  if (isWin) return paths.engine();
  return path.join(paths.engine(), 'firefox');
}
function exe() {
  if (isMac) return path.join(paths.engine(), 'Firefox.app', 'Contents', 'MacOS', 'firefox');
  if (isWin) return path.join(paths.engine(), 'firefox.exe');
  return path.join(paths.engine(), 'firefox', 'firefox');
}
const installed = () => { try { return fs.statSync(exe()).isFile(); } catch { return false; } };

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...opts },
    (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve(String(stdout)))));
}

async function download(url, target, onProgress) {
  const { net } = require('electron');
  const res = await net.fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(target);
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    if (total && onProgress) onProgress(Math.round(got / total * 100));
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  if (got < 20 * 1024 * 1024) throw new Error('Download unvollständig');
}

/** Firefox ESR offiziell von Mozilla in den eigenen Ordner installieren (Windows ohne Admin, ohne Registrierung als System-Firefox) */
async function install(onProgress = () => {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'immoadv-motor-'));
  const target = paths.engine() + '.neu';
  fs.rmSync(target, { recursive: true, force: true });
  try {
    if (isWin) {
      const file = path.join(tmp, 'firefox-esr-setup.exe');
      onProgress({ step: 'download', p: 0 });
      await download(DOWNLOAD.win32, file, (p) => onProgress({ step: 'download', p }));
      onProgress({ step: 'verify' });
      const sig = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`]);
      const [status, subject] = sig.trim().split('|');
      if (status !== 'Valid' || !/O="?Mozilla Corporation/.test(subject || '')) throw new Error('Signatur des Firefox-Installers ungültig – abgebrochen.');
      onProgress({ step: 'install' });
      // Das Mozilla-Installationsprogramm ist ein 7-Zip-Archiv; „core“ enthält den fertigen Browser
      const { path7za } = require('7zip-bin');
      const seven = path7za.replace('app.asar', 'app.asar.unpacked');
      await run(seven, ['x', '-y', `-o${path.join(tmp, 'x')}`, file], { timeout: 10 * 60 * 1000 });
      const core = path.join(tmp, 'x', 'core');
      if (!fs.existsSync(path.join(core, 'firefox.exe'))) throw new Error('Firefox-Paket unvollständig');
      fs.renameSync(core, target);
    } else if (isMac) {
      const dmg = path.join(tmp, 'firefox-esr.dmg');
      await download(DOWNLOAD.darwin, dmg, (p) => onProgress({ step: 'download', p }));
      onProgress({ step: 'verify' });
      const mount = path.join(tmp, 'mnt'); fs.mkdirSync(mount);
      await run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mount]);
      try {
        const src = path.join(mount, 'Firefox.app');
        await run('codesign', ['--verify', '--deep', '--strict', src]);
        const info = await new Promise((r) => execFile('codesign', ['-dv', '--verbose=2', src], (_e, o, se) => r(String(se) + String(o))));
        const team = /TeamIdentifier=(\w+)/.exec(info);
        if (!team || team[1] !== MOZILLA_TEAM_ID) throw new Error('Signatur von Firefox ungültig – abgebrochen.');
        onProgress({ step: 'install' });
        fs.mkdirSync(target, { recursive: true });
        await run('ditto', [src, path.join(target, 'Firefox.app')]);
      } finally { await run('hdiutil', ['detach', mount, '-quiet']).catch(() => {}); }
    } else {
      const arc = path.join(tmp, 'firefox.tar');
      await download(DOWNLOAD.linux, arc, (p) => onProgress({ step: 'download', p }));
      onProgress({ step: 'install' });
      fs.mkdirSync(target, { recursive: true });
      await run('tar', ['-xf', arc, '-C', target]);
    }
    fs.rmSync(paths.engine(), { recursive: true, force: true });
    fs.renameSync(target, paths.engine());
    log('Motor installiert');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(target, { recursive: true, force: true }); }
  if (!installed()) throw new Error('Firefox-Motor wurde nicht gefunden – bitte noch einmal versuchen.');
}

/** Windows: ImmoAdv-Logo statt Firefox-Logo im Programm des Motors (Taskleiste, Fenster, Alt+Tab).
 *  Nur die lokale Kopie im ImmoAdv-Ordner; nach jedem Mozilla-Update erneut (Merker: Größe + Zeit der Datei). */
async function brandIcon() {
  if (isMac) return brandMac();
  if (!isWin) return false;
  try { await brandStrings(); } catch (e) { log('Name: ' + (e.message || e)); }
  const file = exe(), ico = path.join(paths.engineFiles(), 'icons', 'main-window.ico');
  // Merker v2 (02.11.2026): zusätzlich Programmname „ImmoAdv Browser“ (Task-Manager, Taskleiste, Windows-Meldungen).
  const mark = path.join(paths.engine(), '.immoadv-logo2');
  let st; try { st = fs.statSync(file); } catch { return false; }
  const key = `${st.size}:${st.mtimeMs}`;
  try { if (fs.readFileSync(mark, 'utf8') === key) return false; } catch { /* noch nie */ }
  try {
    const bin = require.resolve('rcedit/bin/rcedit-x64.exe').replace('app.asar', 'app.asar.unpacked');
    await run(bin, [file, '--set-icon', ico, '--set-version-string', 'FileDescription', 'ImmoAdv Browser', '--set-version-string', 'ProductName', 'ImmoAdv Browser', '--set-version-string', 'CompanyName', 'ImmoAdv'], { timeout: 60000 });
    const st2 = fs.statSync(file);
    fs.writeFileSync(mark, `${st2.size}:${st2.mtimeMs}`);
    log('ImmoAdv-Logo gesetzt');
    return true;
  } catch (e) { log('Logo: ' + (e.message || e)); return false; }
}

/** Name „ImmoAdv Browser“ überall im Browser (02.11.2026, Feray: „soll überall ImmoAdv Browser heißen“): Fehlerseiten,
 *  Add-ons, Dialoge und Menüs nehmen den Namen aus den Marken-Texten des Motors (branding/brand.ftl, .properties,
 *  .dtd in omni.ja). Diese werden in der lokalen Kopie ersetzt – vorher gesichert, danach geprüft; schlägt etwas fehl,
 *  wird die Sicherung zurückgelegt. Nur bei geschlossenem Motor; nach jedem Mozilla-Update erneut. */
async function brandStrings() {
  if (running()) return false;
  const { path7za } = require('7zip-bin');
  const seven = path7za.replace('app.asar', 'app.asar.unpacked');
  const root = isMac ? path.join(paths.engine(), 'Firefox.app', 'Contents', 'Resources') : paths.engine();
  const NAME = 'ImmoAdv Browser';
  let done = false;
  for (const omni of [path.join(root, 'browser', 'omni.ja'), path.join(root, 'omni.ja')]) {
    let st; try { st = fs.statSync(omni); } catch { continue; }
    const mark = omni + '.immoadv';
    try { if (fs.readFileSync(mark, 'utf8') === `${st.size}:${st.mtimeMs}`) continue; } catch { /* noch nie */ }
    const list = await run(seven, ['l', '-ba', '-slt', omni], { timeout: 60000 });
    const files = list.split(/\r?\n/).filter((l) => l.startsWith('Path = ')).map((l) => l.slice(7).trim()).filter((f) => /(^|\/)branding\/brand\.(ftl|properties|dtd)$/.test(f));
    if (!files.length) { fs.writeFileSync(mark, `${st.size}:${st.mtimeMs}`); continue; }
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'immoadv-brand-'));
    const backup = omni + '.original';
    try {
      await run(seven, ['x', omni, `-o${tmp}`, '-y', ...files], { timeout: 60000 });
      let changed = 0;
      for (const f of files) {
        const fp = path.join(tmp, f);
        const txt = fs.readFileSync(fp, 'utf8');
        const out = txt.split(/\n/).map((line) => (/trademark|vendor|Mozilla Foundation|mozilla\.org/i.test(line) ? line : line.replace(/(Mozilla )?Firefox( ESR)?/g, NAME))).join('\n');
        if (out !== txt) { fs.writeFileSync(fp, out); changed++; }
      }
      if (changed) {
        if (!fs.existsSync(backup)) fs.copyFileSync(omni, backup);
        await run(seven, ['u', '-tzip', '-mx=0', omni, ...files], { timeout: 120000, cwd: tmp });
        await run(seven, ['t', omni], { timeout: 120000 });
        fs.writeFileSync(path.join(paths.engine(), '.purge'), '1');
        done = true;
        log(`Name ImmoAdv Browser in ${path.basename(path.dirname(omni))}/omni.ja (${changed} Dateien)`);
      }
      const st2 = fs.statSync(omni);
      fs.writeFileSync(mark, `${st2.size}:${st2.mtimeMs}`);
    } catch (e) {
      log('Name (omni.ja): ' + (e.message || e) + ' – Sicherung zurückgelegt');
      try { if (fs.existsSync(backup)) fs.copyFileSync(backup, omni); } catch { /* egal */ }
      try { const st3 = fs.statSync(omni); fs.writeFileSync(mark, `${st3.size}:${st3.mtimeMs}`); } catch { /* egal */ }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  return done;
}

/** Mac (02.11.2026, Feray: „in der Kopfzeile soll ImmoAdv Browser stehen“): In der Menüleiste, im Dock und bei
 *  Cmd+Tab stand „Firefox“ – der Name kommt aus dem Programmpaket des Motors. Die lokale Kopie im ImmoAdv-Ordner bekommt
 *  Name und Logo von ImmoAdv und wird danach neu (ad-hoc) signiert, damit macOS sie weiter startet. Nach jedem
 *  Mozilla-Update erneut (Merker: Größe + Zeit der Info.plist). Nur wenn der Motor gerade nicht läuft. */
async function brandMac() {
  const appPath = path.join(paths.engine(), 'Firefox.app');
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const mark = path.join(paths.engine(), '.immoadv-name');
  let st; try { st = fs.statSync(plist); } catch { return false; }
  const key = `${st.size}:${st.mtimeMs}`;
  try { if (fs.readFileSync(mark, 'utf8') === key) return false; } catch { /* noch nie */ }
  if (running()) return false;
  const NAME = 'ImmoAdv Browser';
  try {
    await run('plutil', ['-replace', 'CFBundleName', '-string', NAME, plist]);
    await run('plutil', ['-replace', 'CFBundleDisplayName', '-string', NAME, plist]);
    // Übersetzte Namen (de.lproj usw.) haben Vorrang vor der Info.plist – überall ersetzen.
    const res = path.join(appPath, 'Contents', 'Resources');
    for (const d of fs.readdirSync(res).filter((x) => x.endsWith('.lproj'))) {
      const f = path.join(res, d, 'InfoPlist.strings');
      if (!fs.existsSync(f)) continue;
      try {
        await run('plutil', ['-convert', 'xml1', f]);
        await run('plutil', ['-replace', 'CFBundleName', '-string', NAME, f]);
        await run('plutil', ['-replace', 'CFBundleDisplayName', '-string', NAME, f]);
      } catch (e) { log('Name ' + d + ': ' + (e.message || e)); }
    }
    // Logo: das ImmoAdv-Symbol des Programms statt des Firefox-Symbols (Asset-Katalog-Verweis entfernen, sonst gewinnt er).
    const icns = path.join(process.resourcesPath || '', 'icon.icns');
    if (fs.existsSync(icns)) {
      let iconFile = 'firefox';
      try { iconFile = String(await run('plutil', ['-extract', 'CFBundleIconFile', 'raw', plist])).trim().replace(/\.icns$/, '') || 'firefox'; } catch { /* Standard */ }
      fs.copyFileSync(icns, path.join(res, iconFile + '.icns'));
      try { await run('plutil', ['-remove', 'CFBundleIconName', plist]); } catch { /* nicht vorhanden */ }
    }
    try { await brandStrings(); } catch (e) { log('Name: ' + (e.message || e)); }
    await run('codesign', ['--force', '--deep', '--sign', '-', appPath], { timeout: 120000 });
    try { await run('xattr', ['-cr', appPath]); } catch { /* egal */ }
    try { const now = new Date(); fs.utimesSync(appPath, now, now); } catch { /* egal */ }
    const st2 = fs.statSync(plist);
    fs.writeFileSync(mark, `${st2.size}:${st2.mtimeMs}`);
    log('Mac: Name und Logo ImmoAdv Browser gesetzt');
    return true;
  } catch (e) { log('Mac-Name: ' + (e.message || e)); return false; }
}

/** Läuft der Motor gerade mit dem ImmoAdv-Profil? */
function running() {
  const dir = paths.profile();
  if (isWin) {
    const lock = path.join(dir, 'parent.lock');
    if (!fs.existsSync(lock)) return false;
    try { fs.unlinkSync(lock); return false; } catch { return true; }   // Firefox hält die Datei gesperrt
  }
  try {
    const target = fs.readlinkSync(path.join(dir, 'lock'));           // „IP:+PID“
    const pid = Number(String(target).split('+').pop());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}
async function waitClosed(ms = 90000) {
  const end = Date.now() + ms;
  while (running() && Date.now() < end) await new Promise((r) => setTimeout(r, 500));
  return !running();
}

const fileUrl = (p) => require('node:url').pathToFileURL(p).href;
function writeIfChanged(file, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  try { if (fs.readFileSync(file).equals(buf)) return false; } catch { /* neu */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', buf); fs.renameSync(file + '.tmp', file);
  return true;
}

/** Feste Einstellungen in den Motor-Ordner (Autoconfig + Richtlinien) – nach jedem Mozilla-Update erneut sichergestellt */
function writeEngineConfig() {
  const src = paths.engineFiles();
  const dir = appDir();
  const s = store.all();
  writeIfChanged(path.join(dir, 'defaults', 'pref', 'autoconfig.js'), fs.readFileSync(path.join(src, 'autoconfig.js')));
  writeIfChanged(path.join(dir, 'immoadv.cfg'), fs.readFileSync(path.join(src, 'immoadv.cfg')));
  const pol = JSON.parse(fs.readFileSync(path.join(src, 'policies.json'), 'utf8'));
  pol.policies.ExtensionSettings[EXT_ID].install_url = fileUrl(paths.bundledXpi());
  const engine = SEARCH[s.searchEngine] || 'Google';
  pol.policies.SearchEngines = { Default: engine, PreventInstalls: false };
  if (engine === 'Startpage') pol.policies.SearchEngines.Add = [{ Name: 'Startpage', URLTemplate: 'https://www.startpage.com/sp/search?query={searchTerms}', Method: 'GET', IconURL: 'https://www.startpage.com/favicon.ico', Alias: '@sp' }];
  if (s.httpsOnly === false) pol.policies.HttpsOnlyMode = 'allowed';
  writeIfChanged(path.join(dir, 'distribution', 'policies.json'), JSON.stringify(pol, null, 2));
  // Fenster-Symbol (Taskleiste) im ImmoAdv-Logo
  const ico = path.join(src, 'icons', 'main-window.ico');
  if (fs.existsSync(ico)) {
    for (const d of [path.join(dir, 'chrome', 'icons', 'default'), path.join(dir, 'browser', 'chrome', 'icons', 'default')]) {
      const b = fs.readFileSync(ico);
      writeIfChanged(path.join(d, 'main-window.ico'), b);
      writeIfChanged(path.join(d, 'default.ico'), b);
    }
  }
}

function readPref(name) {
  try {
    const txt = fs.readFileSync(path.join(paths.profile(), 'prefs.js'), 'utf8');
    const m = new RegExp(`user_pref\\("${name.replace(/\./g, '\\.')}",\\s*("(?:[^"\\\\]|\\\\.)*")\\);`).exec(txt);
    return m ? JSON.parse(m[1]) : null;
  } catch { return null; }
}

function readNumPref(name) {
  try { const m = new RegExp(`user_pref\\("${name.replace(/\./g, '\\.')}",\\s*(\\d+)\\);`).exec(fs.readFileSync(path.join(paths.profile(), 'prefs.js'), 'utf8')); return m ? Number(m[1]) : 0; } catch { return 0; }
}

/** user.js aus den ImmoAdv-Einstellungen (gleiche Datei wie Version 3) */
function userJs() {
  const s = store.all();
  const vertical = s.tabLayout === 'vertical';
  let uuids = {};
  try { uuids = JSON.parse(readPref('extensions.webextensions.uuids') || '{}'); } catch { uuids = {}; }
  uuids[EXT_ID] = EXT_UUID;
  const dl = s.downloadDir || app.getPath('downloads');
  const minutes = Number(s.suspendMinutes);
  const vars = {
    bookmarkBar: s.bookmarkBar === false ? 'never' : 'always',
    verticalTabs: String(vertical),
    sidebarVisibility: vertical ? 'always-show' : 'hide-sidebar',
    // Feray 02.11.2026: „Verlauf, Lesezeichen und Zahnrad nicht links, sondern oben rechts im ⋯-Menü“ – die Leiste am
    // linken Rand gibt es nur noch bei Tabs links. Der KI-Assistent öffnet weiter als Seitenleiste (ohne Symbol-Streifen).
    sidebarRevamp: String(vertical),
    suspendMs: String(minutes > 0 ? minutes * 60000 : 7 * 24 * 3600 * 1000),
    startupPage: s.restoreSession === false ? '1' : '3',
    httpsOnly: String(s.httpsOnly !== false),
    trrMode: DNS[s.dnsProvider || 'quad9'] ? '2' : '5',
    trrUri: DNS[s.dnsProvider || 'quad9'] || DNS.quad9,
    firefoxPasswords: 'false',
    keepHistory: String(Number(s.historyDays) !== 0),
    downloadDir: dl.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
    extUuids: JSON.stringify(uuids).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  };
  let txt = fs.readFileSync(path.join(paths.engineFiles(), 'user.js'), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
  // Symbolleiste nur beim ersten Mal festlegen – danach bleibt, was du selbst angepasst hast
  // (neue ImmoAdv-Anordnung ⇒ höhere immoadv.ui.version ⇒ einmal neu gesetzt)
  const UI_VERSION = 2;
  if (readPref('browser.uiCustomization.state') && Number(readNumPref('immoadv.ui.version')) >= UI_VERSION) txt = txt.replace(/^user_pref\("browser\.uiCustomization\.state".*$/m, '');
  // Mac (02.11.2026, Feray: „am Mac kommen keine Benachrichtigungen“): Der Motor ist nach dem ImmoAdv-Umbenennen nur
  // ad-hoc signiert – macOS stellt seine Mitteilungen dann nicht zu. Darum zeigt der Browser Mitteilungen selbst an
  // (eigene Einblendung oben rechts, funktioniert immer).
  if (isMac) txt += '\nuser_pref("alerts.useSystemBackend", false);\n';
  return txt;
}

/** Profil einrichten/aktualisieren – nur solange der Motor zu ist */
function writeProfile() {
  const dir = paths.profile();
  fs.mkdirSync(path.join(dir, 'chrome'), { recursive: true });
  writeIfChanged(path.join(dir, 'user.js'), userJs());
  const src = paths.engineFiles();
  for (const f of ['userChrome.css', 'userContent.css']) writeIfChanged(path.join(dir, 'chrome', f), fs.readFileSync(path.join(src, 'chrome', f)));
  // ImmoAdv-Erweiterung: neue Version ersetzt die alte (Firefox lädt sie beim Start neu)
  const xpi = paths.bundledXpi();
  if (fs.existsSync(xpi)) {
    const changed = writeIfChanged(path.join(dir, 'extensions', `${EXT_ID}.xpi`), fs.readFileSync(xpi));
    if (changed) log('Erweiterung aktualisiert');
  }
}

let pendingRestart = false;
/** Alles bereitstellen (wenn der Motor gerade zu ist) */
function deploy() {
  if (!installed()) return false;
  writeEngineConfig();
  if (running()) { pendingRestart = true; return false; }
  writeProfile();
  pendingRestart = false;
  return true;
}

function launch(args = []) {
  // Mac (02.11.2026, Feray: „lässt sich vom Dock nicht zwei-, dreimal starten“): Läuft der Motor schon (am Mac bleibt
  // er nach dem Schließen des letzten Fensters aktiv), startete ein zweiter Prozess mit demselben Profil – macOS/Firefox
  // ignorierten ihn, es passierte nichts. Jetzt wird das laufende Programm über macOS geweckt: neues Fenster bzw. die Links.
  if (isMac && running()) {
    const appPath = path.join(paths.engine(), 'Firefox.app');
    const urls = args.filter((a) => !String(a).startsWith('-'));
    const child = spawn('open', ['-a', appPath, ...urls], { detached: true, stdio: 'ignore' });
    child.on('error', (e) => log('Wecken fehlgeschlagen: ' + e.message));
    child.unref();
    log(`Wecken ${urls.join(' ')}`.trim());
    return;
  }
  const purgeFlag = path.join(paths.engine(), '.purge');
  if (fs.existsSync(purgeFlag)) { args = ['-purgecaches', ...args]; try { fs.unlinkSync(purgeFlag); } catch { /* egal */ } }
  const child = spawn(exe(), ['--profile', paths.profile(), ...args], { detached: true, stdio: 'ignore', windowsHide: false, cwd: path.dirname(exe()) });
  child.on('error', (e) => log('Start fehlgeschlagen: ' + e.message));   // z. B. Virenscanner/Smart App Control – nie abstürzen
  child.unref();
  log(`Start ${args.length ? args.join(' ') : ''}`.trim());
}

/** Seiten der Erweiterung (feste Adresse) */
const extUrl = (p) => `moz-extension://${EXT_UUID}/${p.replace(/^\//, '')}`;

async function version() {
  try {
    const ini = fs.readFileSync(path.join(isMac ? appDir() : path.dirname(exe()), 'application.ini'), 'utf8');
    const m = /^Version=(.+)$/m.exec(ini); return m ? m[1].trim() : null;
  } catch { return null; }
}

module.exports = { brandIcon, EXT_ID, EXT_UUID, paths, installed, install, running, waitClosed, deploy, writeProfile, writeEngineConfig, launch, extUrl, version, log, needsRestart: () => pendingRestart };
