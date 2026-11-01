// ImmoAdv-Schicht für Chrome – Hintergrund (Service Worker).
// Zuständig für: Schutzregeln, Datenschutz-Grundeinstellungen, Zähler, Warnseite,
// tägliche Aktualisierung der Malware-/Phishing-Listen, Selbst-Update, Lesezeichen-Übernahme.
import { getSettings, setSettings, SYNC_DEFAULTS } from './lib/settings.js';
import { parseList, buildRules, IDS, cleanDomain, BLOCKED_PAGE, NEVER } from './lib/rules.js';
import { connect, disconnect } from './lib/vpn.js';
import { startupCleanup, primeTabs } from './lib/traceless.js';
import { saveSecret, deleteSecret } from './lib/vault.js';

const dnr = chrome.declarativeNetRequest;
const STATIC = ['werbung', 'malware', 'phishing'];

// Quellen der täglich aktualisierten Listen (Herkunft wird im Datenschutz-Center angezeigt)
const FRESH_SOURCES = {
  malware: { name: 'URLhaus (abuse.ch) über malware-filter', urls: ['https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains.txt', 'https://curbengh.github.io/urlhaus-filter/urlhaus-filter-domains.txt'] },
  phishing: { name: 'Phishing-Filter (OpenPhish, PhishTank, PhishStats) über malware-filter', urls: ['https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt', 'https://curbengh.github.io/phishing-filter/phishing-filter-domains.txt'] }
};

// ---------------- Datenschutz-Grundeinstellungen ----------------
async function setPref(pref, value, enforce) {
  try {
    if (!pref) return;
    if (enforce) await pref.set({ value });
    else await pref.clear({});          // Schalter aus → Chrome-Standard bzw. eigene Chrome-Einstellung gilt wieder
  } catch (e) { console.warn('Einstellung nicht möglich', e); }
}

export async function applyPrivacy(p) {
  const net = chrome.privacy.network, web = chrome.privacy.websites, svc = chrome.privacy.services;
  const { vpn } = await getSettings();
  if (!vpn.enabled) await setPref(net.webRTCIPHandlingPolicy, 'default_public_interface_only', p.webrtc);   // mit VPN setzt vpn.js die strengere Regel
  await setPref(web.thirdPartyCookiesAllowed, false, p.thirdPartyCookies);
  await setPref(web.hyperlinkAuditingEnabled, false, p.linkAuditing);
  await setPref(net.networkPredictionEnabled, false, p.prediction);
  await setPref(web.topicsEnabled, false, p.privacySandbox);
  await setPref(web.fledgeEnabled, false, p.privacySandbox);
  await setPref(web.adMeasurementEnabled, false, p.privacySandbox);
  await setPref(svc.safeBrowsingEnabled, true, p.safeBrowsing);
}

// ---------------- Schutzregeln ----------------
async function freshActive() {
  const { freshMap } = await chrome.storage.local.get('freshMap');
  return freshMap || {};
}

export async function applyRules(s) {
  const fresh = await freshActive();
  // Statische Listen: an/aus je Kategorie; Malware/Phishing statisch aus, wenn eine frischere Tagesliste aktiv ist
  const enable = [], disable = [];
  for (const id of STATIC) {
    const on = s.protection[id] && !(fresh[id] && s.freshLists);
    (on ? enable : disable).push(id);
  }
  await dnr.updateEnabledRulesets({ enableRulesetIds: enable, disableRulesetIds: disable });

  // Dynamische Regeln: Ausnahmen + eigene Sperrliste (die Tageslisten bleiben unangetastet)
  const existing = await dnr.getDynamicRules();
  const removeRuleIds = existing.filter((r) => r.id < IDS.fresh).map((r) => r.id);
  const addRules = [];
  s.allowlist.forEach((d, i) => addRules.push({
    id: IDS.allow + i, priority: 100, action: { type: 'allowAllRequests' },
    condition: { requestDomains: [d], resourceTypes: ['main_frame', 'sub_frame'] }
  }));
  if (s.blocklist.length) {
    addRules.push({ id: IDS.block, priority: 50, action: { type: 'redirect', redirect: { extensionPath: `${BLOCKED_PAGE}#eigene` } }, condition: { requestDomains: s.blocklist, resourceTypes: ['main_frame', 'sub_frame'] } });
    addRules.push({ id: IDS.block + 1, priority: 50, action: { type: 'block' }, condition: { requestDomains: s.blocklist, excludedResourceTypes: ['main_frame', 'sub_frame'] } });
  }
  await dnr.updateDynamicRules({ removeRuleIds, addRules });

  // Tageslisten bei ausgeschalteter Kategorie entfernen bzw. bei Bedarf wieder aufbauen
  for (const kind of ['malware', 'phishing']) {
    const range = fresh[kind];
    if (range && (!s.protection[kind] || !s.freshLists)) {
      const ids = []; for (let i = range[0]; i <= range[1]; i++) ids.push(i);
      await dnr.updateDynamicRules({ removeRuleIds: ids });
      delete fresh[kind];
      await chrome.storage.local.set({ freshMap: fresh });
    }
  }
}

