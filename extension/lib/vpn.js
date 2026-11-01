// NordVPN direkt im Browser – ohne NordVPN-App.
// Technik: verschlüsselter NordVPN-Proxy (HTTPS/TLS, Port 89) für den gesamten Browser-Verkehr.
// Notaus: Chrome lädt bei fehlender VPN-Verbindung nichts direkt (kein Rückfall auf „direkt“).
// DNS wird beim VPN-Server aufgelöst → keine DNS-Lecks; WebRTC nur über das VPN.
import { getSettings, setSettings } from './settings.js';
import { readSecret } from './vault.js';

const API = 'https://api.nordvpn.com/v1';
const PORT = 89;
let current = null;            // { host, country }
let authTries = 0;
let reconnects = 0;

export const COUNTRIES = [
  ['DE', 'Deutschland', 81], ['NL', 'Niederlande', 153], ['CH', 'Schweiz', 209], ['AT', 'Österreich', 14],
  ['FR', 'Frankreich', 74], ['SE', 'Schweden', 208], ['GB', 'Großbritannien', 227], ['US', 'USA', 228], ['TR', 'Türkei', 220]
];

async function state(patch) {
  const { vpnState } = await getSettings();
  await setSettings({ vpnState: { ...vpnState, ...patch, at: new Date().toISOString() } });
}

/** Schnellste Server im gewünschten Land (geringste Auslastung laut NordVPN); letzte Liste wird gemerkt,
 *  damit ein Netzwechsel oder ein kurzer Ausfall der NordVPN-Schnittstelle nie stört. */
async function serverList(country) {
  const c = COUNTRIES.find((x) => x[0] === country);     // „auto“ → NordVPN wählt die schnellsten Server in deiner Nähe
  const url = `${API}/servers/recommendations?${c ? `filters[country_id]=${c[2]}&` : ''}filters[servers_technologies][identifier]=proxy_ssl&limit=10`;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      const list = (await r.json()).filter((x) => x.hostname).sort((a, b) => (a.load || 0) - (b.load || 0)).map((x) => x.hostname);
      if (list.length) { await chrome.storage.local.set({ vpnServers: { country, list, at: Date.now() } }); return list; }
    }
  } catch { /* offline oder Netzwechsel → gemerkte Liste */ }
  const { vpnServers } = await chrome.storage.local.get('vpnServers');
  return vpnServers && vpnServers.country === country ? vpnServers.list : [];
}

async function setWebRTC(vpnOn, privacyOn) {
  const p = chrome.privacy.network.webRTCIPHandlingPolicy;
  try {
    if (vpnOn) await p.set({ value: 'disable_non_proxied_udp' });
    else if (privacyOn) await p.set({ value: 'default_public_interface_only' });
    else await p.clear({});
  } catch { /* egal */ }
}

export async function connect(exclude = []) {
  const s = await getSettings();
  if (!s.vpn.enabled) return disconnect();
  const creds = await readSecret('nordvpn');
  if (!creds) {
    // Noch nicht angemeldet → normal surfen, bis die NordVPN-Daten einmal eingetragen sind
    current = null;
    await chrome.proxy.settings.clear({ scope: 'regular' });
    await setWebRTC(false, s.privacy.webrtc);
    return state({ status: 'nocreds', server: null, message: '' });
  }
  // Serverliste wird über die bestehende VPN-Verbindung geholt; nur beim allerersten Verbinden direkt bei NordVPN
  if (!current) await chrome.proxy.settings.clear({ scope: 'regular' });
  const list = (await serverList(s.vpn.country)).filter((h) => !exclude.includes(h));
  const host = list[0] || (current && current.host);
  if (!host) {
    // Allererster Start ohne Internet: nichts laden, bis Netz da ist (Chrome zeigt „Keine Internetverbindung“)
    await chrome.proxy.settings.set({ scope: 'regular', value: { mode: 'fixed_servers', rules: { singleProxy: { scheme: 'https', host: 'vpn-wartet-auf-internet.invalid', port: PORT } } } });
    return state({ status: 'waiting', server: null, message: 'Wartet auf Internetverbindung' });
  }
  current = { host, country: s.vpn.country };
  authTries = 0;
  await chrome.proxy.settings.set({
    scope: 'regular',
    value: { mode: 'fixed_servers', rules: { singleProxy: { scheme: 'https', host, port: PORT }, bypassList: ['<local>'] } }
  });
  await setWebRTC(true, s.privacy.webrtc);
  await state({ status: 'on', server: host, message: '' });
}

export async function disconnect() {
  current = null;
  await chrome.proxy.settings.clear({ scope: 'regular' });
  const s = await getSettings();
  await setWebRTC(false, s.privacy.webrtc);
  await state({ status: 'off', server: null, message: '' });
}

// Anmeldung am VPN-Server – nur für unseren eigenen Server, nie für Webseiten
chrome.webRequest.onAuthRequired.addListener((details, callback) => {
  // Nur unser NordVPN-Server bekommt die Zugangsdaten (gilt auch nach einem Neustart des Hintergrunds)
  if (!details.isProxy || !/\.nordvpn\.com$/i.test(details.challenger.host) || details.challenger.port !== PORT) return callback({});
  if (++authTries > 3) {
    state({ status: 'error', message: 'NordVPN lehnt die Zugangsdaten ab – bitte im Datenschutz-Center prüfen' });
    return callback({ cancel: true });
  }
  readSecret('nordvpn').then((c) => callback(c ? { authCredentials: { username: c.user, password: c.pass } } : { cancel: true }));
}, { urls: ['<all_urls>'] }, ['asyncBlocking']);

// Server fällt aus → still den nächstschnellsten nehmen. Ohne Internet: nichts tun, Chrome zeigt „Keine Internetverbindung“.
chrome.proxy.onProxyError.addListener(async (e) => {
  if (!current || e.fatal === false || !navigator.onLine) return;
  if (++reconnects > 3) { reconnects = 0; return; }
  await connect([current.host]);
});
setInterval(() => { reconnects = 0; }, 5 * 60 * 1000);
// Internet wieder da (z. B. nach WLAN-Wechsel oder Funkloch) → sofort weiter
self.addEventListener('online', () => connect());

/** Nach Neustart des Hintergrunds: aktuellen Server wieder kennen */
export async function restore() {
  const { vpnState } = await chrome.storage.local.get('vpnState');
  if (vpnState && vpnState.server) current = { host: vpnState.server };
}
restore();

export const vpnCurrent = () => current;
