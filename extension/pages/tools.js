'use strict';
const $ = (id) => document.getElementById(id);
const send = (m) => browser.runtime.sendMessage(m);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (t) => (t ? new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
let winId = null;

function view(v) {
  if (!['bereiche', 'spaeter', 'firma'].includes(v)) v = 'bereiche';
  for (const s of document.querySelectorAll('section')) s.hidden = s.id !== v;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  ({ bereiche: spaces, spaeter: later, firma: firm })[v]();
}
document.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => view(b.dataset.v));
addEventListener('hashchange', () => view(location.hash.slice(1)));

// ---------- Arbeitsbereiche ----------
async function spaces(list) {
  if (!list) list = await send({ type: 'spaces:list' });
  const el = $('spList');
  if (!list.length) { el.innerHTML = '<div class="empty">Noch keine Arbeitsbereiche. Öffne die Tabs, die zusammengehören, und klicke „Dieses Fenster merken“.</div>'; return; }
  el.innerHTML = list.map((s) => `<div class="li"><div><div class="t">${esc(s.name)}</div><div class="s">${s.tabs.length} Tabs · ${esc(when(s.at))} · ${esc(s.tabs.slice(0, 3).map((t) => t.title || t.url).join(' · '))}</div></div>
    <div class="act"><button class="pill accent" data-open="${esc(s.id)}">Öffnen</button><button class="pill" data-replace="${esc(s.id)}" title="Tabs dieses Fensters durch den Arbeitsbereich ersetzen">Hier wechseln</button><button class="pill" data-upd="${esc(s.id)}" title="Mit den Tabs dieses Fensters überschreiben">Aktualisieren</button><button class="pill" data-del="${esc(s.id)}">Entfernen</button></div></div>`).join('');
  el.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => send({ type: 'spaces:open', id: b.dataset.open }));
  el.querySelectorAll('[data-replace]').forEach((b) => b.onclick = () => send({ type: 'spaces:open', id: b.dataset.replace, windowId: winId, replace: true }));
  el.querySelectorAll('[data-upd]').forEach((b) => b.onclick = async () => { const r = await send({ type: 'spaces:save', id: b.dataset.upd, windowId: winId }); if (r.error) alertLine(r.error); else spaces(r.spaces); });
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Wirklich?'; setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Entfernen'; }, 3000); return; }
    spaces((await send({ type: 'spaces:remove', id: b.dataset.del })).spaces);
  });
}
function alertLine(t) { const d = document.createElement('div'); d.className = 'empty'; d.setAttribute('role', 'alert'); d.textContent = t; $('spList').prepend(d); setTimeout(() => d.remove(), 5000); }
$('spForm').onsubmit = async (e) => {
  e.preventDefault();
  const r = await send({ type: 'spaces:save', name: $('spName').value.trim(), windowId: winId });
  if (r.error) { alertLine(r.error); return; }
  $('spName').value = ''; spaces(r.spaces);
};

// ---------- Später ansehen ----------
async function later() {
  const list = await send({ type: 'later:list' });
  const el = $('laterList');
  if (!list.length) { el.innerHTML = '<div class="empty">Nichts gemerkt. Rechtsklick auf eine Seite oder einen Link → „Später ansehen“.</div>'; return; }
  el.innerHTML = list.map((b) => { let host = ''; try { host = new URL(b.url).hostname.replace(/^www\./, ''); } catch (e) { /* */ }
    return `<div class="li"><a href="${esc(b.url)}" target="_blank" rel="noopener"><div class="t">${esc(b.title || b.url)}</div><div class="s">${esc(host)} · gemerkt ${esc(when(b.added))}</div></a><div class="act"><button class="pill" data-done="${esc(b.id)}">Erledigt</button></div></div>`; }).join('');
  el.querySelectorAll('[data-done]').forEach((b) => b.onclick = async () => { await send({ type: 'later:done', id: b.dataset.done }); later(); });
}

// ---------- Firmendaten ----------
async function firm() {
  const s = (await send({ type: 'state' })).settings || {};
  const f = s.firm || {};
  for (const el of $('firmForm').elements) if (el.name) el.value = f[el.name] || '';
}
$('firmForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = {};
  for (const el of $('firmForm').elements) if (el.name) f[el.name] = el.value.trim().slice(0, 200);
  await send({ type: 'settings:set', patch: { firm: f } });
  $('firmNote').textContent = 'Gespeichert ✓';
  setTimeout(() => { $('firmNote').textContent = ''; }, 3000);
};

(async () => {
  try { winId = (await browser.windows.getCurrent()).id; } catch (e) { winId = null; }
  view(location.hash.slice(1));
})();