async function fetchFirst(urls) {
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (r.ok) return await r.text();
    } catch { /* nächste Quelle */ }
  }
  return null;
}

// Malware- und Phishing-Listen ändern sich stündlich – deshalb einmal täglich frisch laden
async function refreshFreshLists(force = false) {
  const s = await getSettings();
  if (!s.freshLists) return;
  const { freshAt } = await chrome.storage.local.get('freshAt');
  if (!force && freshAt && Date.now() - freshAt < 20 * 60 * 60 * 1000) return;
  const fresh = await freshActive();
  const info = { ...(s.listsInfo || {}) };
  let nextId = IDS.fresh;
  const all = [];
  const map = {};
  for (const kind of ['malware', 'phishing']) {
    if (!s.protection[kind]) continue;
    const text = await fetchFirst(FRESH_SOURCES[kind].urls);
    const domains = text ? parseList(text, NEVER) : [];
    if (domains.length < 200) continue;          // offensichtlich kaputt/leer → statische Liste bleibt aktiv
    const rules = buildRules(domains, kind, nextId);
    map[kind] = [nextId, nextId + rules.length - 1];
    nextId += rules.length;
    all.push(...rules);
    info[kind] = { name: FRESH_SOURCES[kind].name, count: domains.length, date: new Date().toISOString(), live: true };
  }
  if (!all.length) return;
  const max = dnr.MAX_NUMBER_OF_DYNAMIC_RULES || 30000;
  if (all.length > max - 1000) return;
  const old = (await dnr.getDynamicRules()).filter((r) => r.id >= IDS.fresh).map((r) => r.id);
  await dnr.updateDynamicRules({ removeRuleIds: old, addRules: all });
  // Kategorien ohne neue Liste behalten ihre statische Liste
  for (const kind of ['malware', 'phishing']) if (!map[kind]) delete fresh[kind];
  await chrome.storage.local.set({ freshMap: map, freshAt: Date.now(), listsInfo: info });
  await applyRules(await getSettings());
}

// ---------------- Zähler (echte Treffer, keine Schätzungen) ----------------
let pending = null;
const kindOf = async (info) => {
  const rs = info.rule.rulesetId;
  if (STATIC.includes(rs)) return rs;
  const id = info.rule.ruleId;
  if (id >= IDS.block && id < IDS.fresh) return 'eigene';
  if (id >= IDS.fresh) {
    const fresh = await freshActive();
    for (const [k, [a, b]] of Object.entries(fresh)) if (id >= a && id <= b) return k;
  }
  return null;
};
if (dnr.onRuleMatchedDebug) {
  dnr.onRuleMatchedDebug.addListener(async (info) => {
    const k = await kindOf(info);
    if (!k) return;
    pending = pending || {};
    pending[k] = (pending[k] || 0) + 1;
    clearTimeout(globalThis.__flush);
    globalThis.__flush = setTimeout(flushStats, 1500);
  });
}
async function flushStats() {
  if (!pending) return;
  const add = pending; pending = null;
  const { stats } = await getSettings();
  for (const [k, v] of Object.entries(add)) stats[k] = (stats[k] || 0) + v;
  if (!stats.since) stats.since = new Date().toISOString();
  await setSettings({ stats });
}

// ---------------- Warnseite ----------------
// Merkt sich je Tab die zuletzt angesteuerte Adresse, damit die Warnseite sie anzeigen kann
chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId !== 0 || !/^https?:/.test(d.url)) return;
  chrome.storage.session.set({ ['nav' + d.tabId]: d.url });
});
chrome.tabs.onRemoved.addListener((id) => chrome.storage.session.remove('nav' + id));

let sessionRuleId = 20000;
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'blocked-info') {
      const key = 'nav' + (sender.tab && sender.tab.id);
      return reply({ url: (await chrome.storage.session.get(key))[key] || null });
    }
    if (msg.type === 'allow-once') {
      const d = cleanDomain(msg.url);
      if (!d) return reply({ ok: false });
      await dnr.updateSessionRules({ addRules: [{ id: sessionRuleId++, priority: 1000, action: { type: 'allowAllRequests' }, condition: { requestDomains: [d], resourceTypes: ['main_frame', 'sub_frame'] } },
        { id: sessionRuleId++, priority: 1000, action: { type: 'allow' }, condition: { requestDomains: [d] } }] });
      return reply({ ok: true });
    }
    if (msg.type === 'apply') {
      const s = await getSettings();
      await applyPrivacy(s.privacy); await applyRules(s);
      if (msg.refresh) await refreshFreshLists(true);
      return reply({ ok: true });
    }
    if (msg.type === 'flush') { await flushStats(); return reply({ ok: true }); }
    if (msg.type === 'vpn-save') {
      const user = String(msg.user || '').trim(), pass = String(msg.pass || '');
      if (!user || !pass) return reply({ ok: false });
      await saveSecret('nordvpn', { user, pass });
      const s = await getSettings();
      if (s.vpn.enabled) await connect();
      return reply({ ok: true });
    }
    if (msg.type === 'vpn-forget') { await deleteSecret('nordvpn'); const s = await getSettings(); if (s.vpn.enabled) await connect(); return reply({ ok: true }); }
    if (msg.type === 'vpn-reconnect') { await connect(); return reply({ ok: true }); }
    reply({});
  })();
  return true;
});

