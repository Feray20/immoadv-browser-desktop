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
  // Ausfüllen (05.11.2026, Feray: „hat nicht einmal geklappt, stand nur ‚wird übernommen‘“): höchstens 20 s warten und
  // bei getrennter Verbindung zum Programm einmal neu versuchen – statt bis zu 130 s still zu hängen.
  async function fill(id, url) {
    try { return await Native.call('vault.fill', { id, url }, 20000); }
    catch (e) { await new Promise((r) => setTimeout(r, 1200)); return Native.call('vault.fill', { id, url }, 20000); }
  }
  async function offer(tabId, d) {
    if (!/^https:/.test(d.url) || !d.pass) return;
    let mode = 'new';
    try { mode = await Native.call('vault.status', { url: d.url, user: d.user, pass: d.pass }); } catch (e) { try { if (await Native.call('vault.known', { url: d.url, user: d.user, pass: d.pass })) return; } catch (e2) { return; } }
    if (mode === 'same') return;
    d = { ...d, mode };
    try { if (await Native.call('vault.never', { url: d.url })) return; } catch (e) {}
    pending.set(tabId, { ...d, at: Date.now() });
    // Sofort an die Seite melden (05.11.2026): Bei Anmeldungen ohne neuen Seitenaufbau (z. B. eBay, Google, viele Apps)
    // fragte bisher niemand nach „Passwort speichern?“ – die Frage kam nur, wenn eine neue Seite lud.
    try { const t = await browser.tabs.get(tabId); const x = takePending(tabId, t.url || ''); if (x) browser.tabs.sendMessage(tabId, { type: 'pw:offer', p: x }).catch(() => null); } catch (e) { /* Tab weg */ }
    setTimeout(() => { const p = pending.get(tabId); if (p && Date.now() - p.at > 110000) pending.delete(tabId); }, 120000);
  }
  function takePending(tabId, url) {
    const p = pending.get(tabId);
    if (!p) return null;
    let a = '', b = ''; try { a = ImmoLists.siteOf(new URL(p.url).hostname); b = ImmoLists.siteOf(new URL(url).hostname); } catch (e) {}
    if (a !== b) return null;
    return { user: p.user, site: a, mode: p.mode || 'new' };
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
