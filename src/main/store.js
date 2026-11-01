// Einstellungen, Lesezeichen und Tresor-Daten – nur lokal in einer Datei im App-Ordner.
// Gleiche Datei wie im bisherigen Browser: Lesezeichen und Download-Ordner bleiben beim Update erhalten.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const file = () => path.join(app.getPath('userData'), 'einstellungen.json');

const defaults = {
  // Schutz
  blockAds: true,              // Werbung & Tracker (inkl. Fingerprinting-Skripte)
  blockMalware: true,
  blockPhishing: true,
  freshLists: true,            // Malware-/Phishing-Listen täglich aktualisieren
  allowlist: [],               // vertrauenswürdige Seiten: dort wird nichts blockiert
  blocklist: [],               // eigene Sperrliste
  httpsOnly: true,
  cleanLinks: true,            // Tracking-Zusätze (utm, fbclid …) aus Links entfernen
  javaScript: true,
  dnsProvider: 'quad9',        // verschlüsseltes DNS, solange NordVPN nicht angemeldet ist
  // Spurlos: kein Verlauf; Cookies/Website-Daten einer Seite weg, sobald ihr letzter Tab zu ist – außer hier
  keepSignedIn: ['google.com', 'youtube.com', 'immoadv.de', 'apple.com', 'icloud.com', 'microsoft.com', 'live.com', 'office.com',
    'ebay.de', 'amazon.de', 'autods.com', 'kleinanzeigen.de', 'claude.ai', 'github.com'],
  // NordVPN (Zugangsdaten verschlüsselt mit dem Schlüsselbund des Systems)
  vpnCreds: null,
  vpnCountry: 'auto',
  vpnServers: [],
  // Passwörter (jeder Eintrag einzeln verschlüsselt)
  passwords: [],
  neverSave: [],
  // Statistik (echte Treffer)
  stats: { werbung: 0, malware: 0, phishing: 0, eigene: 0, since: null },
  listsInfo: {},
  // Bedienung
  appLock: false,              // Windows Hello / Touch ID beim Start
  autoUpdate: true,
  rememberFrequent: false,     // spurlos: standardmäßig keine „häufig besucht“-Liste
  bookmarkBar: true,
  frequent: [],
  watchlist: [],
  searchEngine: 'google',
  downloadDir: null,
  bookmarks: [
    { title: 'ImmoAdv', url: 'https://immoadv.de' },
    { title: 'ImmoScout24', url: 'https://www.immobilienscout24.de' },
    { title: 'Immowelt', url: 'https://www.immowelt.de' },
    { title: 'Kleinanzeigen', url: 'https://www.kleinanzeigen.de/s-immobilien/c195' }
  ],
  // Arbeitsbereiche (eigene Tabs je Bereich) und Sitzung (offene Tabs beim nächsten Start wieder da)
  workspaces: [
    { id: 'privat', name: 'Privat', color: '#2A5BD7', icon: '●' },
    { id: 'immo', name: 'Immobilien', color: '#19C2B0', icon: '⌂' }
  ],
  activeWorkspace: 'privat',
  restoreSession: true,
  googleExternal: true,        // Google-Konto (Gmail, Drive, Anmeldung) in Chrome öffnen – Google sperrt eigene Browser

  lastSession: null,
  tabLayout: 'horizontal',     // 'horizontal' oder 'vertical' (Tabs links)
  sidebarCollapsed: false,
  suspendMinutes: 30,          // Hintergrund-Tabs schlafen legen (spart Speicher/Akku), 0 = nie
  // Verlauf (nur lokal): Tage aufbewahren, 0 = kein Verlauf
  historyDays: 30,
  // KI-Assistent (eigener Schlüssel oder lokal mit Ollama)
  aiProvider: 'anthropic',
  aiKeys: {},
  aiModels: {},
  aiInstructions: '',
  aiKeepHistory: true,
  migratedV3: false
};

let data = null;

function load() {
  if (data) return data;
  try { data = { ...defaults, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; }
  catch { data = { ...defaults }; }
  if (!data.migratedV3) {
    // Umstieg vom Tor-Browser (1.x): Lesezeichen/Download-Ordner bleiben, neue Grundeinstellungen gelten
    const backup = path.join(app.getPath('userData'), 'Sicherung-1.x-einstellungen.json');
    try { if (fs.existsSync(file()) && !fs.existsSync(backup)) fs.copyFileSync(file(), backup); } catch {}
    Object.assign(data, { searchEngine: 'google', rememberFrequent: false, frequent: [], migratedV3: true });
    for (const k of ['torEnabled', 'useBridges', 'customBridges', 'googleDirect', 'youtubeDirect', 'updateFallback', 'background', 'trayHintShown', 'blockTrackers']) delete data[k];
    writeNow();
  }
  return data;
}

// Schreiben gebündelt (nach 400 ms, spätestens nach 3 s) – nicht bei jeder Kleinigkeit die ganze Datei
let saveTimer = null, firstPending = 0;
function writeNow() {
  clearTimeout(saveTimer); saveTimer = null; firstPending = 0;
  if (!data) return;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (e) { console.error('Einstellungen speichern', e); }
}
function save() {
  const now = Date.now();
  if (!firstPending) firstPending = now;
  clearTimeout(saveTimer);
  saveTimer = now - firstPending > 3000 ? setTimeout(writeNow, 0) : setTimeout(writeNow, 400);
}

module.exports = {
  get: (k) => load()[k],
  all: () => ({ ...load() }),
  set(k, v) { load()[k] = v; save(); },
  setMany(obj) { Object.assign(load(), obj); save(); }
};
