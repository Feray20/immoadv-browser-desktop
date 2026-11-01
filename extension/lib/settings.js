// Einstellungen: liegen im ImmoAdv-Programm (dieselbe Datei wie in Version 3 – nichts geht verloren).
// Die Erweiterung hält eine Kopie für schnelle Entscheidungen (Blocker, VPN) und speichert Änderungen über das Programm.
'use strict';
const Settings = (() => {
  const DEFAULTS = {
    blockAds: true, blockMalware: true, blockPhishing: true, freshLists: true, allowlist: [], blocklist: [],
    httpsOnly: true, cleanLinks: true, dnsProvider: 'quad9',
    keepSignedIn: ['google.com', 'youtube.com', 'immoadv.de', 'apple.com', 'icloud.com', 'microsoft.com', 'live.com', 'office.com',
      'ebay.de', 'amazon.de', 'autods.com', 'kleinanzeigen.de', 'claude.ai', 'github.com'],
    traceless: true, vpnCountry: 'auto', vpnServers: [], vpnLoggedIn: false,
    stats: { werbung: 0, malware: 0, phishing: 0, eigene: 0, since: null },
    autoUpdate: true, bookmarkBar: true, tabLayout: 'horizontal', suspendMinutes: 30, historyDays: 30, restoreSession: true,
    searchEngine: 'google', watchlist: [], aiProvider: 'anthropic', aiModels: {}, aiInstructions: '', aiKeepHistory: true,
    pwAsk: true
  };
  let data = { ...DEFAULTS };
  const subs = new Set();
  let loaded = false;

  async function load() {
    try {
      const cached = (await browser.storage.local.get('settings')).settings;
      if (cached) data = { ...DEFAULTS, ...cached };
    } catch (e) { /* erster Start */ }
    try {
      // Schutz darf nie auf das Programm warten: höchstens 3 Sekunden, sonst mit der gemerkten Kopie weiter
      const fresh = await Promise.race([Native.call('settings.get'), new Promise((_, j) => setTimeout(() => j(new Error('Zeit')), 3000))]);
      if (fresh) { data = { ...DEFAULTS, ...fresh }; await browser.storage.local.set({ settings: data }); }
    } catch (e) { /* Programm nicht da: mit Kopie weiter */ }
    loaded = true;
    subs.forEach((fn) => fn(data, null));
    return data;
  }
  Native.on((ev, d) => {
    if (ev === 'settings' && d) { data = { ...DEFAULTS, ...d }; browser.storage.local.set({ settings: data }); subs.forEach((fn) => fn(data, null)); }
  });

  async function set(patch) {
    data = { ...data, ...patch };
    await browser.storage.local.set({ settings: data });
    subs.forEach((fn) => fn(data, patch));
    try { await Native.call('settings.set', { patch }); } catch (e) { console.warn('Einstellung nur lokal gespeichert', e.message); }
    return data;
  }
  // Statistik nur gebündelt schreiben
  let pend = null;
  function count(kind) {
    pend = pend || {};
    pend[kind] = (pend[kind] || 0) + 1;
    if (pend.timer) return;
    pend.timer = setTimeout(() => {
      const add = pend; pend = null;
      const s = { ...(data.stats || {}) };
      for (const k of ['werbung', 'malware', 'phishing', 'eigene']) s[k] = (s[k] || 0) + (add[k] || 0);
      if (!s.since) s.since = new Date().toISOString();
      data.stats = s;
      browser.storage.local.set({ settings: data });
      Native.call('settings.set', { patch: { stats: s }, quiet: true }).catch(() => {});
    }, 15000);
  }
  return { load, set, count, get: (k) => data[k], all: () => ({ ...data }), onChange: (fn) => subs.add(fn), get loaded() { return loaded; }, DEFAULTS };
})();
