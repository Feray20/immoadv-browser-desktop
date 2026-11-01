// Läuft in jedem Tab (Hauptseite) – ohne Zugriff auf Node oder die App, nur zwei schmale Meldungen:
// 1) Anmeldeformular erkannt → der Browser kann gespeicherte Zugangsdaten anbieten
// 2) Anmeldung abgeschickt → der Browser fragt „Passwort speichern?“
// Passwörter verlassen den Computer nicht; sie gehen nur an den eigenen Browser zum verschlüsselten Speichern.
const { ipcRenderer } = require('electron');

function userFieldFor(pw) {
  const form = pw.form || document;
  const inputs = [...form.querySelectorAll('input')].filter((i) => !i.disabled && i.type !== 'hidden');
  const idx = inputs.indexOf(pw);
  for (let i = idx - 1; i >= 0; i--) {
    const t = (inputs[i].type || 'text').toLowerCase();
    if (['text', 'email', 'tel', ''].includes(t) || /user|mail|login|name/i.test(inputs[i].name + inputs[i].id + (inputs[i].autocomplete || ''))) return inputs[i];
  }
  return document.querySelector('input[autocomplete="username"], input[type="email"]');
}

let lastSent = '';
function capture(form) {
  const pw = [...(form || document).querySelectorAll('input[type="password"]')].find((i) => i.value);
  if (!pw) return;
  // Registrierung/Passwortwechsel: das letzte ausgefüllte Passwortfeld ist das neue Passwort
  const all = [...(form || document).querySelectorAll('input[type="password"]')].filter((i) => i.value);
  const pass = all[all.length - 1].value;
  const u = userFieldFor(pw);
  const user = u && u.value ? u.value.trim() : '';
  const key = user + '\u0000' + pass;
  if (key === lastSent) return;
  lastSent = key;
  ipcRenderer.send('pw:submitted', { url: location.href, user, pass });
}

window.addEventListener('submit', (e) => capture(e.target), true);
// Viele Seiten schicken nicht per <form> ab, sondern per Klick oder Enter
window.addEventListener('click', (e) => {
  const b = e.target && e.target.closest ? e.target.closest('button, input[type="submit"], [role="button"]') : null;
  if (b) setTimeout(() => capture(b.form || b.closest('form') || document), 0);
}, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.type === 'password') capture(e.target.form || document); }, true);

// Anmeldeformular auf der Seite? (auch wenn es später nachgeladen wird)
let reported = false;
function lookForLogin() {
  if (reported) return;
  if (document.querySelector('input[type="password"]')) { reported = true; ipcRenderer.send('pw:form', location.href); }
}
document.addEventListener('DOMContentLoaded', () => {
  lookForLogin();
  const mo = new MutationObserver(() => { lookForLogin(); if (reported) mo.disconnect(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 20000);
});

// Schneller laden: beim Zeigen auf einen Link zu einer anderen Seite wird die Verbindung schon vorbereitet
const seen = new Set();
window.addEventListener('mouseover', (e) => {
  const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a) return;
  let u; try { u = new URL(a.href, location.href); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || u.origin === location.origin || seen.has(u.origin) || seen.size > 40) return;
  seen.add(u.origin);
  ipcRenderer.send('preconnect', u.origin);
}, { capture: true, passive: true });
