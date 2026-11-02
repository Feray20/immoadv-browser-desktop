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
  // Upload-Verlauf (02.11.2026): je hochgeladener Datei nur Fingerabdruck + Angaben, nie die Datei
  uploadHistory: true,
  uploads: [],
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
  youtubeExternal: true,       // YouTube in Chrome öffnen (dort mit Google-Konto angemeldet)
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
let readOnly = false;   // Datei war nicht lesbar → nie mit Standardwerten überschreiben

function load() {
  if (data) return data;
  // Kein Datenverlust (Prüfung 01.11.2026): Fehlt die Datei, starten wir frisch. Ist sie nur kurz gesperrt (Virenscanner,
  // EBUSY) oder beschädigt, wird sie NIE mit Standardwerten überschrieben: erst erneut lesen, sonst eine Kopie
  // „einstellungen.defekt-<Zeit>.json“ sichern und bis zum Neustart nichts zurückschreiben.
  let raw = null, missing = false;
  for (let i = 0; i < 4; i++) {
    try { raw = fs.readFileSync(file(), 'utf8'); break; }
    catch (e) { if (e && e.code === 'ENOENT') { missing = true; break; } const t = Date.now() + 150; while (Date.now() < t) { /* kurz warten */ } }
  }
  if (raw != null) {
    try { data = { ...defaults, ...JSON.parse(raw) }; }
    catch { readOnly = true; try { fs.copyFileSync(file(), file().replace(/\.json$/, `.defekt-${Date.now()}.json`)); } catch {} data = { ...defaults }; }
  } else { if (!missing) readOnly = true; data = { ...defaults }; }
  if (readOnly) { console.error('Einstellungen nicht lesbar – Datei bleibt unverändert'); return data; }
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
let gen = 0;   // jede synchrone Speicherung erhöht – ein älterer asynchroner Schreibvorgang überschreibt sie dann nicht
function writeNow() {
  clearTimeout(saveTimer); saveTimer = null; firstPending = 0;
  if (!data || readOnly) return;
  gen++;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (e) { console.error('Einstellungen speichern', e); }
}
// Im Betrieb asynchron schreiben (kein Ruckeln im Hauptprozess, Prüfung 01.11.2026); flush() beim Beenden bleibt synchron.
let writing = null;
async function writeAsync() {
  clearTimeout(saveTimer); saveTimer = null; firstPending = 0;
  if (!data || readOnly) return;
  if (writing) { await writing.catch(() => {}); }
  const body = JSON.stringify(data), my = gen;
  writing = (async () => {
    await fs.promises.mkdir(path.dirname(file()), { recursive: true });
    const tmp = file() + '.a.tmp';
    await fs.promises.writeFile(tmp, body, { mode: 0o600 });
    if (my !== gen) { await fs.promises.unlink(tmp).catch(() => {}); return; }
    await fs.promises.rename(tmp, file());
  })().catch((e) => console.error('Einstellungen speichern', e)).finally(() => { writing = null; });
  return writing;
}
function save() {
  const now = Date.now();
  if (!firstPending) firstPending = now;
  clearTimeout(saveTimer);
  saveTimer = now - firstPending > 3000 ? setTimeout(writeAsync, 0) : setTimeout(writeAsync, 400);
}

// Beobachter (Geräte-Abgleich): wird nach set/setMany mit dem Schlüssel aufgerufen – nicht bei setQuiet.
const watchers = new Set();
const changed = (k) => { for (const fn of watchers) { try { fn(k); } catch { /* nie kritisch */ } } };

module.exports = {
  get: (k) => load()[k],
  all: () => ({ ...load() }),
  set(k, v) { load()[k] = v; save(); changed(k); },
  setQuiet(k, v) { load()[k] = v; save(); },       // interne Daten (Statistik, Sitzung, besuchte Seiten)
  setMany(obj) { Object.assign(load(), obj); save(); Object.keys(obj || {}).forEach(changed); },
  onChange(fn) { watchers.add(fn); return () => watchers.delete(fn); },
  flush: () => writeNow()
};
