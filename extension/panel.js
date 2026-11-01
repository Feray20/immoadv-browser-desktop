// ImmoAdv Datenschutz-Center – alle Anzeigen beruhen auf echten Werten aus Chrome bzw. dem ImmoAdv-Programm.
import { getSettings, setSettings, launcherInfo, fmt } from './lib/settings.js';
import { cleanDomain } from './lib/rules.js';
import { hasSecret } from './lib/vault.js';

const $ = (id) => document.getElementById(id);
if (new URLSearchParams(location.search).has('full')) document.body.classList.add('full');
const send = (msg) => chrome.runtime.sendMessage(msg);
const dot = (el, cls) => { el.className = 'dot ' + (cls || ''); };
const date = (iso) => iso ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '–';

let S = null;
let tab = null;

// ---------- Kennzahlen ----------
async function renderStats() {
  S = await getSettings();
  $('kWerbung').textContent = fmt(S.stats.werbung);
  $('kMalware').textContent = fmt(S.stats.malware);
  $('kPhishing').textContent = fmt(S.stats.phishing + S.stats.eigene);
  $('since').textContent = S.stats.since ? `Blockierte Anfragen auf diesem Gerät seit ${date(S.stats.since)}` : '';
  const on = Object.values(S.protection).filter(Boolean).length;
  $('heroStatus').textContent = on === 3 ? 'Alle Schutzfunktionen aktiv' : on ? `${on} von 3 Schutzfunktionen aktiv` : 'Schutz ausgeschaltet';
}

// ---------- Diese Seite ----------
const PERMS = [
  ['notifications', 'Benachrichtigungen'], ['location', 'Standort'], ['camera', 'Kamera'], ['microphone', 'Mikrofon'],
  ['popups', 'Pop-ups'], ['automaticDownloads', 'Mehrere Downloads'], ['clipboard', 'Zwischenablage']
];
const VAL = { allow: 'Erlauben', ask: 'Fragen', block: 'Blockieren' };
const options = (cs) => (cs === 'popups' || cs === 'automaticDownloads' ? ['allow', 'block'] : ['allow', 'ask', 'block']).filter((v) => !(cs === 'popups' && v === 'ask'));

async function permRow(cs, label, url, pattern) {
  const api = chrome.contentSettings[cs];
  if (!api) return null;
  let current;
  try { current = (await api.get({ primaryUrl: url })).setting; } catch { return null; }
  const row = document.createElement('div'); row.className = 'perm';
  const sel = document.createElement('select');
  for (const v of options(cs)) { const o = document.createElement('option'); o.value = v; o.textContent = VAL[v]; sel.append(o); }
  if (!options(cs).includes(current)) { const o = document.createElement('option'); o.value = current; o.textContent = current; sel.append(o); }
  sel.value = current;
  sel.addEventListener('change', async () => {
    try { await api.set({ primaryPattern: pattern, setting: sel.value }); } catch (e) { alert('Konnte nicht gespeichert werden: ' + e.message); }
  });
  const l = document.createElement('span'); l.textContent = label;
  row.append(l, sel);
  return row;
}

async function renderSite() {
  [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const ok = tab && /^https?:/.test(tab.url || '');
  $('secSite').classList.toggle('hidden', !ok);
  if (!ok) return;
  const host = new URL(tab.url).hostname;
  const domain = cleanDomain(host);
  $('siteName').textContent = host.replace(/^www\./, '');
  $('siteProtect').checked = !S.allowlist.includes(domain);
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
    const n = rulesMatchedInfo.filter((r) => r.rule.rulesetId !== '_session' && !(r.rule.rulesetId === '_dynamic' && r.rule.ruleId < 5001)).length;
    $('siteBlocked').textContent = `${fmt(n)} Anfragen auf dieser Seite blockiert`;
  } catch { $('siteBlocked').textContent = ''; }
  const box = $('sitePerms'); box.textContent = '';
  const origin = new URL(tab.url).origin;
  for (const [cs, label] of PERMS) { const r = await permRow(cs, label, tab.url, `${origin}/*`); if (r) box.append(r); }
}
$('siteProtect').addEventListener('change', async (e) => {
  const d = cleanDomain(new URL(tab.url).hostname);
  const list = S.allowlist.filter((x) => x !== d);
  if (!e.target.checked) list.push(d);
  await setSettings({ allowlist: list });
  await send({ type: 'apply' });
  chrome.tabs.reload(tab.id);
  renderLists();
});

async function renderDefaultPerms() {
  const box = $('defaultPerms'); box.textContent = '';
  for (const [cs, label] of PERMS) { const r = await permRow(cs, label, 'https://example.org/', '<all_urls>'); if (r) box.append(r); }
}

