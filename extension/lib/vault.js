// Passwort-Tresor (wie Version 3): Passwörter liegen einzeln verschlüsselt im ImmoAdv-Programm,
// Ausfüllen nur nach Windows Hello / Touch ID und nur auf der richtigen Seite.
'use strict';
const Vault = (() => {
  let siteList = [];
  const pending = new Map();      // Tab → { url, user, pass, at } – „Passwort speichern?“ nach dem Absenden
  async function refreshSites() {
    try { siteList = [...new Set((await Native.call('vault.list')).map((p) => p.site))]; } catch (e) { /* später */ }
  }
  async function forUrl(url) { try { return await Native.call('vault.forUrl', { url }); } catch (e) { return []; } }
  async function fill(id, url) { return Native.call('vault.fill', { id, url }, 130000); }
  async function offer(tabId, d) {
    if (!/^https:/.test(d.url) || !d.pass) return;
    try { if (await Native.call('vault.known', { url: d.url, user: d.user, pass: d.pass })) return; } catch (e) { return; }
    try { if (await Native.call('vault.never', { url: d.url })) return; } catch (e) {}
    pending.set(tabId, { ...d, at: Date.now() });
    setTimeout(() => { const p = pending.get(tabId); if (p && Date.now() - p.at > 110000) pending.delete(tabId); }, 120000);
  }
  function takePending(tabId, url) {
    const p = pending.get(tabId);
    if (!p) return null;
    let a = '', b = ''; try { a = ImmoLists.siteOf(new URL(p.url).hostname); b = ImmoLists.siteOf(new URL(url).hostname); } catch (e) {}
    if (a !== b) return null;
    return { user: p.user, site: a };
  }
  async function decide(tabId, choice) {
    const p = pending.get(tabId); pending.delete(tabId);
    if (!p) return false;
    if (choice === 'save') { await Native.call('vault.save', { url: p.url, user: p.user, pass: p.pass }); refreshSites(); return true; }
    if (choice === 'never') await Native.call('vault.neverAdd', { url: p.url });
    return true;
  }
  return { refreshSites, forUrl, fill, offer, takePending, decide, sites: () => siteList };
})();
