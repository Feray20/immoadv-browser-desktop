// NordVPN direkt im Browser – ohne NordVPN-App.
// Technik: verschlüsselter NordVPN-Proxy (HTTPS/TLS, Port 89) für alle Tabs. DNS löst der VPN-Server auf.
// Einmal anmelden (Dienst-Zugangsdaten), danach automatisch: schnellster Server, stiller Serverwechsel,
// Netzwechsel (WLAN ↔ Mobilfunk) ohne Zutun, Notaus (nie ungeschützt auf „direkt“ zurückfallen).
const { app, net, safeStorage, session } = require('electron');
const store = require('./store');

const PORT = 89;
const API = 'https://api.nordvpn.com/v1/servers/recommendations';
const COUNTRIES = [
  { code: 'auto', name: 'Automatisch (schnellster)', id: 0 }, { code: 'DE', name: 'Deutschland', id: 81 },
  { code: 'NL', name: 'Niederlande', id: 153 }, { code: 'CH', name: 'Schweiz', id: 209 }, { code: 'AT', name: 'Österreich', id: 14 },
  { code: 'FR', name: 'Frankreich', id: 74 }, { code: 'SE', name: 'Schweden', id: 208 }, { code: 'GB', name: 'Großbritannien', id: 227 },
  { code: 'US', name: 'USA', id: 228 }, { code: 'TR', name: 'Türkei', id: 220 }
];

let ses = null;
let current = null;
let failovers = 0;
const state = { status: 'nocreds', server: null, message: '' };
let notify = () => {};
const emit = (patch) => { Object.assign(state, patch); notify({ ...state }); };

// Systemeigene Verschlüsselung (Windows: DPAPI, Mac: Schlüsselbund) – nie Klartext auf der Festplatte
function creds() {
  const box = store.get('vpnCreds');
  if (!box || !safeStorage.isEncryptionAvailable()) return null;
  try { return JSON.parse(safeStorage.decryptString(Buffer.from(box, 'base64'))); } catch { return null; }
}

// Serverliste direkt bei NordVPN (eigene Sitzung ohne Proxy; übermittelt nur das gewünschte Land)
const systemSession = () => session.fromPartition('immoadv-system', { cache: false });
async function servers() {
  const c = COUNTRIES.find((x) => x.code === store.get('vpnCountry') && x.id);
  const url = `${API}?${c ? `filters[country_id]=${c.id}&` : ''}filters[servers_technologies][identifier]=proxy_ssl&limit=10`;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 7000);
    const r = await systemSession().fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      const list = (await r.json()).filter((s) => s.hostname).sort((a, b) => (a.load || 0) - (b.load || 0)).map((s) => s.hostname);
      if (list.length) { store.set('vpnServers', list); return list; }
    }
  } catch { /* offline → gemerkte Liste */ }
  return store.get('vpnServers') || [];
}

async function apply() {
  if (!ses) return;
  if (!creds()) {
    current = null;
    await ses.setProxy({ mode: 'direct' });
    return emit({ status: 'nocreds', server: null, message: '' });
  }
  if (!current) {
    const list = await servers();
    current = list[0] || null;
  }
  if (!current) {
    // Notaus: ohne bekannten Server nichts ungeschützt laden
    await ses.setProxy({ proxyRules: `https://vpn-wartet-auf-internet.invalid:${PORT}` });
    return emit({ status: 'waiting', server: null, message: 'Wartet auf Internetverbindung' });
  }
  await ses.setProxy({ proxyRules: `https://${current}:${PORT}`, proxyBypassRules: '<local>' });
  try { await ses.closeAllConnections(); } catch {}
  emit({ status: 'on', server: current, message: '' });
}

/** Server antwortet nicht → still den nächsten nehmen */
async function failover() {
  if (!creds() || failovers >= 4 || !net.isOnline()) return false;
  failovers++; setTimeout(() => { failovers = 0; }, 5 * 60 * 1000);
  const list = (store.get('vpnServers') || []).filter((h) => h !== current);
  current = list[0] || null;
  store.set('vpnServers', list);
  if (!current) current = (await servers()).find((h) => h !== state.server) || null;
  await apply();
  return true;
}

// Anmeldung am VPN-Server – nur für NordVPN, nie für Webseiten
app.on('login', (event, _wc, _details, authInfo, callback) => {
  if (!authInfo.isProxy || !/\.nordvpn\.com$/i.test(authInfo.host || '')) return;
  const c = creds();
  if (!c) return;
  event.preventDefault();
  callback(c.user, c.pass);
});

// Netz wieder da (WLAN-Wechsel, Funkloch): ggf. neu verbinden
let wasOnline = true;
setInterval(() => {
  const on = net.isOnline();
  if (on && !wasOnline && creds() && state.status !== 'on') { current = null; apply(); }
  wasOnline = on;
}, 2000);

module.exports = {
  COUNTRIES,
  state: () => ({ ...state, loggedIn: !!creds(), country: store.get('vpnCountry') }),
  onState: (fn) => { notify = fn; },
  async init(browsingSession) { ses = browsingSession; await apply(); },
  async setSession(browsingSession) { ses = browsingSession; await apply(); },
  async login(user, pass) {
    if (!user || !pass || !safeStorage.isEncryptionAvailable()) return false;
    store.set('vpnCreds', safeStorage.encryptString(JSON.stringify({ user: String(user).trim(), pass: String(pass) })).toString('base64'));
    current = null; emit({ status: 'connecting' });
    await apply();
    return true;
  },
  async logout() { store.set('vpnCreds', null); current = null; await apply(); },
  async setCountry(code) { if (!COUNTRIES.some((c) => c.code === code)) return; store.set('vpnCountry', code); store.set('vpnServers', []); current = null; await apply(); },
  failover,
  active: () => state.status === 'on'
};