// ---------------- Selbst-Update der ImmoAdv-Schicht ----------------
// Das ImmoAdv-Programm legt neue Versionen in diesen Ordner; hier wird sie ohne Neustart übernommen.
const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};
async function selfUpdate() {
  try {
    const r = await fetch(chrome.runtime.getURL('version.json'), { cache: 'no-store' });
    const { version } = await r.json();
    if (version && newer(version, chrome.runtime.getManifest().version)) {
      await flushStats();
      chrome.runtime.reload();
    }
  } catch { /* Datei fehlt im Entwicklungsmodus */ }
}

// ---------------- Lesezeichen aus dem alten ImmoAdv Browser ----------------
async function importBookmarks() {
  try {
    const r = await fetch(chrome.runtime.getURL('import.json'), { cache: 'no-store' });
    if (!r.ok) return;
    const data = await r.json();
    const { importedIds } = await getSettings();
    if (!data.id || importedIds.includes(data.id) || !Array.isArray(data.bookmarks) || !data.bookmarks.length) return;
    const folder = await chrome.bookmarks.create({ parentId: '1', title: data.title || 'Aus altem ImmoAdv Browser' });
    for (const b of data.bookmarks) {
      if (b && /^https?:\/\//.test(b.url)) await chrome.bookmarks.create({ parentId: folder.id, title: String(b.title || b.url).slice(0, 200), url: b.url });
    }
    await setSettings({ importedIds: [...importedIds, data.id] });
  } catch { /* keine Übernahme vorhanden */ }
}

// ---------------- Kontextmenü ----------------
function menus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'translate', title: 'Markierten Text übersetzen (Google Übersetzer)', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'center', title: 'ImmoAdv Datenschutz-Center', contexts: ['action'] });
  });
}
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'translate') {
    const { translateTarget } = await getSettings();
    const text = encodeURIComponent(String(info.selectionText || '').slice(0, 5000));
    chrome.tabs.create({ url: `https://translate.google.com/?sl=auto&tl=${translateTarget}&text=${text}&op=translate`, index: tab ? tab.index + 1 : undefined });
  }
  if (info.menuItemId === 'center') chrome.tabs.create({ url: chrome.runtime.getURL('panel.html?full=1') });
});

// VPN still überwachen: nicht verbunden, aber angemeldet → neu verbinden
async function checkVpn() {
  const s = await getSettings();
  if (s.vpn.enabled && s.vpnState.status !== 'on' && s.vpnState.status !== 'nocreds' && navigator.onLine) connect();
}

// ---------------- Start ----------------
async function boot(reason) {
  const s = await getSettings();
  // Erstinstallation: nur den Zähler starten – Einstellungen kommen ggf. schon per Sync von einem anderen Gerät
  if (reason === 'install' && !s.stats.since) await setSettings({ stats: { ...s.stats, since: new Date().toISOString() } });
  await applyPrivacy(s.privacy);
  await applyRules(s);
  await (s.vpn.enabled ? connect() : disconnect());
  try { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch {}
  try { await dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: true }); } catch {}
  chrome.action.setBadgeBackgroundColor({ color: '#0E5C66' });
  menus();
  chrome.alarms.create('selfupdate', { periodInMinutes: 10 });
  chrome.alarms.create('lists', { periodInMinutes: 60 });
  chrome.alarms.create('vpn', { periodInMinutes: 1 });
  await importBookmarks();
  refreshFreshLists();
}
chrome.runtime.onInstalled.addListener((d) => boot(d.reason));
chrome.runtime.onStartup.addListener(async () => { await startupCleanup(); await boot('startup'); selfUpdate(); });
primeTabs();
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'selfupdate') { selfUpdate(); importBookmarks(); }
  if (a.name === 'lists') refreshFreshLists();
  if (a.name === 'vpn') checkVpn();
});

// Einstellungen von einem anderen Gerät (Chrome-Sync) oder aus dem Datenschutz-Center → sofort anwenden
let applyTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (!Object.keys(changes).some((k) => k in SYNC_DEFAULTS)) return;
  clearTimeout(applyTimer);
  applyTimer = setTimeout(async () => {
    const s = await getSettings();
    await applyPrivacy(s.privacy); await applyRules(s);
    if (changes.vpn) await (s.vpn.enabled ? connect() : disconnect());
  }, 300);
});
