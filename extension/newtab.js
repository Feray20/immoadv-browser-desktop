// ImmoAdv-Startseite (neuer Tab)
import { getSettings, fmt } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
$('today').textContent = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

// Adresse direkt öffnen, sonst Google-Suche
$('search').addEventListener('submit', (e) => {
  const v = $('q').value.trim();
  if (!v) { e.preventDefault(); return; }
  const looksLikeUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(v) && !/\s/.test(v);
  if (looksLikeUrl) { e.preventDefault(); location.href = /^https?:\/\//i.test(v) ? v : 'https://' + v; }
});

const favicon = (url) => { const u = new URL(chrome.runtime.getURL('/_favicon/')); u.searchParams.set('pageUrl', url); u.searchParams.set('size', '32'); return u.toString(); };
function tile(url, title) {
  const a = document.createElement('a');
  a.className = 'tile'; a.href = url; a.title = title;
  const img = document.createElement('img'); img.src = favicon(url); img.alt = '';
  const s = document.createElement('span'); s.textContent = title;
  a.append(img, s);
  return a;
}

chrome.topSites.get((list) => {
  const box = $('tiles');
  const items = (list || []).filter((t) => /^https?:/.test(t.url)).slice(0, 8);
  if (!items.length) { box.innerHTML = '<div class="empty">Hier erscheinen deine meistbesuchten Seiten.</div>'; return; }
  items.forEach((t) => box.append(tile(t.url, t.title || new URL(t.url).hostname)));
});

[['https://immoadv.de', 'ImmoAdv'], ['https://www.immobilienscout24.de', 'ImmoScout24'], ['https://www.immowelt.de', 'Immowelt'], ['https://www.kleinanzeigen.de/s-immobilien/c195', 'Kleinanzeigen Immobilien']]
  .forEach(([u, t]) => $('fixed').append(tile(u, t)));

async function status() {
  const s = await getSettings();
  const on = Object.values(s.protection).some(Boolean);
  const total = s.stats.werbung + s.stats.malware + s.stats.phishing + s.stats.eigene;
  $('statusDot').className = 'dot ' + (on ? 'ok' : 'warn');
  $('statusText').textContent = on
    ? `Schutz aktiv · ${fmt(total)} Anfragen blockiert`
    : 'Schutz ist ausgeschaltet';
}
status();
chrome.storage.onChanged.addListener(status);

$('status').addEventListener('click', async () => {
  const win = await chrome.windows.getCurrent();
  try { await chrome.sidePanel.open({ windowId: win.id }); }
  catch { chrome.tabs.create({ url: chrome.runtime.getURL('panel.html?full=1') }); }
});
