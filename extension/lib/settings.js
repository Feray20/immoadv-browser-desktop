// Zentrale Einstellungen der ImmoAdv-Schicht – eine Quelle für Hintergrund, Startseite und Datenschutz-Center.
// Benutzer-Einstellungen liegen im Chrome-Sync (Google-Konto) → gleich auf Windows und Mac.
// Zähler und Gerätedaten bleiben lokal auf dem jeweiligen Gerät.

export const SYNC_DEFAULTS = {
  protection: { werbung: true, malware: true, phishing: true },
  allowlist: [],                       // vertrauenswürdige Seiten: dort wird nichts blockiert
  blocklist: [],                       // eigene Sperrliste
  privacy: {
    webrtc: true,                      // lokale IP-Adressen nicht über WebRTC preisgeben
    thirdPartyCookies: true,           // Drittanbieter-Cookies blockieren
    linkAuditing: true,                // „ping“-Tracking bei Links aus
    prediction: true,                  // Vorab-Laden fremder Seiten aus
    privacySandbox: true,              // Werbe-Themen, FLEDGE und Werbe-Messung von Chrome aus
    safeBrowsing: true                 // Googles Schutz vor gefährlichen Seiten (Standard) an
  },
  // Spurlos-Modus: kein Verlauf, Website-Daten weg sobald der letzte Tab der Seite zu ist – außer bei „angemeldet bleiben“
  traceless: { enabled: true, history: true, keep: ['google.com', 'youtube.com', 'immoadv.de', 'apple.com', 'icloud.com', 'microsoft.com', 'live.com', 'office.com', 'ebay.de', 'amazon.de'] },
  vpn: { enabled: true, provider: 'nordvpn', country: 'auto' },   // läuft automatisch, sobald Zugangsdaten hinterlegt sind
  translateTarget: 'de',
  freshLists: true                     // Malware-/Phishing-Listen täglich aktualisieren
};
export const LOCAL_DEFAULTS = {
  stats: { werbung: 0, malware: 0, phishing: 0, eigene: 0, since: null },
  listsInfo: null,
  importedIds: [],
  vpnState: { status: 'off', server: null, message: '' }   // je Gerät
};
export const DEFAULTS = { ...SYNC_DEFAULTS, ...LOCAL_DEFAULTS };
const OBJ = ['protection', 'privacy', 'traceless', 'vpn', 'stats'];

export async function getSettings() {
  const [sy, lo] = await Promise.all([chrome.storage.sync.get(null).catch(() => ({})), chrome.storage.local.get(null)]);
  const out = { ...DEFAULTS };
  for (const k of Object.keys(SYNC_DEFAULTS)) if (k in sy) out[k] = sy[k]; else if (k in lo) out[k] = lo[k];
  for (const k of Object.keys(LOCAL_DEFAULTS)) if (k in lo) out[k] = lo[k];
  for (const k of OBJ) out[k] = { ...DEFAULTS[k], ...(out[k] || {}) };
  return out;
}

export async function setSettings(patch) {
  const sy = {}, lo = {};
  for (const [k, v] of Object.entries(patch)) (k in SYNC_DEFAULTS ? sy : lo)[k] = v;
  if (Object.keys(sy).length) {
    try { await chrome.storage.sync.set(sy); } catch { await chrome.storage.local.set(sy); }   // Sync voll/aus → lokal
  }
  if (Object.keys(lo).length) await chrome.storage.local.set(lo);
}

/** Daten, die das ImmoAdv-Programm (Windows/Mac) beim Start in den Erweiterungsordner schreibt */
export async function launcherInfo() {
  try {
    const r = await fetch(chrome.runtime.getURL('launcher.json'), { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch { /* nicht vorhanden */ }
  return null;
}

export const fmt = (n) => new Intl.NumberFormat('de-DE').format(n || 0);
