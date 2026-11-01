// Werbe-, Tracker-, Malware- und Phishing-Blocker – eine zentrale Stelle für alle Tabs.
// Listen kommen beim Build mit (HaGeZi, URLhaus, Phishing-Filter); Malware/Phishing zusätzlich täglich frisch.
const { app, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const { parseList, inSet, cleanDomain, siteOf } = require('../shared/lists');

const sets = { werbung: new Set(), malware: new Set(), phishing: new Set() };
let sources = {};
const lastBlock = new Map();     // webContents-ID → { kind, url } für die Warnseite
const sessionAllow = new Set();  // „Trotzdem öffnen“ – nur bis zum Beenden
let pending = null;

const bundled = () => (app.isPackaged ? path.join(process.resourcesPath, 'lists') : path.join(__dirname, '..', '..', 'vendor', 'lists'));
const cacheDir = () => path.join(app.getPath('userData'), 'listen');

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

function load() {
  sources = readJson(path.join(bundled(), 'sources.json')) || {};
  for (const kind of Object.keys(sets)) {
    // frische Tagesliste (falls vorhanden) hat Vorrang vor der mitgelieferten
    const fresh = kind !== 'werbung' && store.get('freshLists') !== false ? readJson(path.join(cacheDir(), `${kind}.json`)) : null;
    sets[kind] = new Set(fresh || readJson(path.join(bundled(), `${kind}.json`)) || []);
  }
}

// Täglich: Malware-/Phishing-Listen direkt von den Quellen laden (nur diese beiden Adressen, keine Nutzerdaten)
async function refresh(force = false) {
  if (store.get('freshLists') === false) return;
  const info = store.get('listsInfo') || {};
  if (!force && info.freshAt && Date.now() - info.freshAt < 20 * 3600 * 1000) return;
  fs.mkdirSync(cacheDir(), { recursive: true });
  for (const kind of ['malware', 'phishing']) {
    const urls = (sources[kind] && sources[kind].urls) || [];
    for (const u of urls) {
      try {
        const r = await session.fromPartition('immoadv-system', { cache: false }).fetch(u, { cache: 'no-store', credentials: 'omit' });
        if (!r.ok) continue;
        const list = parseList(await r.text());
        if (list.length < 200) continue;
        fs.writeFileSync(path.join(cacheDir(), `${kind}.json`), JSON.stringify(list));
        sets[kind] = new Set(list);
        info[kind] = { count: list.length, date: new Date().toISOString() };
        break;
      } catch { /* nächste Quelle */ }
    }
  }
  info.freshAt = Date.now();
  store.set('listsInfo', info);
}

function count(kind) {
  pending = pending || {};
  pending[kind] = (pending[kind] || 0) + 1;
  if (pending.timer) return;
  pending.timer = setTimeout(() => {
    const add = pending; pending = null;
    const s = { ...store.get('stats') };
    for (const k of ['werbung', 'malware', 'phishing', 'eigene']) s[k] = (s[k] || 0) + (add[k] || 0);
    if (!s.since) s.since = new Date().toISOString();
    store.set('stats', s);
  }, 2000);
}

/**
 * Prüft eine Anfrage. Ergebnis: null (erlaubt) oder { kind } (blockieren).
 * Werbung/Tracker nur bei fremden Seiten (Seitenaufrufe selbst bleiben bedienbar), Malware/Phishing/eigene Sperrliste immer.
 */
function check(details, pageUrl) {
  let host;
  try { host = new URL(details.url).hostname; } catch { return null; }
  const page = (() => { try { return new URL(pageUrl || details.referrer || '').hostname; } catch { return ''; } })();
  const pageSite = siteOf(page || host);
  const allow = store.get('allowlist') || [];
  if (allow.some((d) => pageSite === d || pageSite.endsWith('.' + d))) return null;
  const site = siteOf(host);
  if (sessionAllow.has(site)) return null;
  const own = store.get('blocklist') || [];
  if (own.some((d) => host === d || host.endsWith('.' + d))) return { kind: 'eigene' };
  if (store.get('blockPhishing') !== false && inSet(sets.phishing, host)) return { kind: 'phishing' };
  if (store.get('blockMalware') !== false && inSet(sets.malware, host)) return { kind: 'malware' };
  if (store.get('blockAds') !== false && details.resourceType !== 'mainFrame' && site !== pageSite && inSet(sets.werbung, host)) return { kind: 'werbung' };
  return null;
}

function record(wcId, kind, url, isMain) {
  count(kind);
  if (isMain) lastBlock.set(wcId, { kind, url });
}

module.exports = {
  load, refresh, check, record,
  takeBlock: (wcId) => { const b = lastBlock.get(wcId); lastBlock.delete(wcId); return b || null; },
  allowOnce: (url) => { const d = cleanDomain(url); if (d) sessionAllow.add(siteOf(d)); },
  info: () => ({
    sources, fresh: store.get('listsInfo') || {},
    counts: { werbung: sets.werbung.size, malware: sets.malware.size, phishing: sets.phishing.size }
  })
};
