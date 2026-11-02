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
  const WINDOW = 45 * 60000;     // so lange nach der Auswahl wird eine passende Übertragung zugeordnet

  const on = () => Settings.get('uploadHistory') !== false;

  async function selected(m, sender) {
    if (!on() || !sender || !sender.tab) return false;
    const tab = sender.tab;
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
      for (const p of live) {
        if (p.size > 0 && bytes >= p.size * 0.98 && bytes <= p.size * 1.25 + 65536) hits.add(p.id);   // Datei als Rohdaten (fetch/XHR)
      }
      if (!hits.size && fileParts && live.length === 1) hits.add(live[0].id);                       // genau eine Datei offen, Anfrage trägt eine Datei
    }
    return [...hits];
  }

  function init() {
    const filter = { urls: ['http://*/*', 'https://*/*'] };
    browser.webRequest.onBeforeRequest.addListener((d) => {
      if (d.tabId < 0 || !/^(POST|PUT|PATCH)$/.test(d.method)) return;
      const ids = match(d);
      if (!ids.length) return;
      inflight.set(d.requestId, ids);
      status(ids, 'TRANSFER_STARTED', d.requestId);
    }, filter, ['requestBody']);
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
