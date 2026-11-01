// Google Chrome als Basis: finden, bei Bedarf offiziell installieren, eigenes ImmoAdv-Profil starten
// und dessen Grundeinstellungen setzen (nur solange Chrome mit diesem Profil geschlossen ist).
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const paths = {
  profile: () => path.join(app.getPath('userData'), 'Chrome-Profil'),
  extension: () => path.join(app.getPath('userData'), 'Erweiterung'),
  theme: () => path.join(app.getPath('userData'), 'Design')
};

// Offizielle Google-Quellen (HTTPS); die Datei wird vor dem Start zusätzlich auf Googles Signatur geprüft
const INSTALLER = {
  win32: 'https://dl.google.com/chrome/install/latest/chrome_installer.exe',
  darwin: 'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg'
};
const GOOGLE_TEAM_ID = 'EQHXZ8M8AV';    // Apple-Entwickler-ID von Google LLC

function candidates() {
  if (isWin) {
    const roots = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
    return roots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  if (isMac) {
    const rel = path.join('Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
    return [path.join('/Applications', rel), path.join(os.homedir(), 'Applications', rel)];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
}

function find() { return candidates().find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null; }

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...opts },
    (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve(String(stdout)))));
}

async function download(url, target, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(target);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    if (total && onProgress) onProgress(Math.round(got / total * 100));
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
}

/** Chrome offiziell von Google installieren (Windows: für diesen Benutzer, ohne Admin; Mac: in „Programme“) */
async function install(onProgress = () => {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'immoadv-chrome-'));
  try {
    if (isWin) {
      const file = path.join(tmp, 'chrome_installer.exe');
      await download(INSTALLER.win32, file, (p) => onProgress({ step: 'download', p }));
      onProgress({ step: 'verify' });
      const sig = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`]);
      const [status, subject] = sig.trim().split('|');
      if (status !== 'Valid' || !/O=Google LLC/.test(subject || '')) throw new Error('Signatur des Chrome-Installers ungültig – abgebrochen.');
      onProgress({ step: 'install' });
      await run(file, ['/silent', '/install'], { timeout: 10 * 60 * 1000 });
    } else if (isMac) {
      const dmg = path.join(tmp, 'googlechrome.dmg');
      await download(INSTALLER.darwin, dmg, (p) => onProgress({ step: 'download', p }));
      onProgress({ step: 'verify' });
      const mount = path.join(tmp, 'mnt');
      fs.mkdirSync(mount);
      await run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mount]);
      try {
        const src = path.join(mount, 'Google Chrome.app');
        await run('codesign', ['--verify', '--deep', '--strict', src]);
        const info = await new Promise((r) => execFile('codesign', ['-dv', '--verbose=2', src], (_e, o, se) => r(String(se) + String(o))));
        const team = /TeamIdentifier=(\w+)/.exec(info);
        if (!team || team[1] !== GOOGLE_TEAM_ID) throw new Error('Signatur von Google Chrome ungültig – abgebrochen.');
        onProgress({ step: 'install' });
        let dest = '/Applications';
        try { fs.accessSync(dest, fs.constants.W_OK); } catch { dest = path.join(os.homedir(), 'Applications'); fs.mkdirSync(dest, { recursive: true }); }
        await run('ditto', [src, path.join(dest, 'Google Chrome.app')]);
      } finally { await run('hdiutil', ['detach', mount, '-quiet']).catch(() => {}); }
    } else throw new Error('Bitte Google Chrome über die Paketverwaltung installieren.');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const exe = find();
  if (!exe) throw new Error('Chrome wurde nicht gefunden – bitte noch einmal versuchen.');
  return exe;
}

/** Läuft Chrome gerade mit dem ImmoAdv-Profil? */
function isRunning() {
  const dir = paths.profile();
  if (isWin) {
    const lock = path.join(dir, 'lockfile');
    if (!fs.existsSync(lock)) return false;
    try { fs.unlinkSync(lock); return false; } catch { return true; }   // Chrome hält die Datei gesperrt
  }
  try {
    const target = fs.readlinkSync(path.join(dir, 'SingletonLock'));          // „Rechnername-PID“
    const pid = Number(target.split('-').pop());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

const DNS = {
  quad9: { name: 'Quad9 (Schweiz)', url: 'https://dns.quad9.net/dns-query' },
  mullvad: { name: 'Mullvad (Schweden)', url: 'https://dns.mullvad.net/dns-query' },
  cloudflare: { name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  google: { name: 'Google', url: 'https://dns.google/dns-query' },
  system: { name: 'System-DNS (unverschlüsselt)', url: null }
};

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function writeJson(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.immoadv-tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, f);
}
function deepSet(obj, dotted, value) {
  const keys = dotted.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; }
  o[keys[keys.length - 1]] = value;
}

/**
 * Chrome-Grundeinstellungen des ImmoAdv-Profils (nur wenn Chrome mit diesem Profil zu ist):
 * verschlüsseltes DNS, „Immer sichere Verbindungen“, Windows Hello / Touch ID vor dem Ausfüllen von Passwörtern.
 */
function applyPrefs(dnsKey) {
  if (isRunning()) return false;
  const dir = paths.profile();
  const ls = path.join(dir, 'Local State');
  const local = readJson(ls) || {};
  const d = DNS[dnsKey] || DNS.quad9;
  deepSet(local, 'dns_over_https.mode', d.url ? 'secure' : 'off');
  deepSet(local, 'dns_over_https.templates', d.url || '');
  // Chrome nach dem Schließen des Fensters im Hintergrund lassen: iCloud-Passwörter bleiben verbunden, Start ist sofort da
  deepSet(local, 'background_mode.enabled', true);
  writeJson(ls, local);

  const pf = path.join(dir, 'Default', 'Preferences');
  const prefs = readJson(pf) || {};
  deepSet(prefs, 'https_only_mode_enabled', true);
  deepSet(prefs, 'password_manager.biometric_authentication_filling', true);
  deepSet(prefs, 'profile.name', 'ImmoAdv');
  deepSet(prefs, 'browser.show_home_button', true);
  writeJson(pf, prefs);
  return true;
}

/** Ist die ImmoAdv-Erweiterung in diesem Profil geladen? (Chrome trägt den Ordnerpfad in seine Einstellungen ein) */
function extensionLoaded(dir = paths.extension()) {
  const needle = JSON.stringify(dir).slice(1, -1);
  for (const f of ['Secure Preferences', 'Preferences']) {
    try { if (fs.readFileSync(path.join(paths.profile(), 'Default', f), 'utf8').includes(needle)) return true; } catch { /* noch nicht da */ }
  }
  return false;
}

/** Chrome mit dem ImmoAdv-Profil öffnen. Startet nichts doppelt – bei offenem Chrome kommt ein neues Fenster/Tab. */
function launch(urls = []) {
  const exe = find();
  if (!exe) throw new Error('Google Chrome ist nicht installiert.');
  const args = [`--user-data-dir=${paths.profile()}`, '--profile-directory=Default', ...urls];
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return true;
}

async function version() {
  const exe = find();
  if (!exe) return null;
  try {
    if (isWin) return (await run('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`])).trim();
    return (await run(exe, ['--version'])).replace(/[^\d.]/g, '');
  } catch { return null; }
}

module.exports = { paths, find, install, isRunning, applyPrefs, extensionLoaded, launch, version, DNS };