// ---------- Verbindung ----------
async function renderConnection() {
  const L = await launcherInfo();
  if (!L) {
    dot($('dnsDot'), 'warn'); $('dnsText').textContent = 'Unbekannt – ImmoAdv-Programm nicht verbunden';
    dot($('vpnDot'), 'warn'); $('vpnText').textContent = 'Unbekannt – ImmoAdv-Programm nicht verbunden';
  } else {
    const d = L.dns || {};
    dot($('dnsDot'), d.mode === 'secure' ? 'ok' : d.mode === 'automatic' ? 'warn' : 'bad');
    $('dnsText').textContent = d.mode === 'secure' ? `Verschlüsselt (DNS-over-HTTPS) über ${d.provider}, ohne unverschlüsselten Rückfall`
      : d.mode === 'automatic' ? `Automatisch verschlüsselt, wenn dein Anbieter es kann – sonst unverschlüsselt`
      : 'Unverschlüsselt (System-DNS)';
  }
  const logged = await hasSecret('nordvpn');
  const v = (await getSettings()).vpnState || {};
  $('vpnLogin').classList.toggle('hidden', logged);
  $('vpnLogout').classList.toggle('hidden', !logged);
  if (!logged) { dot($('vpnDot'), 'warn'); $('vpnText').textContent = 'Nicht angemeldet – dein Internetanbieter kann sehen, welche Seiten du aufrufst.'; }
  else if (v.status === 'on') { dot($('vpnDot'), 'ok'); $('vpnText').textContent = `Geschützt über NordVPN (${v.server}) – Internetanbieter sieht nur NordVPN. DNS läuft über den VPN-Server.`; }
  else if (v.status === 'connecting') { dot($('vpnDot'), 'warn'); $('vpnText').textContent = 'Verbinde mit dem schnellsten NordVPN-Server …'; }
  else { dot($('vpnDot'), 'bad'); $('vpnText').textContent = v.message || 'Keine VPN-Verbindung – zu deinem Schutz wird nichts ungeschützt geladen.'; }
  if (logged && v.status === 'on') { dot($('dnsDot'), 'ok'); $('dnsText').textContent = 'Über den NordVPN-Server – keine DNS-Anfragen beim Internetanbieter'; }
  try {
    const r = await chrome.privacy.network.webRTCIPHandlingPolicy.get({});
    const safe = r.value !== 'default';
    if (r.value === 'disable_non_proxied_udp') { dot($('rtcDot'), 'ok'); $('rtcText').textContent = 'Nur über das VPN – echte IP bleibt verborgen'; return; }
    dot($('rtcDot'), safe ? 'ok' : 'warn');
    $('rtcText').textContent = safe ? 'Lokale IP-Adressen werden nicht preisgegeben' : 'Standard – Seiten können lokale Adressen sehen';
  } catch { $('rtcText').textContent = '–'; }
}

// WebRTC-Test ohne fremden Server: sammelt nur lokale Kandidaten
function localCandidates() {
  return new Promise((resolve) => {
    const found = new Set();
    let pc;
    try { pc = new RTCPeerConnection({ iceServers: [] }); } catch { return resolve([]); }
    pc.createDataChannel('x');
    pc.onicecandidate = (e) => {
      if (!e.candidate) { pc.close(); return resolve([...found]); }
      const m = /([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[a-f0-9:]{6,})/i.exec(e.candidate.candidate);
      if (m && !/\.local$/.test(e.candidate.address || '')) found.add(m[1]);
    };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => resolve([]));
    setTimeout(() => { try { pc.close(); } catch {} resolve([...found]); }, 2500);
  });
}
$('ipCheck').addEventListener('click', async () => {
  $('ipText').textContent = 'Prüfe …'; dot($('ipDot'));
  let ip = null;
  try { ip = (await (await fetch('https://api.ipify.org?format=json', { cache: 'no-store', credentials: 'omit' })).json()).ip; } catch {}
  const leaks = await localCandidates();
  const vs = (await getSettings()).vpnState || {};
  const parts = [ip ? `Öffentliche IP: ${ip}` : 'Öffentliche IP nicht ermittelbar'];
  parts.push(leaks.length ? `WebRTC zeigt lokale Adresse(n): ${leaks.join(', ')}` : 'Kein WebRTC-Leck gefunden');
  if (vs.status === 'on') parts.push('Das ist die Adresse des NordVPN-Servers, nicht deine eigene');
  $('ipText').textContent = parts.join(' · ');
  dot($('ipDot'), ip && !leaks.length ? 'ok' : 'warn');
});

