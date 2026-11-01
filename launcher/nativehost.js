// Native-Messaging-Anmeldung bei Firefox: nur die ImmoAdv-Erweiterung darf mit dem Programm sprechen.
// Firefox startet ein kleines Weiterleitungs-Skript (relay.js, als reines Node), das zum ImmoAdv-Programm im Hintergrund verbindet.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const EXT_ID = 'browser@immoadv.de';
const HOST_NAME = 'de.immoadv.browser';

function relayPath() { return app.isPackaged ? path.join(process.resourcesPath, 'relay.js') : path.join(__dirname, 'relay.js'); }

/** Startskript schreiben und bei Firefox anmelden; gibt den Pfad des Startskripts zurück */
function register() {
  const ud = app.getPath('userData');
  fs.mkdirSync(ud, { recursive: true });
  const exe = process.execPath, relay = relayPath();
  const appDir = app.isPackaged ? '' : path.join(__dirname, '..');
  let script;
  if (process.platform === 'win32') {
    script = path.join(ud, 'native-host.bat');
    fs.writeFileSync(script, ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', appDir ? `set IMMOADV_APP_DIR=${appDir}` : '', `"${exe}" "${relay}" %*`, ''].filter((l, i) => l || i === 4).join('\r\n'));
  } else {
    script = path.join(ud, 'native-host.sh');
    fs.writeFileSync(script, `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\n${appDir ? `export IMMOADV_APP_DIR="${appDir}"\n` : ''}exec "${exe}" "${relay}" "$@"\n`, { mode: 0o755 });
  }
  const json = JSON.stringify({ name: HOST_NAME, description: 'ImmoAdv Browser', path: script, type: 'stdio', allowed_extensions: [EXT_ID] }, null, 2);
  if (process.platform === 'win32') {
    const f = path.join(ud, 'native-host.json');
    fs.writeFileSync(f, json);
    require('node:child_process').execFileSync('reg.exe', ['add', `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', f, '/f'], { windowsHide: true });
  } else {
    const dir = process.platform === 'darwin'
      ? path.join(app.getPath('home'), 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts')
      : path.join(app.getPath('home'), '.mozilla', 'native-messaging-hosts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${HOST_NAME}.json`), json);
  }
  return script;
}

module.exports = { register, EXT_ID, HOST_NAME };
