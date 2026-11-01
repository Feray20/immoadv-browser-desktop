// NordVPN direkt im Browser – ohne NordVPN-App (wie Version 3).
// Verschlüsselter NordVPN-Proxy (HTTPS/TLS, Port 89) für alle Tabs; DNS löst der VPN-Server auf.
// Zugangsdaten liegen verschlüsselt im ImmoAdv-Programm (Windows: DPAPI, Mac: Schlüsselbund) und nur im Arbeitsspeicher hier.
// Notaus: ist kein Server erreichbar, wird nichts ungeschützt geladen.
'use strict';
const Vpn = (() => {
  const PORT = 89;
  const API = 'https://api.nordvpn.com/v1/servers/recommendations';
  const COUNTRIES = [
    { code: 'auto', name: 'Automatisch (schnellster)', id: 0 }, { code: 'DE', name: 'Deutschland', id: 81 },
    { code: 'NL', name: 'Niederlande', id: 153 }, { code: 'CH', name: 'Schweiz', id: 209 }, { code: 'AT', name: 'Österreich', id: 14 },
    { code: 'FR', name: 'Frankreich', id: 74 }, { code: 'SE', name: 'Schweden', id: 208 }, { code: 'GB', name: 'Großbritannien', id: 227 },
    { code: 'US', name: 'USA', id: 228 }, { code: 'TR', name: 'Türkei', id: 220 }
  ];
  const BLACKHOLE = { type: 'https', host: 'vpn-wartet-auf-internet.invalid', port: PORT };
  let creds = null;          // { user, pass } – nur im Arbeitsspeicher
  let auth = '';
  let current = null;
  let servers = [];
  let failovers = 0;
  const state = { status: 'nocreds', server: null, message: '' };
  const subs = new Set();
  const emit = (p) => { Object.assign(state, p); subs.forEach((fn) => fn({ ...state, loggedIn: !!creds })); };

  const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const direct = (url) => /^https:\/\/api\.nordvpn\.com\/v1\/servers\//.test(url);
  const isLocal = (host) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+)$/i.test(host) || /\.(local|lan|home\.arpa)$/i.test(host);

  // Jede Anfrage: über den aktuellen NordVPN-Server (Ausnahme: lokale Geräte, Serverliste von NordVPN)
  function onRequest(info) {
    if (!creds) return { type: 'direct' };
    let host = ''; try { host = new URL(info.url).hostname; } catch (e) {}
    if (isLocal(host)) return { type: 'direct' };
    if (direct(info.url) && (info.tabId === -1)) return { type: 'direct' };
    if (!current) return BLACKHOLE;
    const next = servers.filter((h) => h !== current).slice(0, 2);
    // Ausfall eines Servers: Firefox nimmt automatisch den nächsten aus der Liste (kein ungeschützter Rückfall)
    return [current, ...next].map((h) => ({ type: 'https', host: h, port: PORT, proxyDNS: true, proxyAuthorizationHeader: auth, connectionIsolationKey: '', failoverTimeout: 4 }));
  }

  async function loadServers() {
    const c = COUNTRIES.find((x) => x.code === Settings.get('vpnCountry') && x.id);
    const url = `${API}?${c ? `filters[country_id]=${c.id}&` : ''}filters[servers_technologies][identifier]=proxy_ssl&limit=10`;
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 7000);
      const r = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        const list = (await r.json()).filter((s) => s.hostname).sort((a, b) => (a.load || 0) - (b.load || 0)).map((s) => s.hostname);
        if (list.length) { servers = list; Settings.set({ vpnServers: list }); return list; }
      }
    } catch (e) { /* offline → gemerkte Liste */ }
    servers = Settings.get('vpnServers') || [];
    return servers;
  }

  async function verify() {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch('https://api.nordvpn.com/v1/helpers/ips/insights', { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 407) return { ok: false, error: 'auth' };
      const j = await r.json().catch(() => null);
      return { ok: r.ok, protected: !!(j && j.protected), country: j && j.country, status: r.status };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  }

  let queue = Promise.resolve();
  const apply = () => (queue = queue.then(doApply, doApply));
  let gen = 0;
  async function doApply() {
    try { creds = await Native.call('vpn.creds'); } catch (e) { /* Programm nicht da → gemerkter Zustand */ }
    auth = creds ? 'Basic ' + b64(`${creds.user}:${creds.pass}`) : '';
    if (!creds) { current = null; return emit({ status: 'nocreds', server: null, message: '' }); }
    if (!current) {
      servers = Settings.get('vpnServers') || [];
      if (servers.length) { current = servers[0]; loadServers().catch(() => {}); }
      else { current = (await loadServers())[0] || null; }
    }
    if (!current) return emit({ status: 'waiting', server: null, message: 'Wartet auf Internetverbindung' });
    emit({ status: 'connecting', server: current, message: 'Verbindung wird geprüft' });
    const my = ++gen, server = current;
    const v = await verify();
    if (my !== gen) return;
    if (v.ok) { failovers = 0; return emit({ status: 'on', server, message: v.protected ? '' : 'Verbunden', country: v.country }); }
    if (v.error === 'auth') return emit({ status: 'authfail', server, message: 'NordVPN lehnt die Zugangsdaten ab – bitte die Dienst-Zugangsdaten (Manuelle Einrichtung) eintragen' });
    emit({ status: 'error', server, message: `Server ${server} antwortet nicht` });
    if (failovers < 4 && navigator.onLine) { failovers++; servers = servers.filter((h) => h !== server); current = servers[0] || null; Settings.set({ vpnServers: servers }); if (!current) await loadServers(); setTimeout(apply, 500); }
  }

  function init() {
    browser.proxy.onRequest.addListener(onRequest, { urls: ['<all_urls>'] });
    browser.proxy.onError.addListener((e) => console.warn('Proxy', e && e.message));
    // Firefox fragt bei 407 nach – nur für NordVPN-Server antworten, nie für Webseiten
    browser.webRequest.onAuthRequired.addListener((d) => {
      if (!d.isProxy || !creds || !/\.nordvpn\.com$/i.test(d.challenger && d.challenger.host || '')) return {};
      return { authCredentials: { username: creds.user, password: creds.pass } };
    }, { urls: ['<all_urls>'] }, ['blocking']);
    window.addEventListener('online', () => { if (creds && state.status !== 'on') { current = null; apply(); } });
    apply();
  }

  return {
    COUNTRIES, init, apply,
    state: () => ({ ...state, loggedIn: !!creds, country: Settings.get('vpnCountry') }),
    onState: (fn) => subs.add(fn),
    async login(user, pass) { await Native.call('vpn.login', { user, pass }); current = null; await apply(); return Vpn.state(); },
    async logout() { await Native.call('vpn.logout'); creds = null; current = null; await apply(); return Vpn.state(); },
    async setCountry(code) { if (!COUNTRIES.some((c) => c.code === code)) return; await Settings.set({ vpnCountry: code, vpnServers: [] }); servers = []; current = null; await apply(); return Vpn.state(); },
    async recheck() { current = null; await apply(); return Vpn.state(); }
  };
})();