// ---------- Schutz ----------
async function renderProtection() {
  document.querySelectorAll('[data-prot]').forEach((el) => { el.checked = !!S.protection[el.dataset.prot]; });
  $('freshLists').checked = !!S.freshLists;
  let info = {};
  try { info = await (await fetch(chrome.runtime.getURL('rules/sources.json'))).json(); } catch {}
  const live = S.listsInfo || {};
  const box = $('sources'); box.textContent = '';
  for (const k of ['werbung', 'malware', 'phishing']) {
    const st = info[k] || {}, lv = live[k];
    const p = document.createElement('p');
    const name = k === 'werbung' ? 'Werbung & Tracker' : k === 'malware' ? 'Malware' : 'Phishing';
    p.textContent = lv && S.freshLists
      ? `${name}: ${lv.name} – ${fmt(lv.count)} Domains, täglich aktualisiert (zuletzt ${date(lv.date)})`
      : `${name}: ${st.name || '–'} – ${fmt(st.count)} Domains (Stand ${date(st.date)})${st.license ? ', Lizenz ' + st.license : ''}`;
    box.append(p);
  }
}
document.querySelectorAll('[data-prot]').forEach((el) => el.addEventListener('change', async () => {
  await setSettings({ protection: { ...S.protection, [el.dataset.prot]: el.checked } });
  await send({ type: 'apply' }); refresh();
}));
$('freshLists').addEventListener('change', async (e) => { await setSettings({ freshLists: e.target.checked }); await send({ type: 'apply', refresh: e.target.checked }); refresh(); });

// ---------- Privatsphäre ----------
const PRIV = [
  ['webrtc', 'WebRTC-Schutz', 'Videochats funktionieren weiter, lokale IP bleibt verborgen', () => chrome.privacy.network.webRTCIPHandlingPolicy],
  ['thirdPartyCookies', 'Drittanbieter-Cookies blockieren', 'Verhindert seitenübergreifendes Tracking', () => chrome.privacy.websites.thirdPartyCookiesAllowed],
  ['linkAuditing', 'Link-Tracking („ping“) aus', 'Seiten erfahren nicht, welche Links du klickst', () => chrome.privacy.websites.hyperlinkAuditingEnabled],
  ['prediction', 'Kein Vorab-Laden', 'Chrome lädt keine Seiten vorab, die du nicht öffnest', () => chrome.privacy.network.networkPredictionEnabled],
  ['privacySandbox', 'Chrome-Werbe-APIs aus', 'Werbe-Themen, Protected Audience und Werbe-Messung', () => chrome.privacy.websites.topicsEnabled],
  ['safeBrowsing', 'Google Safe Browsing', 'Warnt vor gefährlichen Seiten und Downloads (Chrome prüft Downloads zusätzlich mit Microsoft Defender)', () => chrome.privacy.services.safeBrowsingEnabled]
];
async function renderPrivacy() {
  const box = $('privacyRows'); box.textContent = '';
  for (const [key, title, desc, pref] of PRIV) {
    const row = document.createElement('div'); row.className = 'row';
    let note = '';
    try {
      const p = pref(); if (!p) continue;
      const st = await p.get({});
      if (st.levelOfControl === 'controlled_by_other_extensions') note = ' · wird von einer anderen Erweiterung gesteuert';
      if (st.levelOfControl === 'not_controllable') note = ' · von einer Richtlinie festgelegt';
    } catch { continue; }
    row.innerHTML = '<div><div class="strong"></div><div class="muted small"></div></div><label class="switch"><input type="checkbox"><span></span></label>';
    row.querySelector('.strong').textContent = title;
    row.querySelector('.small').textContent = desc + note;
    const cb = row.querySelector('input'); cb.checked = !!S.privacy[key];
    cb.addEventListener('change', async () => { await setSettings({ privacy: { ...S.privacy, [key]: cb.checked } }); await send({ type: 'apply' }); refresh(); });
    box.append(row);
  }
}

