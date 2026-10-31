// Einstellungen und Lesezeichen – nur lokal in einer Datei im App-Ordner.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const file = () => path.join(app.getPath('userData'), 'einstellungen.json');

const defaults = {
  torEnabled: true,
  useBridges: true,
  customBridges: '',
  blockTrackers: true,
  httpsOnly: true,
  javaScript: true,
  appLock: false,              // Touch ID beim Start (nur Mac)
  googleDirect: false,         // Google-Anmeldung ohne Tor (Google sperrt Tor oft)
  autoUpdate: true,
  rememberFrequent: true,      // häufig besuchte Seiten auf der Startseite (nur lokal)
  bookmarkBar: true,           // Lesezeichenleiste unter der Adresszeile
  frequent: [],
  watchlist: [],
  youtubeDirect: false,        // YouTube & Google ohne Tor (keine Roboter-Prüfung, aber echte IP für Google)
  cleanLinks: true,            // Tracking-Zusätze (utm, fbclid …) aus Links entfernen
  downloadDir: null,           // wird beim ersten Start gewählt
  bookmarks: [
    { title: 'ImmoAdv', url: 'https://immoadv.de' },
    { title: 'ImmoScout24', url: 'https://www.immobilienscout24.de' },
    { title: 'Immowelt', url: 'https://www.immowelt.de' },
    { title: 'Kleinanzeigen', url: 'https://www.kleinanzeigen.de/s-immobilien/c195' }
  ]
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
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

module.exports = {
  get: (k) => load()[k],
  all: () => ({ ...load() }),
  set(k, v) { load()[k] = v; save(); },
  setMany(obj) { Object.assign(load(), obj); save(); }
};
