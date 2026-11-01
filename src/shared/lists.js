// Filterlisten lesen – eine Implementierung für Build-Skript (Node) und Browser (Tagesaktualisierung).

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/;

// Domains, die nie gesperrt werden dürfen, auch wenn eine Liste sie fälschlich enthält
const NEVER = ['google.com', 'google.de', 'gstatic.com', 'googleapis.com', 'apple.com', 'icloud.com', 'microsoft.com',
  'live.com', 'github.com', 'githubusercontent.com', 'immoadv.de', 'nordvpn.com'];

/** Eine Zeile (Domain-, Hosts-, dnsmasq- oder ||domain^-Format) → Domain oder null */
function parseLine(line) {
  let s = String(line).trim().toLowerCase();
  if (!s || s.startsWith('#') || s.startsWith('!') || s.startsWith('[')) return null;
  s = s.replace(/\s+#.*$/, '');
  const dm = /^(?:local|address|server)=\/([^/]+)\//.exec(s);
  if (dm) s = dm[1];
  const parts = s.split(/\s+/);
  if (parts.length === 2 && /^(0\.0\.0\.0|127\.0\.0\.1|::1?)$/.test(parts[0])) s = parts[1];
  else if (parts.length > 1) return null;
  if (s.startsWith('||') && s.endsWith('^')) s = s.slice(2, -1);
  if (s.startsWith('*.')) s = s.slice(2);
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (s === 'localhost' || s.endsWith('.local') || /^\d+\.\d+\.\d+\.\d+$/.test(s)) return null;
  return DOMAIN_RE.test(s) ? s : null;
}

/** Liste einlesen; Subdomains bereits gelisteter Domains fallen weg (Treffer gelten ohnehin für alle Subdomains) */
function parseList(text, never = NEVER) {
  const set = new Set();
  for (const line of String(text).split(/\r?\n/)) { const d = parseLine(line); if (d) set.add(d); }
  const keep = [];
  for (const d of set) {
    const labels = d.split('.');
    let covered = false;
    for (let i = 1; i < labels.length - 1; i++) if (set.has(labels.slice(i).join('.'))) { covered = true; break; }
    if (!covered && !never.some((n) => d === n || n.endsWith('.' + d))) keep.push(d);
  }
  return keep.sort();
}

/** Benutzer-Eingabe → reine Domain („https://www.Beispiel.de/x“ → „beispiel.de“) */
function cleanDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  try { if (!/^[a-z]+:\/\//.test(s)) s = 'https://' + s; s = new URL(s).hostname; } catch { return null; }
  if (s.startsWith('www.')) s = s.slice(4);
  return DOMAIN_RE.test(s) ? s : null;
}

// Häufige zweistufige Endungen, damit z. B. „bbc.co.uk“ als eine Seite zählt
const SECOND = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.tr', 'org.tr', 'gen.tr', 'com.au', 'co.at', 'or.at', 'co.jp', 'com.br', 'co.nz', 'co.za', 'com.cn', 'com.mx', 'com.ua', 'co.in', 'co.kr', 'co.il', 'com.sg', 'com.ar', 'com.hk', 'com.tw', 'co.id', 'com.my', 'com.ph', 'com.pl', 'com.es', 'com.gr', 'co.th', 'com.vn', 'com.eg', 'com.sa', 'co.ke', 'com.ng']);
// Hosting-Dienste, unter denen jede Subdomain einem anderen Betreiber gehört (Passwörter nie quer ausfüllen, Prüfung 01.11.2026)
const SHARED = new Set(['vercel.app', 'github.io', 'netlify.app', 'herokuapp.com', 'web.app', 'firebaseapp.com', 'blogspot.com', 'pages.dev', 'workers.dev', 'azurewebsites.net', 'cloudfront.net', 'appspot.com', 'onrender.com', 'fly.dev', 'glitch.me', 'wordpress.com', 'wixsite.com', 'ngrok.io', 'ngrok-free.app', 'github.dev', 'gitlab.io', 'surge.sh', 'now.sh', 'repl.co', 'replit.app', 'myshopify.com', 'squarespace.com', 'webflow.io', 'carrd.co', 'framer.app', 'notion.site', 'amplifyapp.com', 'azurestaticapps.net', 'railway.app', 'deno.dev', 'supabase.co', 'cloudflareaccess.com', 'jimdosite.com', 'weebly.com', 'tumblr.com', 'substack.com', 'hubspotpagebuilder.com']);
/** Gehört die „Seite“ zu einem Hosting-Dienst mit fremden Subdomains? */
const sharedSite = (site) => SHARED.has(String(site || '').toLowerCase());
/** Hostname → Seite (registrierbare Domain, vereinfacht) */
function siteOf(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return h;
  const p = h.split('.');
  if (p.length <= 2) return h;
  const last2 = p.slice(-2).join('.');
  return SECOND.has(last2) ? p.slice(-3).join('.') : last2;
}

/** Liegt host in einer der Domains (inkl. Subdomains)? */
function inSet(set, host) {
  let h = String(host || '').toLowerCase();
  while (h) {
    if (set.has(h)) return true;
    const i = h.indexOf('.');
    if (i < 0) return false;
    h = h.slice(i + 1);
  }
  return false;
}

module.exports = { sharedSite, NEVER, parseLine, parseList, cleanDomain, siteOf, inSet };
