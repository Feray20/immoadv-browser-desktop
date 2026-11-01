// Spurlos surfen (wie Version 3): Cookies und Website-Speicher einer Seite werden gelöscht, sobald ihr letzter Tab zu ist –
// außer bei Seiten, auf denen du angemeldet bleiben willst (Google, YouTube, ImmoAdv … und Seiten mit gespeichertem Passwort).
'use strict';
const Traceless = (() => {
  const { siteOf } = ImmoLists;
  const timers = new Map();
  const tabSite = new Map();
  const seen = new Set();          // Seiten, die in dieser Sitzung besucht wurden

  const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return ''; } };
  function keep(site) {
    if (!site) return true;
    if (Settings.get('traceless') === false) return true;
    const list = [...(Settings.get('keepSignedIn') || []), ...Vault.sites()];
    return list.some((d) => site === d || site.endsWith('.' + d));
  }
  async function wipe(site) {
    const hostnames = [site, 'www.' + site];
    // alle bekannten Subdomains dieser Seite (aus den Cookies)
    try { for (const c of await browser.cookies.getAll({ domain: site, firstPartyDomain: null, partitionKey: {} })) hostnames.push(String(c.domain).replace(/^\./, '')); } catch (e) {}
    const uniq = [...new Set(hostnames)];
    for (const type of ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'cache']) {
      try { await browser.browsingData.remove({ hostnames: uniq }, { [type]: true }); } catch (e) { /* Typ ohne Hostfilter */ }
    }
    seen.delete(site);
  }
  async function stillOpen(site) {
    const tabs = await browser.tabs.query({});
    return tabs.some((t) => siteOf(hostOf(t.url)) === site);
  }
  function left(site) {
    if (!site || keep(site)) return;
    clearTimeout(timers.get(site));
    timers.set(site, setTimeout(async () => {
      timers.delete(site);
      if (await stillOpen(site)) return;
      try { await wipe(site); } catch (e) { /* nicht kritisch */ }
    }, 8000));
  }
  function track(tabId, url) {
    const site = siteOf(hostOf(url));
    const before = tabSite.get(tabId);
    if (site && /^https?:/.test(url)) { tabSite.set(tabId, site); seen.add(site); } else tabSite.delete(tabId);
    if (before && before !== site) left(before);
  }
  // Beim Start: alles von Seiten löschen, bei denen du nicht angemeldet bleiben willst
  async function startup() {
    if (Settings.get('traceless') === false) return;
    try {
      const sites = new Set();
      for (const c of await browser.cookies.getAll({ firstPartyDomain: null, partitionKey: {} })) {
        const s = siteOf(String(c.domain || '').replace(/^\./, ''));
        if (!keep(s)) sites.add(s);
      }
      const open = new Set((await browser.tabs.query({})).map((t) => siteOf(hostOf(t.url))));
      for (const s of sites) if (!open.has(s)) await wipe(s);
    } catch (e) { console.warn('Aufräumen', e); }
  }
  function init() {
    browser.tabs.onUpdated.addListener((id, info, tab) => { if (info.url) track(id, info.url); }, { properties: ['url'] });
    browser.tabs.onRemoved.addListener((id) => { const s = tabSite.get(id); tabSite.delete(id); if (s) left(s); });
    browser.tabs.query({}).then((tabs) => tabs.forEach((t) => track(t.id, t.url || '')));
    startup();
  }
  return { init, keep, wipeNow: wipe };
})();
