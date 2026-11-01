'use strict';
const $ = (id) => document.getElementById(id);
const send = (m) => browser.runtime.sendMessage(m);
const siteOf = (h) => { h = String(h || '').toLowerCase(); const p = h.split('.'); if (p.length <= 2) return h; const l2 = p.slice(-2).join('.'); return /^(co|com|org|ac|gov|or|gen)\.[a-z]{2}$/.test(l2) ? p.slice(-3).join('.') : l2; };
let st = null, tab = null, site = '';

async function render() {
  [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  st = await send({ type: 'state' });
  $('ver').textContent = 'Version ' + st.version;
  let host = ''; try { const u = new URL(tab.url); if (/^https?:$/.test(u.protocol)) host = u.hostname; } catch (e) {}
  site = siteOf(host);
  const s = st.settings;
  $('host').textContent = host || 'ImmoAdv-Seite';
  const allow = (s.allowlist || []).includes(site), keep = (s.keepSignedIn || []).some((d) => site === d || site.endsWith('.' + d));
  $('siteInfo').textContent = !host ? 'Interne Seite' : allow ? 'Schutz hier ausgeschaltet' : (tab.url.startsWith('https:') ? 'Verschlüsselt · geschützt' : 'Nicht verschlüsselt');
  $('siteProtect').checked = !allow; $('siteKeep').checked = keep;
  for (const id of ['siteProtect', 'siteKeep', 'siteClear']) $(id).disabled = !host;
  $('nBlocked').textContent = Number(await send({ type: 'blocked:count', tabId: tab.id }) || 0).toLocaleString('de-DE');
  const t = s.stats || {};
  $('nTotal').textContent = ((t.werbung || 0) + (t.malware || 0) + (t.phishing || 0) + (t.eigene || 0)).toLocaleString('de-DE');
  // VPN
  const v = st.vpn || {};
  const map = { on: ['aktiv', 'ok'], connecting: ['verbindet', 'warn'], waiting: ['wartet', 'warn'], error: ['Fehler', 'bad'], authfail: ['Zugangsdaten', 'bad'], nocreds: ['aus', ''] };
  const [label, cls] = map[v.status] || ['aus', ''];
  $('vpnBadge').textContent = label; $('vpnBadge').className = 'badge ' + cls;
  $('vpnText').textContent = !v.loggedIn ? 'In den Einstellungen anmelden' : v.status === 'on' ? `Server ${v.server || ''}` : (v.message || 'Verbindung wird geprüft');
  $('vpnCountry').innerHTML = st.countries.map((c) => `<option value="${c.code}" ${c.code === (s.vpnCountry || 'auto') ? 'selected' : ''}>${c.name}</option>`).join('');
  $('vpnCountryRow').classList.toggle('hidden', !v.loggedIn);
  // Update
  const u = st.update || {};
  const show = ['available', 'downloading', 'ready'].includes(u.status);
  $('update').classList.toggle('hidden', !show);
  if (show) $('upText').textContent = u.status === 'downloading' ? `Version ${u.version} lädt … ${u.progress || 0} %` : `Version ${u.version} ist da`;
}

$('siteProtect').onchange = async (e) => {
  const list = new Set(st.settings.allowlist || []);
  e.target.checked ? list.delete(site) : list.add(site);
  await send({ type: 'settings:set', patch: { allowlist: [...list] } });
  browser.tabs.reload(tab.id); render();
};
$('siteKeep').onchange = async (e) => {
  const list = new Set(st.settings.keepSignedIn || []);
  e.target.checked ? list.add(site) : list.delete(site);
  await send({ type: 'settings:set', patch: { keepSignedIn: [...list] } }); render();
};
$('siteClear').onclick = async () => { await send({ type: 'site:clear', site }); $('siteClear').textContent = 'Gelöscht ✓'; browser.tabs.reload(tab.id); };
$('vpnCountry').onchange = async (e) => { $('vpnText').textContent = 'Wechselt …'; await send({ type: 'vpn:country', code: e.target.value }); render(); };
$('upNow').onclick = async () => { $('upNow').disabled = true; $('upNow').textContent = 'Wird installiert …'; await send({ type: 'update:now' }); };

document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
  const a = b.dataset.act;
  if (a === 'ai') { browser.sidebarAction.open(); window.close(); return; }
  const pages = { immo: `immo.html?tab=${tab.id}&full=1`, pdf: '../studio/index.html', passwords: 'settings.html#passwoerter', watch: 'settings.html#merkliste', settings: 'settings.html' };
  await browser.tabs.create({ url: browser.runtime.getURL('pages/' + pages[a]).replace('pages/../', '') });
  window.close();
}));
browser.runtime.onMessage.addListener((m) => { if (m && (m.type === 'vpn' || m.type === 'update')) render(); });
render();
