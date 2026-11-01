// Spurlos-Modus im normalen Fenster:
// • Verlauf wird nicht gespeichert (sofort wieder entfernt – auch aus dem Google-Konto)
// • Cookies & Website-Daten einer Seite werden gelöscht, sobald ihr letzter Tab geschlossen ist
// • Beim Start: alles Übrige aufräumen (außer „angemeldet bleiben“), Cache leeren, Download-Liste leeren (Dateien bleiben)
import { getSettings } from './settings.js';

// Häufige zweistufige Endungen, damit z. B. „bbc.co.uk“ als eine Seite zählt
const SECOND = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.tr', 'org.tr', 'gen.tr', 'com.au', 'co.at', 'or.at', 'co.jp', 'com.br', 'co.nz', 'co.za', 'com.cn', 'com.mx']);
export function siteOf(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return h;
  const p = h.split('.');
  if (p.length <= 2) return h;
  const last2 = p.slice(-2).join('.');
  return SECOND.has(last2) ? p.slice(-3).join('.') : last2;
}
const kept = (site, keep) => keep.some((k) => site === k || site.endsWith('.' + k));
const DATA = { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true, fileSystems: true, webSQL: true };

const tabSite = new Map();       // tabId → Seite
const pending = new Map();       // Seite → Timer

async function openSites() {
  const tabs = await chrome.tabs.query({});
  return new Set(tabs.filter((t) => /^https?:/.test(t.url || t.pendingUrl || '')).map((t) => siteOf(new URL(t.url || t.pendingUrl).hostname)));
}

function schedule(site) {
  if (!site) return;
  clearTimeout(pending.get(site));
  // kurze Wartezeit: Weiterleitungen und schnelles Neu-Öffnen sollen nichts löschen
  pending.set(site, setTimeout(async () => {
    pending.delete(site);
    const s = await getSettings();
    if (!s.traceless.enabled || kept(site, s.traceless.keep)) return;
    if ((await openSites()).has(site)) return;
    const origins = [`https://${site}`, `http://${site}`, `https://www.${site}`, `http://www.${site}`];
    try { await chrome.browsingData.remove({ origins }, DATA); } catch (e) { console.warn('Spurlos: Löschen fehlgeschlagen', e); }
  }, 8000));
}

chrome.tabs.onUpdated.addListener((id, info, tab) => {
  const url = info.url || tab.url;
  if (!url || !/^https?:/.test(url)) return;
  const site = siteOf(new URL(url).hostname);
  const before = tabSite.get(id);
  tabSite.set(id, site);
  if (before && before !== site) schedule(before);          // Seite im selben Tab verlassen
});
chrome.tabs.onRemoved.addListener((id) => { schedule(tabSite.get(id)); tabSite.delete(id); });

// Verlauf: jeden Besuch sofort wieder entfernen
chrome.history.onVisited.addListener(async (item) => {
  const s = await getSettings();
  if (s.traceless.enabled && s.traceless.history) chrome.history.deleteUrl({ url: item.url });
});

/** Beim Start von Chrome: Reste aus der letzten Sitzung entfernen */
export async function startupCleanup() {
  const s = await getSettings();
  if (!s.traceless.enabled) return;
  const excludeOrigins = s.traceless.keep.flatMap((d) => [`https://${d}`, `https://www.${d}`]);
  try { await chrome.browsingData.remove({ excludeOrigins }, DATA); } catch {}
  try { await chrome.browsingData.remove({}, { cache: true, downloads: true, formData: false, ...(s.traceless.history ? { history: true } : {}) }); } catch {}
}

/** Bestehende Tabs nach Neustart des Hintergrunds wieder kennen */
export async function primeTabs() {
  for (const t of await chrome.tabs.query({})) if (/^https?:/.test(t.url || '')) tabSite.set(t.id, siteOf(new URL(t.url).hostname));
}
