// Verlauf – nur auf diesem Computer, durchsuchbar, einzeln oder komplett löschbar, mit Aufbewahrungsfrist.
// Eigene Datei (verlauf.json), damit Einstellungen klein bleiben. Keine Formulardaten, keine Passwörter.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');
const store = require('./store');

const file = () => path.join(app.getPath('userData'), 'verlauf.json');
let items = null;
let saveTimer = null;
let readOnly = false;   // Datei gesperrt/beschädigt → nie mit leerem Verlauf überschreiben (Prüfung 01.11.2026)

function load() {
  if (items) return items;
  try { items = JSON.parse(fs.readFileSync(file(), 'utf8')); if (!Array.isArray(items)) items = []; }
  catch (e) { items = []; if (!e || e.code !== 'ENOENT') readOnly = true; }
  prune();
  return items;
}
let gen = 0;
function writeNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!items || readOnly) return;
  gen++;
  try {
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(items), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch { /* nicht kritisch */ }
}
// Beim Surfen im Hintergrund asynchron schreiben (kein Ruckeln im Hauptprozess); writeNow bleibt fürs Beenden.
let asyncBusy = false;
async function writeAsync() {
  saveTimer = null;
  if (!items || readOnly) return;
  asyncBusy = true;
  const my = gen;
  try { const tmp = file() + '.a.tmp'; await fs.promises.writeFile(tmp, JSON.stringify(items), { mode: 0o600 }); if (my !== gen) { await fs.promises.unlink(tmp).catch(() => {}); return; } await fs.promises.rename(tmp, file()); } catch { /* nicht kritisch */ } finally { asyncBusy = false; }
}
function persist() { if (!saveTimer) saveTimer = setTimeout(writeAsync, 3000); }
function prune() {
  const days = Number(store.get('historyDays'));
  if (!days) { if (items.length) { items = []; persist(); } return; }
  const min = Date.now() - days * 86400000;
  const before = items.length;
  items = items.filter((i) => i.t >= min).slice(-20000);
  if (items.length !== before) persist();
}

const enabled = () => Number(store.get('historyDays')) > 0;
const SKIP = /^https:\/\/(accounts\.google\.|appleid\.apple\.com|login\.)|[?&](token|code|password|pass|session|sid|auth)=/i;

function add(url, title) {
  if (!enabled() || !/^https?:/i.test(url) || SKIP.test(url)) return;
  load();
  const last = items[items.length - 1];
  if (last && last.url === url) { last.title = title || last.title; last.t = Date.now(); return persist(); }
  items.push({ id: crypto.randomUUID(), url, title: String(title || '').slice(0, 200), t: Date.now() });
  persist();
}

function setTitle(url, title) {
  if (!items || !title) return;
  const t = String(title).slice(0, 200);
  for (let i = items.length - 1; i >= Math.max(0, items.length - 5); i--) if (items[i].url === url) { if (items[i].title !== t) { items[i].title = t; persist(); } return; }
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Suche: Text (Titel/Adresse), Zeitraum (from/to ms), Seite (Domain) */
function search({ q = '', from = 0, to = Infinity, site = '' } = {}, limit = 300) {
  load();
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = items.length - 1; i >= 0 && out.length < limit; i--) {
    const it = items[i];
    if (it.t < from || it.t > to) continue;
    if (site && !hostOf(it.url).endsWith(site.replace(/^www\./, ''))) continue;
    const hay = (it.title + ' ' + it.url).toLowerCase();
    if (words.every((w) => hay.includes(w))) out.push(it);
  }
  return out;
}

/** Vorschläge für die Adressleiste: häufig + kürzlich besuchte Seiten, die zum Getippten passen */
function suggest(q, limit = 6) {
  load();
  const s = String(q).toLowerCase().trim();
  if (!s) return [];
  const score = new Map();
  for (let i = items.length - 1; i >= 0 && i > items.length - 5000; i--) {
    const it = items[i];
    const h = hostOf(it.url);
    const hit = h.startsWith(s) ? 3 : (it.title.toLowerCase().includes(s) || it.url.toLowerCase().includes(s)) ? 1 : 0;
    if (!hit) continue;
    const prev = score.get(it.url) || { url: it.url, title: it.title, score: 0 };
    prev.score += hit;
    score.set(it.url, prev);
  }
  return [...score.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function remove(ids) { load(); const set = new Set(ids); items = items.filter((i) => !set.has(i.id)); persist(); }
function clear(from = 0, to = Infinity) { load(); items = items.filter((i) => i.t < from || i.t > to); persist(); }

module.exports = { flush: () => { if (saveTimer || asyncBusy) writeNow(); }, add, setTitle, search, suggest, remove, clear, prune: () => { load(); prune(); }, count: () => load().length };
