// ImmoAdv-Passwort-Tresor: speichern, automatisch ausfüllen, importieren (iCloud/Google/Chrome-Export).
// Jedes Passwort einzeln mit der Systemverschlüsselung (Windows: DPAPI, Mac: Schlüsselbund) – nie Klartext.
// Freigabe zum Ausfüllen/Anzeigen mit Windows Hello bzw. Touch ID (danach 5 Minuten ohne erneute Abfrage).
const { safeStorage, systemPreferences } = require('electron');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const store = require('./store');
const { siteOf, sharedSite } = require('../src/shared/lists');

let unlockedUntil = 0;

const enc = (text) => safeStorage.encryptString(String(text)).toString('base64');
const dec = (b64) => { try { return safeStorage.decryptString(Buffer.from(b64, 'base64')); } catch { return null; } };
const hostOf = (u) => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u).hostname.toLowerCase(); } catch { return ''; } };

function all() { return store.get('passwords') || []; }
function save(list) { store.set('passwords', list); }

const noWww = (h) => String(h || '').replace(/^www\./, '');
const plainHttp = (u) => { try { const x = new URL(u); return x.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname); } catch { return false; } };
/**
 * Passt ein gespeicherter Eintrag zu dieser Adresse? (Prüfung 01.11.2026)
 * – nie auf unverschlüsseltem http (außer localhost)
 * – Hosting-Dienste (vercel.app, github.io …): nur exakt derselbe Host – fremde Subdomains gehören anderen Betreibern
 * – sonst wie bisher: dieselbe Seite inkl. Subdomains (login.amazon.de ⇄ amazon.de)
 */
function matches(p, url) {
  if (plainHttp(url)) return false;
  const h = hostOf(url); if (!h) return false;
  const site = siteOf(h);
  if (p.site !== site) return false;
  if (sharedSite(site)) return noWww(p.host) === noWww(h);
  return true;
}
/** Einträge für eine Seite, ohne Passwörter */
// Genau nach Link (03.11.2026, Feray: „exakt nach Link“): Einträge vom selben Host (z. B. developer.ebay.com) stehen vor
// denen der übrigen Seite (signin.ebay.de); mit gleichem Host zuerst der mit derselben Anmeldeseite.
const pathOf = (u) => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u).pathname; } catch { return ''; } };
const cleanUrl = (u) => { try { const x = new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u); return `${x.origin}${x.pathname}`.slice(0, 300); } catch { return ''; } };
function forUrl(url) {
  const h = noWww(hostOf(url)), pth = pathOf(url);
  const rank = (p) => (noWww(p.host) === h ? (p.url && pathOf(p.url) === pth ? 0 : 1) : 2);
  return all().filter((p) => matches(p, url)).sort((a, b) => rank(a) - rank(b) || (b.used || b.changed || b.added || 0) - (a.used || a.changed || a.added || 0))
    .map(({ id, user, host, url: u }) => ({ id, user, host, url: u || '' }));
}

function add({ url, user, pass }) {
  if (!safeStorage.isEncryptionAvailable() || !pass) return false;
  const host = hostOf(url), site = siteOf(host);
  if (!site) return false;
  const list = all();
  // Gleicher Eintrag nur bei derselben Seite – bei Hosting-Diensten nur beim selben Host (nichts quer überschreiben)
  const same = list.find((p) => p.site === site && p.user === (user || '') && (!sharedSite(site) || noWww(p.host) === noWww(host)));
  if (same) { same.pass = enc(pass); same.changed = Date.now(); same.host = host; same.url = cleanUrl(url) || same.url; }
  else list.push({ id: crypto.randomUUID(), site, host, url: cleanUrl(url), user: user || '', pass: enc(pass), added: Date.now() });
  save(list);
  return true;
}

function known(url, user, pass) {
  const site = siteOf(hostOf(url));
  return all().some((p) => p.site === site && matches(p, url) && p.user === (user || '') && dec(p.pass) === pass);
}

// Status einer abgeschickten Anmeldung: schon gleich gespeichert, gespeichert mit anderem Passwort (→ aktualisieren) oder neu.
function status(url, user, pass) {
  const site = siteOf(hostOf(url));
  const same = all().filter((p) => p.site === site && matches(p, url) && p.user === (user || ''));
  if (!same.length) return 'new';
  return same.some((p) => dec(p.pass) === pass) ? 'same' : 'update';
}
// Eintrag von Hand ändern (Einstellungen → Passwörter → Bearbeiten). Leeres Passwort = Passwort bleibt.
function update(id, { user, pass, url } = {}) {
  const list = all(); const p = list.find((x) => x.id === id);
  if (!p) return false;
  if (typeof user === 'string') p.user = user.trim();
  if (pass) p.pass = enc(pass);
  if (url) { const h = hostOf(url); const st = siteOf(h); if (st) { p.host = h; p.site = st; } }
  p.changed = Date.now();
  save(list);
  return true;
}
function remove(id) { save(all().filter((p) => p.id !== id)); }
// Mehrere auf einmal (02.11.2026: Mehrfachauswahl im Passwort-Tresor) – ein Speichervorgang, ein Sync-Abgleich.
function removeMany(ids) { const set = new Set((ids || []).map(String)); if (set.size) save(all().filter((p) => !set.has(String(p.id)))); }

