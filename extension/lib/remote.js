// Claude-Connector (05.11.2026, Feray: „MCP wie einen eigenen Connector, den ich verbinden kann“).
// Ist unter Einstellungen → KI „Claude darf diesen Browser steuern“ an, fragt dieser Browser bei immoadv.de nach Aufträgen
// von Claude (mit der Anmeldung des ImmoAdv-Kontos aus Sync) und führt sie aus. Regeln:
//  - Claude steuert nur Tabs, die Claude selbst geöffnet hat oder die Feray über das ImmoAdv-Menü „Mit Claude teilen“ freigibt.
//  - Banken, Zahlungsdienste, Konto- und Behördenseiten und interne Adressen sind gesperrt (wie auf dem Server).
//  - Passwort- und Zahlungsfelder werden nie ausgefüllt.
//  - Ein Hinweis oben auf der Seite zeigt, dass Claude den Tab steuert.
'use strict';
const Remote = (() => {
  const API = 'https://immoadv.de/api/browser/remote';
  const BLOCK = /(^|\.)(paypal\.[a-z.]+|klarna\.[a-z.]+|stripe\.com|wise\.com|revolut\.com|n26\.com|dkb\.de|ing\.de|comdirect\.de|consorsbank\.de|commerzbank\.de|deutsche-bank\.de|db\.com|postbank\.de|hypovereinsbank\.de|targobank\.de|santander\.de|norisbank\.de|sparda[a-z-]*\.de|psd[a-z-]*\.de|vr\.de|volksbank[a-z-]*\.de|raiffeisen[a-z-]*\.de|sparkasse[a-z-]*\.de|[a-z-]*sparkasse\.de|kfw\.de|elster\.de|bundesagentur\.de|arbeitsagentur\.de|deutsche-rentenversicherung\.de|bund\.de|trade-republic\.com|traderepublic\.com|scalable\.capital|coinbase\.com|binance\.com|kraken\.com|bitpanda\.com|1password\.com|bitwarden\.com|lastpass\.com|accounts\.google\.com|myaccount\.google\.com|account\.microsoft\.com|account\.live\.com|appleid\.apple\.com|id\.apple\.com|icloud\.com|hanseaticbank\.de|barclaycard\.de|barclays\.[a-z.]+|1822direkt\.de|c24\.de|bunq\.com|mercury\.com|chase\.com|amex\.[a-z.]+|americanexpress\.com|advanzia\.com|consors[a-z-]*\.de|ebase\.com|flatex\.[a-z.]+|smartbroker\.de|onvista\.de|finanzen\.net|login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com|portal\.azure\.com|aka\.ms|finanzamt[a-z-]*\.de|bzst\.de|zoll\.de|bundesfinanzministerium\.de|[a-z.-]*\.gov|[a-z.-]*\.gov\.[a-z]+|dash\.cloudflare\.com|cloudflareaccess\.com|supabase\.com|supabase\.co|vercel\.com|stripe\.network|contabo\.com|my\.contabo\.com|hostinger\.[a-z.]+|admin\.immoadv\.de|git\.immoadv\.de|approval\.immoadv\.de|db\.immoadv\.de|outlook\.office\.com|outlook\.live\.com|outlook\.office365\.com|mail\.google\.com|web\.de|gmx\.[a-z.]+|t-online\.de|posteo\.de|mailbox\.org|proton\.me|protonmail\.com|fritz\.box|[a-z0-9.-]*\.local|[a-z0-9.-]*\.internal|[a-z0-9.-]*\.lan|[a-z0-9.-]*\.home\.arpa)$/i;
  const BANKWORD = /(^|[.-])(bank|banking|sparkasse|volksbank|onlinebanking|broker|depot)([.-]|$)/i;
  let on = false, running = false, stopCtl = null, auth = null, status = { state: 'aus', message: '', last: 0, device: '' };
  const mine = new Set();   // Tabs, die Claude steuern darf
  const setStatus = (p) => { status = { ...status, ...p }; try { browser.runtime.sendMessage({ type: 'remote:changed', status }).catch(() => {}); } catch (e) { /* keine Seite offen */ } };

  function allowedUrl(u) {
    let x; try { x = new URL(u); } catch (e) { return false; }
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return false;
    const h = x.hostname.toLowerCase();
    if (BLOCK.test(h) || BANKWORD.test(h)) return false;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) || !h.includes('.')) return false; // Audit B04: auch 0.x, CGNAT 100.64/10, Namen ohne Punkt
    return true;
  }

  async function token() {
    if (auth && auth.until > Date.now()) return auth;
    const t = await Native.call('remote.token', {}, 20000);   // { access, device, name }
    auth = { ...t, until: Date.now() + 4 * 60 * 1000 };
    return auth;
  }
  async function api(body, signal) {
    const a = await token();
    const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.access}` }, body: JSON.stringify({ device: a.device, ...body }), signal, credentials: 'omit', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { auth = null; throw Object.assign(new Error(j.error || 'Bitte im Browser unter Einstellungen → Sync mit dem ImmoAdv-Konto anmelden.'), { status: 401 }); }
    if (!r.ok) throw new Error(j.error || `Server ${r.status}`);
    return j;
  }

  // ---------- Ausführen ----------
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function loaded(tabId, ms = 15000) {
    const end = Date.now() + ms;
    await wait(250);
    while (Date.now() < end) { const t = await browser.tabs.get(tabId).catch(() => null); if (!t) throw new Error('Tab wurde geschlossen'); if (t.status === 'complete') return t; await wait(250); }
    return browser.tabs.get(tabId);
  }
  async function ownTab(id) {
    const t = await browser.tabs.get(id).catch(() => null);
    if (!t) throw new Error(`Tab ${id} gibt es nicht (mehr).`);
    if (!mine.has(id)) throw new Error(`Tab ${id} hat Claude nicht geöffnet. Feray kann ihn über das ImmoAdv-Menü „Mit Claude teilen“ freigeben – oder browser_open nutzen.`);
    if (t.url && /^https?:/.test(t.url) && !allowedUrl(t.url)) throw new Error('Diese Seite ist für Claude gesperrt (Bank, Zahlung, Konto oder Behörde).');
    return t;
  }
  async function inPage(tabId, msg) {
    const t = await browser.tabs.get(tabId);
    if (!/^https?:/.test(t.url || '')) throw new Error('Auf dieser Seite (Browser-intern) kann Claude nichts lesen oder steuern.');
    // Audit B03 (10.11.2026): Adresse direkt vor dem Ausführen erneut prüfen – die Seite kann seit ownTab() umgeleitet haben.
    if (!allowedUrl(t.url)) throw new Error('Diese Seite ist für Claude gesperrt (Bank, Zahlung, Konto oder Behörde).');
    // Die Seite prüft selbst, ob sie noch auf der geprüften Adresse ist (sonst Abbruch, content/remote.js).
    const m2 = { immoadvRemote: true, ...msg, host: new URL(t.url).hostname };
    let r = await browser.tabs.sendMessage(tabId, m2).catch(() => undefined);
    if (r === undefined) { await browser.tabs.executeScript(tabId, { file: '/content/remote.js', runAt: 'document_idle' }); r = await browser.tabs.sendMessage(tabId, m2); }
    if (r && r.error) throw new Error(r.error);
    return r;
  }
  const info = (t) => ({ tab: t.id, title: t.title || '', url: t.url || '', active: !!t.active, claude: mine.has(t.id) });

  const TOOLS = {
    async browser_tabs() { const ts = await browser.tabs.query({}); return { tabs: ts.filter((t) => /^https?:|^about:blank|^moz-extension:/.test(t.url || '')).map(info) }; },
    async browser_open(a) {
      if (!allowedUrl(a.url)) throw new Error('Diese Adresse ist für Claude gesperrt.');
      const t = await browser.tabs.create({ url: a.url, active: true });
      mine.add(t.id); save();
      const d = await loaded(t.id);
      if (d.url && /^https?:/.test(d.url) && !allowedUrl(d.url)) { await browser.tabs.remove(t.id).catch(() => {}); throw new Error('Die Seite hat auf eine gesperrte Adresse weitergeleitet – Tab geschlossen.'); }
      await inPage(t.id, { op: 'mark' }).catch(() => {});
      return info(d);
    },
    async browser_navigate(a) {
      await ownTab(a.tab);
      if (a.url === 'back') await browser.tabs.goBack(a.tab);
      else if (a.url === 'forward') await browser.tabs.goForward(a.tab);
      else if (a.url === 'reload') await browser.tabs.reload(a.tab);
      else { if (!allowedUrl(a.url)) throw new Error('Diese Adresse ist für Claude gesperrt.'); await browser.tabs.update(a.tab, { url: a.url }); }
      const d = await loaded(a.tab);
      if (d.url && /^https?:/.test(d.url) && !allowedUrl(d.url)) throw new Error('Gesperrte Seite erreicht – hier macht Claude nicht weiter.');
      await inPage(a.tab, { op: 'mark' }).catch(() => {});
      return info(d);
    },
    async browser_read(a) { const t = await ownTab(a.tab); const r = await inPage(a.tab, { op: 'read', maxChars: a.maxChars }); return { ...info(t), ...r }; },
    async browser_screenshot(a) {
      const t = await ownTab(a.tab);
      if (!t.active) { await browser.tabs.update(a.tab, { active: true }); await wait(350); }
      const url = await browser.tabs.captureTab(a.tab, { format: 'jpeg', quality: 70 });
      return { image: String(url).replace(/^data:image\/\w+;base64,/, ''), mime: 'image/jpeg', title: t.title, url: t.url };
    },
    async browser_click(a) { await ownTab(a.tab); const r = await inPage(a.tab, { op: 'click', ref: a.ref }); await wait(600); const d = await loaded(a.tab, 8000).catch(() => null); return { ...r, url: d && d.url, title: d && d.title }; },
    async browser_type(a) { await ownTab(a.tab); const r = await inPage(a.tab, { op: 'type', ref: a.ref, text: a.text, enter: a.enter }); if (a.enter) { await wait(600); await loaded(a.tab, 8000).catch(() => null); } return r; },
    async browser_scroll(a) { await ownTab(a.tab); return inPage(a.tab, { op: 'scroll', direction: a.direction, pages: a.pages }); },
    async browser_close(a) { await ownTab(a.tab); await browser.tabs.remove(a.tab); mine.delete(a.tab); save(); return { closed: a.tab }; }
  };

  async function run(cmd) {
    const fn = TOOLS[cmd.tool];
    browser.browserAction.setBadgeText({ text: '✦' }).catch(() => {});
    browser.browserAction.setBadgeBackgroundColor({ color: '#1E6FD9' }).catch(() => {});
    try {
      if (!fn) throw new Error('Unbekanntes Werkzeug');
      const result = await Promise.race([fn(cmd.args || {}), wait(40000).then(() => { throw new Error('Zeitüberschreitung im Browser'); })]);
      await api({ action: 'result', id: cmd.id, ok: true, result });
    } catch (e) {
      await api({ action: 'result', id: cmd.id, ok: false, error: String((e && e.message) || e).slice(0, 480) }).catch(() => {});
    } finally { setTimeout(() => browser.browserAction.setBadgeText({ text: '' }).catch(() => {}), 1500); }
  }

  async function loop() {
    if (running) return; running = true;
    let fails = 0;
    while (on) {
      stopCtl = new AbortController();
      try {
        const a = await token();
        if (status.state !== 'bereit') setStatus({ state: 'bereit', message: '', device: a.name || '' });
        const j = await api({ action: 'poll', name: a.name || 'ImmoAdv Browser' }, stopCtl.signal);
        fails = 0; status.last = Date.now();
        if (j.cmd) run(j.cmd);   // nicht abwarten – sofort weiter abfragen
        else if (j.wait) await wait(j.wait * 1000);
      } catch (e) {
        if (!on) break;
        fails++;
        setStatus({ state: e.status === 401 || /anmelden|Sync/i.test(e.message) ? 'anmelden' : 'fehler', message: String((e && e.message) || e) });
        await wait(Math.min(60000, 2000 * Math.pow(2, Math.min(fails, 5))));
      }
    }
    running = false;
  }

  // Audit B02 (10.11.2026): Freigaben nur für diese Browser-Sitzung merken (storage.session, Firefox ≥ 115). Tab-Nummern
  // werden nach jedem Neustart neu vergeben – aus storage.local wiederhergestellt, durfte Claude danach fremde Tabs steuern.
  const sess = () => (browser.storage && browser.storage.session) || null;
  async function save() { try { const s = sess(); if (s) await s.set({ remoteTabs: [...mine] }); } catch (e) { /* egal */ } }
  async function apply(enabled) {
    enabled = !!enabled;
    if (enabled === on) return;
    on = enabled;
    if (on) { setStatus({ state: 'verbindet', message: '' }); loop(); }
    else {
      try { if (stopCtl) stopCtl.abort(); } catch (e) { /* egal */ }
      api({ action: 'off' }).catch(() => {});
      setStatus({ state: 'aus', message: '' });
    }
  }
  browser.tabs.onRemoved.addListener((id) => { if (mine.delete(id)) save(); });
  (async () => {
    try { browser.storage.local.remove('remoteTabs').catch(() => {}); } catch (e) { /* alter Stand aus storage.local nie übernehmen */ }
    try { const st = sess(); if (!st) return; const s = await st.get('remoteTabs'); const open = new Set((await browser.tabs.query({})).map((t) => t.id)); for (const id of s.remoteTabs || []) if (open.has(id)) mine.add(id); } catch (e) { /* egal */ }
  })();

  return {
    apply,
    status: () => ({ ...status, on }),
    shared: (id) => mine.has(id),
    async share(id, yes) { if (yes) { const t = await browser.tabs.get(id); if (!allowedUrl(t.url || '')) throw new Error('Diese Seite kann nicht geteilt werden.'); mine.add(id); inPage(id, { op: 'mark' }).catch(() => {}); } else { mine.delete(id); browser.tabs.sendMessage(id, { immoadvRemote: true, op: 'unmark' }).catch(() => {}); } save(); return mine.has(id); },
    async connections() { return api({ action: 'status' }); },
    async disconnect() { const r = await api({ action: 'disconnect' }); return r; },
    allowedUrl
  };
})();
