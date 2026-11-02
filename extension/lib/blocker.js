// Werbe-, Tracker-, Malware- und Phishing-Blocker – dieselben Listen und Regeln wie in Version 3.
// Listen kommen mit (HaGeZi, URLhaus, Phishing-Filter); Malware/Phishing zusätzlich täglich frisch von den Quellen.
'use strict';
const Blocker = (() => {
  const { inSet, siteOf, parseList, cleanDomain } = ImmoLists;
  const sets = { werbung: new Set(), malware: new Set(), phishing: new Set() };
  let sources = {};
  const sessionAllow = new Set();       // „Trotzdem öffnen“ – bis zum Beenden
  const perTab = new Map();             // Tab → Anzahl Blockierungen (Abzeichen am Knopf)

  // Tracking-Zusätze in Links (Kampagnen-/Klick-IDs) – werden vor dem Laden entfernt
  // Arbeitsseiten (Feray 02.11.2026: eBay-Knöpfe gingen nicht): Verkaufen/Einkaufen muss immer vollständig funktionieren.
  const WORK_SITES = ['ebay.de', 'ebay.com', 'amazon.de', 'paypal.com', 'immoadv.de'];
  const TRACK_PARAMS = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|igsh|yclid|ttclid|twclid|li_fat_id|_hsenc|_hsmi|__hssc|__hstc|__hsfp|hsctatracking|oly_enc_id|oly_anon_id|vero_id|vero_conv|rb_clickid|s_cid|mkt_tok|_openstat|wickedid|epik|srsltid|sc_cid|trk|trkCampaign|ga_[a-z_]+)$/i;
  function cleanURL(url) {
    try {
      const u = new URL(url);
      if (!u.search || (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith('/o/oauth'))) return url;
      let changed = false;
      for (const k of [...u.searchParams.keys()]) if (TRACK_PARAMS.test(k)) { u.searchParams.delete(k); changed = true; }
      return changed ? u.toString() : url;
    } catch (e) { return url; }
  }

  async function readList(name) {
    try { const r = await fetch(browser.runtime.getURL(`lists/${name}.json`)); return r.ok ? r.json() : null; } catch (e) { return null; }
  }
  async function load() {
    sources = (await readList('sources')) || {};
    const fresh = (await browser.storage.local.get('freshLists')).freshLists || {};
    await Promise.all(Object.keys(sets).map(async (kind) => {
      const list = (kind !== 'werbung' && Settings.get('freshLists') !== false && fresh[kind]) || (await readList(kind)) || [];
      sets[kind] = new Set(list);
    }));
  }
  // Täglich: Malware-/Phishing-Listen direkt von den Quellen (nur diese Adressen, keine Nutzerdaten)
  async function refresh(force = false) {
    if (Settings.get('freshLists') === false) return;
    const st = await browser.storage.local.get(['freshAt', 'freshLists', 'listsInfo']);
    if (!force && st.freshAt && Date.now() - st.freshAt < 20 * 3600 * 1000) return;
    const fresh = st.freshLists || {}, info = st.listsInfo || {};
    for (const kind of ['malware', 'phishing']) {
      for (const u of (sources[kind] && sources[kind].urls) || []) {
        try {
          const r = await fetch(u, { cache: 'no-store', credentials: 'omit' });
          if (!r.ok) continue;
          const list = parseList(await r.text());
          if (list.length < 200) continue;
          fresh[kind] = list; sets[kind] = new Set(list);
          info[kind] = { count: list.length, date: new Date().toISOString() };
          break;
        } catch (e) { /* nächste Quelle */ }
      }
    }
    await browser.storage.local.set({ freshLists: fresh, freshAt: Date.now(), listsInfo: info });
  }

  function badge(tabId) {
    if (tabId < 0) return;
    const n = perTab.get(tabId) || 0;
    browser.browserAction.setBadgeText({ tabId, text: n ? (n > 99 ? '99+' : String(n)) : '' }).catch(() => {});
  }

  /** null = erlaubt, sonst { kind } */
  function check(details) {
    let host;
    try { host = new URL(details.url).hostname; } catch (e) { return null; }
    const pageUrl = details.type === 'main_frame' ? details.url : (details.documentUrl || details.originUrl || '');
    let page = ''; try { page = new URL(pageUrl).hostname; } catch (e) {}
    if (/^moz-extension:/.test(pageUrl)) return null;
    const pageSite = siteOf(page || host);
    // Oberste Seite des Tabs (bei eingebetteten Fenstern, z. B. eBay „Nachricht an den Käufer“) – Ausnahmen gelten für den ganzen Tab.
    const anc = details.frameAncestors && details.frameAncestors.length ? details.frameAncestors[details.frameAncestors.length - 1].url : '';
    let topSite = pageSite; try { if (anc) topSite = siteOf(new URL(anc).hostname); } catch (e) {}
    const allow = (Settings.get('allowlist') || []).concat(WORK_SITES);
    if (allow.some((d) => pageSite === d || pageSite.endsWith('.' + d) || topSite === d || topSite.endsWith('.' + d))) return null;
    // eBay-eigene Hilfsdomains (Bilder, Skripte, Sicherheitsprüfung) nie blockieren – sonst hängen Knöpfe und Fenster.
    if (/(^|\.)(ebay\.[a-z.]+|ebaystatic\.com|ebayimg\.com|ebaydesc\.com|ebay-us\.com|ebayrtm\.com|paypal\.com|paypalobjects\.com)$/.test(host)) return null;
    const site = siteOf(host);
    if (sessionAllow.has(site)) return null;
    const own = Settings.get('blocklist') || [];
    if (own.some((d) => host === d || host.endsWith('.' + d))) return { kind: 'eigene' };
    if (Settings.get('blockPhishing') !== false && inSet(sets.phishing, host)) return { kind: 'phishing' };
    if (Settings.get('blockMalware') !== false && inSet(sets.malware, host)) return { kind: 'malware' };
    if (Settings.get('blockAds') !== false && details.type !== 'main_frame' && site !== pageSite && inSet(sets.werbung, host)) return { kind: 'werbung' };
    return null;
  }

  function onBefore(details) {
    if (!/^https?:/.test(details.url)) return {};
    const hit = check(details);
    if (hit) {
      Settings.count(hit.kind);
      perTab.set(details.tabId, (perTab.get(details.tabId) || 0) + 1); badge(details.tabId);
      if (details.type === 'main_frame') {
        return { redirectUrl: browser.runtime.getURL(`pages/blocked.html?k=${hit.kind}&u=${encodeURIComponent(details.url)}`) };
      }
      return { cancel: true };
    }
    if (details.type === 'main_frame' && Settings.get('cleanLinks') !== false) {
      const clean = cleanURL(details.url);
      if (clean !== details.url) return { redirectUrl: clean };
    }
    return {};
  }

  function init() {
    browser.webRequest.onBeforeRequest.addListener(onBefore, { urls: ['http://*/*', 'https://*/*'] }, ['blocking']);
    browser.webNavigation.onCommitted.addListener((d) => { if (d.frameId === 0) { perTab.set(d.tabId, 0); badge(d.tabId); } });
    browser.tabs.onRemoved.addListener((id) => perTab.delete(id));
    browser.browserAction.setBadgeBackgroundColor({ color: '#2A5BD7' }).catch(() => {});
    browser.browserAction.setBadgeTextColor && browser.browserAction.setBadgeTextColor({ color: '#ffffff' }).catch(() => {});
  }

  return {
    load, refresh, init, cleanURL,
    allowOnce(url) { const d = cleanDomain(url); if (d) sessionAllow.add(siteOf(d)); },
    blockedOn: (tabId) => perTab.get(tabId) || 0,
    info: () => ({ sources, counts: { werbung: sets.werbung.size, malware: sets.malware.size, phishing: sets.phishing.size } })
  };
})();