// ---------- Listen ----------
function renderList(id, items, onRemove) {
  const ul = $(id); ul.textContent = '';
  if (!items.length) { ul.innerHTML = '<li class="empty">Keine Einträge</li>'; return; }
  for (const d of items) {
    const li = document.createElement('li');
    const s = document.createElement('span'); s.textContent = d;
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'Entfernen';
    x.addEventListener('click', () => onRemove(d));
    li.append(s, x); ul.append(li);
  }
}
async function renderLists() {
  S = await getSettings();
  renderList('allowlist', S.allowlist, async (d) => { await setSettings({ allowlist: S.allowlist.filter((x) => x !== d) }); await send({ type: 'apply' }); refresh(); });
  renderList('blocklist', S.blocklist, async (d) => { await setSettings({ blocklist: S.blocklist.filter((x) => x !== d) }); await send({ type: 'apply' }); refresh(); });
  renderList('keep', S.traceless.keep, async (d) => { await setSettings({ traceless: { ...S.traceless, keep: S.traceless.keep.filter((x) => x !== d) } }); refresh(); });
}
document.querySelectorAll('form.add').forEach((f) => f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = f.querySelector('input');
  const d = cleanDomain(input.value);
  if (!d) { input.setCustomValidity('Bitte eine gültige Adresse eingeben'); input.reportValidity(); setTimeout(() => input.setCustomValidity(''), 1500); return; }
  const list = f.dataset.list;
  if (list === 'keep') await setSettings({ traceless: { ...S.traceless, keep: [...new Set([...S.traceless.keep, d])] } });
  else {
    const other = list === 'allowlist' ? 'blocklist' : 'allowlist';    // nie gleichzeitig erlaubt und gesperrt
    await setSettings({ [list]: [...new Set([...S[list], d])], [other]: S[other].filter((x) => x !== d) });
    await send({ type: 'apply' });
  }
  input.value = ''; refresh();
}));

// ---------- Erweiterungen ----------
async function renderExtensions() {
  const all = (await chrome.management.getAll()).filter((x) => x.type === 'extension' && x.id !== chrome.runtime.id);
  const odd = all.filter((x) => x.installType !== 'normal' && x.installType !== 'admin');
  $('extSummary').textContent = all.length ? `${all.length} weitere Erweiterung(en) installiert${odd.length ? ` – ${odd.length} nicht aus dem Chrome Web Store` : ''}` : 'Keine weiteren Erweiterungen installiert';
  const ul = $('extList'); ul.textContent = '';
  for (const x of all) {
    const li = document.createElement('li');
    const s = document.createElement('span'); s.textContent = x.name;
    const t = document.createElement('span'); t.className = 'tag' + (x.installType === 'normal' || x.installType === 'admin' ? '' : ' warn');
    t.textContent = !x.enabled ? 'Aus' : x.installType === 'normal' ? 'Web Store' : x.installType === 'admin' ? 'Richtlinie' : 'Prüfen: ' + x.installType;
    li.append(s, t); ul.append(li);
  }
}

// ---------- Updates ----------
async function renderVersions() {
  try {
    const h = await navigator.userAgentData.getHighEntropyValues(['fullVersionList']);
    const c = h.fullVersionList.find((b) => /Google Chrome|Chromium/.test(b.brand));
    $('vChrome').textContent = c ? `Version ${c.version} – Google aktualisiert Chrome automatisch` : 'Wird von Google aktualisiert';
  } catch { $('vChrome').textContent = 'Wird von Google aktualisiert'; }
  const L = await launcherInfo();
  const ext = chrome.runtime.getManifest().version;
  const u = L && L.update;
  $('vImmo').textContent = `Erweiterung ${ext}${L ? ` · Programm ${L.appVersion}` : ''}${u && u.message ? ` · ${u.message}` : ''}`;
  dot($('updDot'), u && u.status === 'ready' ? 'warn' : 'ok');
  $('lang').value = S.translateTarget;
}
$('lang').addEventListener('change', (e) => setSettings({ translateTarget: e.target.value }));

document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => chrome.tabs.create({ url: b.dataset.open })));

async function refresh() {
  await renderStats();
  await Promise.all([renderSite(), renderConnection(), renderProtection(), renderPrivacy(), renderLists(), renderExtensions(), renderVersions(), renderDefaultPerms()]);
}
refresh();
chrome.tabs.onActivated.addListener(() => renderSite());
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'complete') renderSite(); });
chrome.storage.onChanged.addListener((c) => { if (c.stats) renderStats(); });
setInterval(() => { send({ type: 'flush' }); renderConnection(); }, 30000);

$('vpnForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = $('vpnUser').value.trim(), pass = $('vpnPass').value;
  if (!user || !pass) return;
  const r = await send({ type: 'vpn-save', user, pass });
  $('vpnPass').value = ''; $('vpnUser').value = '';
  if (r && r.ok) setTimeout(renderConnection, 1500);
  renderConnection();
});
$('vpnLogout').addEventListener('click', async () => {
  if (!confirm('NordVPN auf diesem Gerät abmelden? Danach läuft der Browser ohne VPN.')) return;
  await send({ type: 'vpn-forget' }); renderConnection();
});
chrome.storage.onChanged.addListener((c) => { if (c.vpnState) renderConnection(); });
