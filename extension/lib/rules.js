// Gemeinsame Logik für Filterlisten → Chrome-Regeln (declarativeNetRequest).
// Wird vom Build-Skript (Node) UND von der Erweiterung (Tagesaktualisierung) benutzt –
// eine einzige Implementierung, keine doppelte Logik.

export const CHUNK = 1000;                 // Domains pro Regel
export const BLOCKED_PAGE = '/blocked.html';

// Ressourcen, die beim Seitenaufruf selbst entstehen – bei Malware/Phishing Warnseite statt Fehlerseite
const NAV = ['main_frame', 'sub_frame'];

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/;

/** Eine Zeile aus einer Liste (Domain-, Hosts- oder ||domain^-Format) → Domain oder null */
export function parseLine(line) {
  let s = String(line).trim().toLowerCase();
  if (!s || s.startsWith('#') || s.startsWith('!') || s.startsWith('[')) return null;
  s = s.replace(/\s+#.*$/, '');
  const parts = s.split(/\s+/);
  if (parts.length === 2 && /^(0\.0\.0\.0|127\.0\.0\.1|::1?)$/.test(parts[0])) s = parts[1];   // Hosts-Format
  else if (parts.length > 1) return null;
  if (s.startsWith('||') && s.endsWith('^')) s = s.slice(2, -1);                                 // AdBlock-Domainformat
  if (s.startsWith('*.')) s = s.slice(2);
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (s === 'localhost' || s.endsWith('.local') || /^\d+\.\d+\.\d+\.\d+$/.test(s)) return null;
  return DOMAIN_RE.test(s) ? s : null;
}

/** Liste einlesen, doppelte und überflüssige Subdomains entfernen (Regeln greifen ohnehin für alle Subdomains) */
export function parseList(text, never = []) {
  const set = new Set();
  for (const line of String(text).split(/\r?\n/)) { const d = parseLine(line); if (d) set.add(d); }
  const keep = [];
  for (const d of set) {
    let covered = false;
    const labels = d.split('.');
    for (let i = 1; i < labels.length - 1; i++) if (set.has(labels.slice(i).join('.'))) { covered = true; break; }
    if (!covered && !never.some((n) => d === n || n.endsWith('.' + d))) keep.push(d);
  }
  return keep.sort();
}

function chunks(arr, n = CHUNK) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

/**
 * Regeln für eine Kategorie bauen.
 * kind 'werbung': Anfragen an Werbe-/Tracker-Domains blockieren (nicht den Seitenaufruf selbst – Seiten bleiben bedienbar).
 * kind 'malware' | 'phishing': Seitenaufruf → ImmoAdv-Warnseite, alles andere blockieren.
 */
export function buildRules(domains, kind, startId = 1) {
  const rules = [];
  let id = startId;
  for (const part of chunks(domains)) {
    if (kind === 'werbung') {
      rules.push({ id: id++, priority: 1, action: { type: 'block' }, condition: { requestDomains: part, excludedResourceTypes: ['main_frame'] } });
    } else {
      rules.push({ id: id++, priority: 2, action: { type: 'redirect', redirect: { extensionPath: `${BLOCKED_PAGE}#${kind}` } }, condition: { requestDomains: part, resourceTypes: NAV } });
      rules.push({ id: id++, priority: 2, action: { type: 'block' }, condition: { requestDomains: part, excludedResourceTypes: NAV } });
    }
  }
  return rules;
}

/** Benutzer eingegebene Adresse → reine Domain (z. B. „https://www.Beispiel.de/x“ → „beispiel.de“) */
export function cleanDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  try { if (!/^[a-z]+:\/\//.test(s)) s = 'https://' + s; s = new URL(s).hostname; } catch { return null; }
  if (s.startsWith('www.')) s = s.slice(4);
  return DOMAIN_RE.test(s) ? s : null;
}

// Domains, die nie gesperrt werden dürfen, auch wenn eine Liste sie fälschlich enthält
export const NEVER = ['google.com', 'google.de', 'gstatic.com', 'googleapis.com', 'apple.com', 'icloud.com', 'microsoft.com', 'live.com', 'github.com', 'immoadv.de'];

// Bereiche der dynamischen Regel-IDs
export const IDS = { allow: 1, block: 5001, fresh: 10001 };
