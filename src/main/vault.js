// ImmoAdv-Passwort-Tresor: speichern, automatisch ausfüllen, importieren (iCloud/Google/Chrome-Export).
// Jedes Passwort einzeln mit der Systemverschlüsselung (Windows: DPAPI, Mac: Schlüsselbund) – nie Klartext.
// Freigabe zum Ausfüllen/Anzeigen mit Windows Hello bzw. Touch ID (danach 5 Minuten ohne erneute Abfrage).
const { safeStorage, systemPreferences } = require('electron');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const store = require('./store');
const { siteOf } = require('../shared/lists');

let unlockedUntil = 0;

const enc = (text) => safeStorage.encryptString(String(text)).toString('base64');
const dec = (b64) => { try { return safeStorage.decryptString(Buffer.from(b64, 'base64')); } catch { return null; } };
const hostOf = (u) => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u).hostname.toLowerCase(); } catch { return ''; } };

function all() { return store.get('passwords') || []; }
function save(list) { store.set('passwords', list); }

/** Einträge für eine Seite (gleiche registrierbare Domain), ohne Passwörter */
function forUrl(url) {
  const site = siteOf(hostOf(url));
  if (!site) return [];
  return all().filter((p) => p.site === site).map(({ id, user, host }) => ({ id, user, host }));
}

function add({ url, user, pass }) {
  if (!safeStorage.isEncryptionAvailable() || !pass) return false;
  const host = hostOf(url), site = siteOf(host);
  if (!site) return false;
  const list = all();
  const same = list.find((p) => p.site === site && p.user === (user || ''));
  if (same) { same.pass = enc(pass); same.changed = Date.now(); }
  else list.push({ id: crypto.randomUUID(), site, host, user: user || '', pass: enc(pass), added: Date.now() });
  save(list);
  return true;
}

function known(url, user, pass) {
  const site = siteOf(hostOf(url));
  return all().some((p) => p.site === site && p.user === (user || '') && dec(p.pass) === pass);
}

function remove(id) { save(all().filter((p) => p.id !== id)); }

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

module.exports = {
  forUrl, add, known, remove, unlock, reveal, importCSV,
  list: () => all().map(({ id, site, host, user, added }) => ({ id, site, host, user, added })),
  /** Für das Ausfüllen: Passwort erst nach Freigabe */
  async credentialsFor(id) { return reveal(id); },
  available: () => safeStorage.isEncryptionAvailable()
};
