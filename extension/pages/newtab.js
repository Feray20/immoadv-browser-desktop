'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('de-DE');
const eur = (n) => Number(n || 0).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €';

function looksLikeUrl(s) { return /^[a-z]+:\/\//i.test(s) || /^[^\s]+\.[a-z]{2,}(\/|$|:)/i.test(s) || /^localhost(:\d+)?/.test(s); }
$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('q').value.trim(); if (!q) return;
  if (looksLikeUrl(q)) location.href = /^[a-z]+:\/\//i.test(q) ? q : 'https://' + q;
  else browser.search.search({ query: q, disposition: 'CURRENT_TAB' }).catch(() => { location.href = 'https://www.google.com/search?q=' + encodeURIComponent(q); });
});
$('ai').addEventListener('click', async () => {
  const q = $('q').value.trim();
  await browser.storage.local.set({ aiQueued: q });
  browser.sidebarAction.open();
});

function tile(b) {
  const a = document.createElement('a'); a.className = 'fav'; a.href = b.url; a.title = b.url;
  let host = ''; try { host = new URL(b.url).hostname; } catch (e) {}
  const ic = document.createElement('div'); ic.className = 'ic'; ic.textContent = (b.title || host || '?').trim().charAt(0).toUpperCase();
  if (host) {
    const img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer';
    img.onload = () => { if (img.naturalWidth > 1) { ic.textContent = ''; ic.classList.add('has-img'); ic.append(img); } };
    img.src = `https://${host}/favicon.ico`;
  }
  const s = document.createElement('span'); s.textContent = b.title || host;
  a.append(ic, s);
  return a;
}

async function render() {
  const h = new Date().getHours();
  $('greeting').textContent = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
  $('today').textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  try {
    const bar = await browser.bookmarks.getChildren('toolbar_____');
    const favs = bar.filter((b) => b.url && /^https?:/.test(b.url)).slice(0, 12);
    // Favoriten nur neu aufbauen, wenn sie sich geändert haben (02.11.2026: bei jeder VPN-Meldung sprangen alle Kacheln
    // kurz auf den Buchstaben zurück und luden ihr Symbol neu – sichtbares Blinken).
    const sig = JSON.stringify(favs.map((b) => [b.url, b.title]));
    if (sig !== render.favSig) { render.favSig = sig; $('favorites').replaceChildren(...favs.map(tile)); }
    if (!favs.length) $('favorites').innerHTML = '<p class="hint">Mit ☆ in der Adressleiste fügst du Favoriten hinzu.</p>';
  } catch (e) {}
  const st = await browser.runtime.sendMessage({ type: 'state' }).catch(() => null);
  if (!st) return;
  const s = st.settings.stats || {};
  const blocked = (s.werbung || 0) + (s.malware || 0) + (s.phishing || 0) + (s.eigene || 0);
  const v = st.vpn || {};
  $('statusRow').innerHTML = [
    `<span class="status-chip"><i></i><b>${num(blocked)}</b> Tracker & Gefahren blockiert</span>`,
    v.status === 'on' ? '<span class="status-chip"><i></i>NordVPN aktiv</span>' : v.loggedIn ? '<span class="status-chip warn"><i></i>NordVPN verbindet</span>' : '<span class="status-chip"><i></i>Verschlüsseltes DNS</span>',
    st.settings.traceless !== false ? '<span class="status-chip"><i></i>Spurlos surfen</span>' : ''
  ].join('');
}
render();
// Lesezeichen kommen beim ersten Start erst nach und nach (Übernahme aus Version 3) – Favoriten sofort mitziehen
for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) browser.bookmarks[ev].addListener(() => { clearTimeout(window.__bm); window.__bm = setTimeout(render, 300); });
browser.runtime.onMessage.addListener((m) => { if (m && m.type === 'vpn') render(); });