// ---------- Windows Hello / Touch ID ----------
const HELLO = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'})[0]
function Await($op,$t){$task=$asTask.MakeGenericMethod($t).Invoke($null,@($op));$task.Wait(-1)|Out-Null;$task.Result}
$avail=Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if("$avail" -ne 'Available'){ "NA:$avail"; exit }
$r=Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('ImmoAdv Browser: Passwort freigeben')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
"$r"`;

function windowsHello() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(HELLO, 'utf16le').toString('base64')], { windowsHide: true, timeout: 120000 },
      (_err, out) => {
        const r = String(out || '').trim();
        if (r === 'Verified') return resolve({ ok: true });
        // Kein Windows Hello eingerichtet → Windows-Anmeldung ist der Schutz; ausdrücklich gemeldet
        if (r.startsWith('NA:')) return resolve({ ok: true, noBiometric: true });
        resolve({ ok: false });
      });
  });
}

async function unlock() {
  if (Date.now() < unlockedUntil) return { ok: true };
  let r = { ok: false };
  if (process.platform === 'win32') r = await windowsHello();
  else if (process.platform === 'darwin') {
    if (systemPreferences.canPromptTouchID()) {
      try { await systemPreferences.promptTouchID('Passwort freigeben'); r = { ok: true }; } catch { r = { ok: false }; }
    } else r = { ok: true, noBiometric: true };
  } else r = { ok: true, noBiometric: true };
  if (r.ok) unlockedUntil = Date.now() + 5 * 60 * 1000;
  return r;
}

async function reveal(id) {
  const p = all().find((x) => x.id === id);
  if (!p || !(await unlock()).ok) return null;
  return { user: p.user, pass: dec(p.pass) };
}

// ---------- Import (CSV aus Apple „Passwörter“, Google/Chrome, Edge, Firefox) ----------
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { added: 0, skipped: 0 };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const iu = col('url', 'website', 'login_uri', 'web site'), iuser = col('username', 'login', 'login_username', 'benutzername'), ip = col('password', 'login_password', 'passwort');
  if (iu < 0 || ip < 0) return { added: 0, skipped: rows.length - 1, error: 'Unbekanntes Format – bitte als CSV aus „Passwörter“ (Mac/iPhone) oder Google exportieren.' };
  let added = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    const url = (r[iu] || '').trim(), pass = r[ip] || '', user = iuser >= 0 ? (r[iuser] || '').trim() : '';
    if (url && pass && add({ url, user, pass })) added++; else skipped++;
  }
  return { added, skipped };
}

// ---------- Geräte-Abgleich (launcher/sync.js) ----------
// Klartext verlässt dieses Programm nur Ende-zu-Ende-verschlüsselt mit dem Sync-Schlüssel (AES-256-GCM).
function plainEntries() {
  const out = [];
  for (const p of all()) { const pass = dec(p.pass); if (pass != null) out.push({ id: p.id, site: p.site, host: p.host, url: p.url || '', user: p.user || '', pass, changed: p.changed || p.added || 0 }); }
  return out;
}
function applySync(b, deleted) {
  if (!b || !b.site || !safeStorage.isEncryptionAvailable()) return;
  const list = all();
  const i = list.findIndex((p) => p.site === b.site && (p.user || '') === (b.user || '') && (!sharedSite(b.site) || noWww(p.host) === noWww(b.host)));
  if (deleted) { if (i >= 0) { list.splice(i, 1); save(list); } return; }
  if (!b.pass) return;
  if (i >= 0) { if (dec(list[i].pass) === b.pass) return; list[i] = { ...list[i], pass: enc(b.pass), url: b.url || list[i].url, changed: Number(b.changed) || Date.now() }; }
  else list.push({ id: crypto.randomUUID(), site: b.site, host: b.host || b.site, url: b.url || '', user: b.user || '', pass: enc(b.pass), added: Date.now(), changed: Number(b.changed) || Date.now() });
  save(list);
}

module.exports = { removeMany, status, update, matches, plainEntries, applySync,
  forUrl, add, known, remove, unlock, reveal, importCSV,
  list: () => all().map(({ id, site, host, url, user, added }) => ({ id, site, host, url: url || '', user, added })),
  /** Für das Ausfüllen: Passwort erst nach Freigabe */
  // Ausfüllen ohne Windows Hello / Touch ID (Feray 02.11.2026: „nur dort, wo Passkeys sind“) – Anzeigen und Kopieren in
  // den Einstellungen bleiben geschützt. Wer es strenger will: Einstellung „helloForFill“.
  async credentialsFor(id) {
    if (store.get('helloForFill') === true) return reveal(id);
    const p = all().find((x) => x.id === id);
    return p ? { user: p.user, pass: dec(p.pass) } : null;
  },
  // 04.11.2026 (Feray: „muss sofort ausfüllen, wenn ich drücke“): Schlüssel schon beim Antippen des Anmeldefelds aus dem
  // Schlüsselbund holen (nur entschlüsseln, nichts herausgeben) – der Klick auf einen Eintrag füllt dann ohne Wartezeit aus.
  warm() { const p = all()[0]; if (p) dec(p.pass); return true; },
  available: () => safeStorage.isEncryptionAvailable()
};
