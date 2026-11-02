// Upload-Verlauf im Hintergrund: Auswahl aus den Seiten annehmen, Datensatz an das ImmoAdv-Programm (speichert und gleicht
// verschlüsselt mit allen Geräten ab) und den Übertragungsstand ehrlich mitverfolgen:
//  – SELECTED: Datei wurde auf der Seite ausgewählt (noch keine Aussage, ob sie gesendet wurde)
//  – TRANSFER_STARTED / TRANSFER_COMPLETED / FAILED: nur, wenn eine Anfrage dieses Tabs die Datei erkennbar mitschickt
//    (Dateiname im Formular oder passende Größe) und der Server antwortet
//  – SERVER_ACKNOWLEDGED wird nie geraten (eine erfolgreiche Übertragung ist keine Bestätigung der Bewerbung)
'use strict';
const UploadTrack = (() => {
  const pending = new Map();     // tabId → [{ id, name, size, at }]
  const inflight = new Map();    // requestId → [eventIds]
  const WINDOW = 45 * 60000;     // Dateiname im Formular: so lange nach der Auswahl zuordnen
  const SIZE_WINDOW = 10 * 60000; // nur Größe (Rohdaten): kürzer, damit fremde Anfragen nicht zufällig passen

  const on = () => Settings.get('uploadHistory') !== false;

  async function selected(m, sender) {
    if (!on() || !sender || !sender.tab) return false;
    const tab = sender.tab;
    if (tab.incognito) return false;   // private Fenster: nichts speichern, nichts abgleichen
    // Adresse und Titel der Seite kommen vom Browser (Tab), nicht von der Seite; iFrame-Adresse nur als Ergänzung
    const topUrl = /^https?:/.test(tab.url || '') ? tab.url : (m.frameUrl || '');
    const frameHost = ImmoUploads.host(m.frameUrl);
    const recs = [];
    for (const f of (Array.isArray(m.files) ? m.files : []).slice(0, 50)) {
      const r = ImmoUploads.record({ id: crypto.randomUUID(), file: f, pageUrl: topUrl, pageTitle: tab.title || '', at: Date.now() });
      // Bewerber-Formular im iFrame eines anderen Anbieters (z. B. Personio in der Firmenseite): dessen Portal nehmen,
      // die Firmenseite bleibt als Domain/Adresse erhalten.
      if (frameHost && frameHost !== r.domain) {
        const d = ImmoUploads.detect(m.frameUrl);
        if (d.portal !== frameHost) { r.portal = d.portal; if (d.employer) r.employer = d.employer; }
        r.frame = frameHost;
      }
      r.via = m.via === 'drop' ? 'drop' : 'input';
      recs.push(r);
    }
    if (!recs.length) return false;
    try { await Native.call('uploads.add', { recs }); } catch (e) { console.warn('[ImmoAdv] Upload-Verlauf: Programm nicht erreichbar', e.message); return false; }
    const list = (pending.get(tab.id) || []).filter((p) => Date.now() - p.at < WINDOW);
    for (const r of recs) list.push({ id: r.id, name: r.name, size: r.size, at: r.at });
    pending.set(tab.id, list.slice(-50));
    listen();
    return true;
  }

  function status(ids, st, transport) {
    if (!ids.length) return;
    Native.call('uploads.status', { ids, status: st, transport: transport || '' }).catch(() => {});
  }

  // Schickt diese Anfrage eine der ausgewählten Dateien mit?
  function match(details) {
    const list = pending.get(details.tabId);
    if (!list || !list.length) return [];
    const now = Date.now();
    const live = list.filter((p) => now - p.at < WINDOW);
    if (!live.length) return [];
    const body = details.requestBody;
    if (!body) return [];
    const hits = new Set();
    if (body.formData) {
      const vals = new Set();
      for (const arr of Object.values(body.formData)) for (const v of arr || []) vals.add(String(v));
      for (const p of live) if (vals.has(p.name)) hits.add(p.id);
    }
    if (body.raw && body.raw.length) {
      let bytes = 0, fileParts = 0;
      for (const part of body.raw) { if (part.bytes) bytes += part.bytes.byteLength; if (part.file) fileParts++; }
      const fresh = live.filter((p) => now - p.at < SIZE_WINDOW);
      // Datei als Rohdaten (fetch/XHR): Größe muss fast genau passen (kleine Dateien nicht mit beliebigen Anfragen verwechseln)
      for (const p of fresh) if (p.size > 0 && bytes >= p.size && bytes <= p.size * 1.02 + 2048) hits.add(p.id);
      if (!hits.size && fileParts === 1 && fresh.length === 1) hits.add(fresh[0].id);   // genau eine Datei offen, Anfrage trägt genau eine Datei
    }
    // Zugeordnete Dateien nicht ein zweites Mal mit einer anderen Anfrage verbinden
    if (hits.size) pending.set(details.tabId, list.filter((p) => !hits.has(p.id)));
    return [...hits];
  }

  // Anfrage-Inhalte nur mitlesen, solange eine Dateiauswahl offen ist (sonst kopiert Firefox jeden Upload in den Hintergrund)
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  let listening = false, sweep = 0;
  function onBefore(d) {
    if (d.tabId < 0 || !/^(POST|PUT|PATCH)$/.test(d.method)) return;
    const ids = match(d);
    if (!ids.length) return;
    inflight.set(d.requestId, ids);
    status(ids, 'TRANSFER_STARTED', d.requestId);
  }
  function listen() {
    if (listening) return;
    listening = true;
    browser.webRequest.onBeforeRequest.addListener(onBefore, filter, ['requestBody']);
    clearInterval(sweep);
    sweep = setInterval(() => {
      const now = Date.now();
      for (const [t, l] of pending) { const k = l.filter((p) => now - p.at < WINDOW); if (k.length) pending.set(t, k); else pending.delete(t); }
      if (!pending.size && !inflight.size) { browser.webRequest.onBeforeRequest.removeListener(onBefore); listening = false; clearInterval(sweep); }
    }, 60000);
    if (sweep && sweep.unref) sweep.unref();   // nur in Tests (Node) relevant
  }
  function init() {
    browser.webRequest.onCompleted.addListener((d) => {
      const ids = inflight.get(d.requestId); if (!ids) return;
      inflight.delete(d.requestId);
      status(ids, d.statusCode >= 200 && d.statusCode < 300 ? 'TRANSFER_COMPLETED' : 'FAILED', d.requestId);
    }, filter);
    browser.webRequest.onErrorOccurred.addListener((d) => {
      const ids = inflight.get(d.requestId); if (!ids) return;
      inflight.delete(d.requestId);
      status(ids, 'FAILED', d.requestId);
    }, filter);
    browser.tabs.onRemoved.addListener((id) => pending.delete(id));
  }

  return { init, selected, on };
})();
