// Einstellungen des ImmoAdv-Programms – eine kleine Datei im App-Ordner.
// (Die alte Datei „einstellungen.json“ des früheren Browsers bleibt unangetastet.)
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const file = () => path.join(app.getPath('userData'), 'immoadv-programm.json');

const defaults = {
  setupDone: false,
  dnsProvider: 'quad9',        // verschlüsseltes DNS (wenn NordVPN aktiv ist, läuft DNS ohnehin über den VPN-Server)
  autoUpdate: true,
  migratedFromV1: false,
  lastPrefsVersion: null
};

let data = null;
function load() {
  if (data) return data;
  try { data = { ...defaults, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; }
  catch { data = { ...defaults }; }
  return data;
}
function save() {
  const tmp = file() + '.tmp';
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

module.exports = {
  get: (k) => load()[k],
  all: () => ({ ...load() }),
  set(k, v) { load()[k] = v; save(); }
};
