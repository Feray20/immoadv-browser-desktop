'use strict';
// ImmoAdv-⋯-Menü (wie im ImmoAdv Browser 3) + Datenschutz-Center. Nur echte Funktionen.
const $ = (id) => document.getElementById(id);
const send = (m) => browser.runtime.sendMessage(m);
const isMac = navigator.platform.startsWith('Mac');
const K = (k) => (isMac ? k.replace('Strg+', '⌘').replace('Umschalt+', '⇧') : k);
const siteOf = (h) => { h = String(h || '').toLowerCase(); const p = h.split('.'); if (p.length <= 2) return h; const l2 = p.slice(-2).join('.'); return /^(co|com|org|ac|gov|or|gen)\.[a-z]{2}$/.test(l2) ? p.slice(-3).join('.') : l2; };
const page = (p) => browser.runtime.getURL('pages/' + p);
const cmd = (c) => browser.tabs.create({ url: page('cmd.html?c=' + c), active: false });   // Befehle, die nur der Browser selbst ausführen darf
let st = null, tab = null, site = '', isWeb = false, shared = false;

async function act(fn) { try { await fn(); } finally { window.close(); } }

function items() {
  const u = (tab && tab.url) || '';
  const pdf = /\.pdf(\?|#|$)/i.test(u);
  return [
    ['＋', 'Neuer Tab', 'Strg+T', () => browser.tabs.create({})],
    ['⧉', 'Neues Fenster', 'Strg+N', () => cmd('newwindow')],
    ['↺', 'Geschlossenen Tab wieder öffnen', 'Strg+Umschalt+T', async () => { const [c] = await browser.sessions.getRecentlyClosed({ maxResults: 1 }); if (c) await browser.sessions.restore((c.tab || c.window).sessionId); }],
    '-',
    ['✦', 'KI-Assistent', 'Strg+Umschalt+A', () => browser.sidebarAction.open()],
    // Claude-Connector (05.11.2026): diesen Tab für Claude freigeben (sonst steuert Claude nur eigene Tabs)
    ...(st && st.settings && st.settings.claudeRemote === true && isWeb ? [['✦', shared ? 'Nicht mehr mit Claude teilen' : 'Mit Claude teilen', '', () => send({ type: 'remote:share', tabId: tab.id, on: !shared })]] : []),
    // LinkedIn/XING → ImmoAdv Sales & Growth (05.11.2026): übergibt nur Link und Seitentitel an den Web-Admin,
    // dort wählst du die Firma. Nichts wird von der Seite ausgelesen oder automatisch gespeichert.
    ...(/^https:\/\/([a-z0-9-]+\.)*(linkedin|xing)\.com\//i.test(u) ? [['in', 'Zu Sales & Growth', '', () => browser.tabs.create({ url: `https://admin.immoadv.de/?sa_profil=${encodeURIComponent(u.split('#')[0].split('?')[0])}&sa_name=${encodeURIComponent((tab.title || '').slice(0, 160))}#sa_firmen` })]] : []),
    ['⌂', 'Immobilien-Check', '', () => browser.tabs.create({ url: page(`immo.html?tab=${tab.id}&full=1`) }), !isWeb],
    ['⌕', 'Auf Seite suchen …', 'Strg+F', () => cmd('find'), !isWeb && !pdf],
    'zoom',
    ['⎙', 'Drucken …', 'Strg+P', () => browser.tabs.print(), !isWeb && !pdf],
    ['▣', 'Bildschirmfoto der ganzen Seite', '', () => send({ type: 'tool:fullshot', tabId: tab.id }), !isWeb && !pdf],
    ['⤓', 'Seite als PDF speichern …', '', () => send({ type: 'tool:pdf', tabId: tab.id }), !isWeb || pdf],
    '-',
    ['🕘', 'Verlauf', 'Strg+H', () => cmd('history')],
    ['☆', 'Lesezeichen', 'Strg+Umschalt+O', () => cmd('bookmarks')],
    ['↓', 'Downloads', 'Strg+Umschalt+Y', () => cmd('downloads')],
    ['🔑', 'Passwörter', '', () => browser.tabs.create({ url: page('settings.html#passwoerter') })],
    '-',
    ['▤', pdf ? 'Text erkennen & gerade ausrichten' : 'PDF & Scans bearbeiten', '', () => browser.tabs.create({ url: browser.runtime.getURL(pdf ? `studio/index.html?src=${encodeURIComponent(u)}&auto=1` : 'studio/index.html') })],
    ['{ }', 'Entwicklertools', 'F12', () => cmd('devtools'), !isWeb],
    '-',
    ['🛡', 'Datenschutz-Center', '', () => { showPrivacy(); return 'stay'; }],
    ['⇪', 'Upload-Verlauf', '', () => browser.tabs.create({ url: page('uploads.html') })],
    ['⚙', 'Einstellungen', 'Strg+,', () => browser.runtime.openOptionsPage()]
  ];
}

async function zoomRow() {
  const z = isWeb ? await browser.tabs.getZoom(tab.id).catch(() => 1) : 1;
  const row = document.createElement('div'); row.className = 'zoomrow';
  row.innerHTML = `<span class="lbl"><span class="ic" style="width:18px;text-align:center;color:var(--text-2)">⊕</span>Zoom</span><button id="zm" aria-label="Verkleinern">−</button><span id="zv">${Math.round(z * 100)} %</span><button id="zp" aria-label="Vergrößern">+</button><button id="z0" aria-label="Originalgröße">100</button>`;
  const set = async (f) => { const cur = await browser.tabs.getZoom(tab.id); const n = f === null ? 1 : Math.min(3, Math.max(0.3, Math.round((cur + f) * 10) / 10)); await browser.tabs.setZoom(tab.id, n); row.querySelector('#zv').textContent = Math.round(n * 100) + ' %'; };
  row.querySelector('#zm').onclick = () => set(-0.1); row.querySelector('#zp').onclick = () => set(0.1); row.querySelector('#z0').onclick = () => set(null);
  row.querySelectorAll('button').forEach((b) => { b.disabled = !isWeb; });
  return row;
}

async function renderMenu() {
  const nav = $('items'); nav.replaceChildren();
  for (const it of items()) {
    if (it === '-') { nav.append(document.createElement('hr')); continue; }
    if (it === 'zoom') { nav.append(await zoomRow()); continue; }
    const [ic, label, kb, fn, disabled] = it;
    const b = document.createElement('button'); b.className = 'item'; b.disabled = !!disabled;
    b.innerHTML = `<span class="ic"></span><span class="lb"></span><span class="kb"></span>`;
    b.querySelector('.ic').textContent = ic; b.querySelector('.lb').textContent = label; b.querySelector('.kb').textContent = kb ? K(kb) : '';
    b.onclick = async () => { const r = await Promise.resolve(fn()).catch(() => null); if (r !== 'stay') window.close(); };
    nav.append(b);
  }
}

function renderStatus() {
  const t = st.settings.stats || {};
  const total = (t.werbung || 0) + (t.malware || 0) + (t.phishing || 0) + (t.eigene || 0);
  $('sumText').textContent = `Geschützt · ${total.toLocaleString('de-DE')} blockiert`;
  const v = st.vpn || {};
  $('vpnChip').textContent = v.status === 'on' ? 'NordVPN aktiv' : v.loggedIn ? 'NordVPN verbindet' : 'VPN aus';
  $('vpnChip').className = 'badge ' + (v.status === 'on' ? 'ok' : v.loggedIn ? 'warn' : '');
  $('ver').textContent = 'v' + st.version;
  const u = st.update || {};
  const show = ['available', 'downloading', 'ready'].includes(u.status);
  $('update').classList.toggle('hidden', !show);
  if (show) $('upText').textContent = u.status === 'downloading' ? `Version ${u.version} lädt … ${u.progress || 0} %` : `Version ${u.version} ist da`;
}

// ---------- Datenschutz-Center ----------
async function showPrivacy() {
  if (!st) st = await send({ type: 'state' }).catch(() => null);
  if (!st) return;
  $('menu').classList.add('hidden'); $('privacy').classList.remove('hidden');
  const s = st.settings;
  let host = ''; try { const x = new URL(tab.url); if (/^https?:$/.test(x.protocol)) host = x.hostname; } catch (e) {}
  site = siteOf(host);
  $('host').textContent = host || 'ImmoAdv-Seite';
  const allow = (s.allowlist || []).includes(site), keep = (s.keepSignedIn || []).some((d) => site === d || site.endsWith('.' + d));
  $('siteInfo').textContent = !host ? 'Interne Seite' : allow ? 'Schutz hier ausgeschaltet' : (tab.url.startsWith('https:') ? 'Verschlüsselt · geschützt' : 'Nicht verschlüsselt');
  $('siteProtect').checked = !allow; $('siteKeep').checked = keep;
  for (const id of ['siteProtect', 'siteKeep', 'siteClear']) $(id).disabled = !host;
  $('nBlocked').textContent = Number(await send({ type: 'blocked:count', tabId: tab.id }) || 0).toLocaleString('de-DE');
  const t = s.stats || {};
  $('nTotal').textContent = ((t.werbung || 0) + (t.malware || 0) + (t.phishing || 0) + (t.eigene || 0)).toLocaleString('de-DE');
  const v = st.vpn || {};
  const map = { on: ['aktiv', 'ok'], connecting: ['verbindet', 'warn'], waiting: ['wartet', 'warn'], error: ['Fehler', 'bad'], authfail: ['Zugangsdaten', 'bad'], nocreds: ['aus', ''] };
  const [label, cls] = map[v.status] || ['aus', ''];
  $('vpnBadge').textContent = label; $('vpnBadge').className = 'badge ' + cls;
  $('vpnText').textContent = !v.loggedIn ? 'In den Einstellungen anmelden' : v.status === 'on' ? `Server ${v.server || ''}` : (v.message || 'Verbindung wird geprüft');
  $('vpnCountry').innerHTML = st.countries.map((c) => `<option value="${c.code}" ${c.code === (s.vpnCountry || 'auto') ? 'selected' : ''}>${c.name}</option>`).join('');
  $('vpnCountryRow').classList.toggle('hidden', !v.loggedIn);
}
$('openPrivacy').onclick = showPrivacy;
$('back').onclick = () => { $('privacy').classList.add('hidden'); $('menu').classList.remove('hidden'); };
$('siteProtect').onchange = async (e) => { const l = new Set(st.settings.allowlist || []); e.target.checked ? l.delete(site) : l.add(site); st.settings = await send({ type: 'settings:set', patch: { allowlist: [...l] } }); browser.tabs.reload(tab.id); showPrivacy(); };
$('siteKeep').onchange = async (e) => { const l = new Set(st.settings.keepSignedIn || []); e.target.checked ? l.add(site) : l.delete(site); st.settings = await send({ type: 'settings:set', patch: { keepSignedIn: [...l] } }); showPrivacy(); };
$('siteClear').onclick = async () => { await send({ type: 'site:clear', site }); $('siteClear').textContent = 'Gelöscht ✓'; browser.tabs.reload(tab.id); };
$('vpnCountry').onchange = async (e) => { $('vpnText').textContent = 'Wechselt …'; st.vpn = await send({ type: 'vpn:country', code: e.target.value }); showPrivacy(); };
$('upNow').onclick = async () => { $('upNow').disabled = true; $('upNow').textContent = 'Wird installiert …'; await send({ type: 'update:now' }); };

browser.runtime.onMessage.addListener((m) => { if (m && (m.type === 'vpn' || m.type === 'update')) { if (m.type === 'vpn') st.vpn = m.data; else st.update = m.data; renderStatus(); } });
// 05.11.2026 (Feray: „beim Knopf oben rechts passiert gar nichts“): Das Menü wartete auf den Zustand des Hintergrunds
// (bis zu 6 s, bei einem Fehler für immer) – das Fenster blieb leer. Jetzt steht das Menü sofort, der Status kommt nach.
(async () => {
  try { [tab] = await browser.tabs.query({ active: true, currentWindow: true }); } catch (e) { tab = null; }
  isWeb = !!tab && /^https?:/.test(tab.url || '');
  try { await renderMenu(); } catch (e) { console.error(e); }
  try { st = await Promise.race([send({ type: 'state' }), new Promise((r) => setTimeout(() => r(null), 8000))]); } catch (e) { st = null; }
  if (st) { try { renderStatus(); } catch (e) { console.error(e); } } else $('sumText').textContent = 'Schutz wird geladen …';
  if (st && st.settings && st.settings.claudeRemote === true && isWeb) { try { shared = !!(await send({ type: 'remote:shared', tabId: tab.id })); await renderMenu(); } catch (e) { console.error(e); } }
})();
