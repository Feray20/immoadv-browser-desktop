'use strict';
// Update-Fenster wie in Version 3: Neuerungen, Fortschritt, ein Knopf – lädt, installiert und startet neu (Tabs bleiben).
const $ = (id) => document.getElementById(id);
const send = (m) => browser.runtime.sendMessage(m);
let u = {}, pressed = false;
function render() {
  const busy = u.status === 'downloading' || u.status === 'installing' || u.status === 'restarting';
  $('title').textContent = u.status === 'installing' || u.status === 'restarting' ? 'Wird installiert …' : `Neue Version ${u.version || ''}`.trim();
  $('notes').textContent = u.notes || 'Verbesserungen und Fehlerbehebungen.';
  $('barWrap').classList.toggle('hidden', u.status !== 'downloading');
  $('bar').style.width = (u.progress || 0) + '%';
  $('hint').textContent = u.status === 'downloading' ? `Lädt … ${u.progress || 0} %` : busy ? 'Der Browser startet gleich neu – Tabs und Daten bleiben erhalten.' : 'Lädt, installiert und startet neu – ohne weitere Fragen.';
  $('now').disabled = busy && pressed;
  $('now').textContent = busy && pressed ? 'Wird installiert …' : 'Update jetzt installieren';
}
$('now').onclick = async () => { pressed = true; u = { ...u, status: u.status === 'ready' ? 'installing' : 'downloading' }; render(); await send({ type: 'update:now' }); };
$('later').onclick = async () => { await send({ type: 'update:later', version: u.version }); window.close(); };
browser.runtime.onMessage.addListener((m) => { if (m && m.type === 'update') { u = m.data || {}; render(); } });
send({ type: 'state' }).then((s) => { u = s.update || {}; render(); });
