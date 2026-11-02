// Upload-Verlauf (Wunsch Feray 02.11.2026): merkt sich, welche Datei auf welcher Seite zum Hochladen ausgewählt wurde.
// Erkennt Dateiauswahl über <input type="file"> (auch Mehrfachauswahl und in iFrames) und Drag & Drop auf Upload-Flächen.
// Liest die Datei NUR lokal, um den SHA-256-Fingerabdruck zu bilden – nichts von der Datei wird gespeichert oder gesendet,
// nur Name, Größe, Typ und Fingerabdruck gehen an den eigenen Browser-Hintergrund. Die Seite selbst wird nicht verändert.
'use strict';
(() => {
  if (window.__immoadvUploads) return; window.__immoadvUploads = true;
  const send = (m) => browser.runtime.sendMessage(m).catch(() => null);
  let enabled = null;
  const recent = new Map();   // Fingerabdruck → Zeit (eine Auswahl löst oft mehrere change-Ereignisse aus)

  async function isOn() {
    if (enabled === null) enabled = (await send({ type: 'upload:enabled' })) !== false;
    return enabled;
  }

  async function handle(files, via) {
    const list = Array.from(files || []).filter((f) => f && typeof f.size === 'number').slice(0, 50);
    if (!list.length || !(await isOn())) return;
    const out = [];
    for (const f of list) {
      let sha256 = '';
      try { sha256 = await self.ImmoSha256.hashBlob(f); } catch (e) { sha256 = ''; }   // nicht lesbar → kein Hash (nie erfunden)
      const k = `${sha256 || f.name}|${f.size}`;
      const t = recent.get(k);
      if (t && Date.now() - t < 4000) continue;
      recent.set(k, Date.now());
      out.push({ name: f.name, size: f.size, mime: f.type || '', sha256, lastModified: f.lastModified || 0 });
    }
    if (out.length) send({ type: 'upload:selected', files: out, via, frameUrl: location.href, frameTitle: document.title });
  }

  // Dateiauswahl (auch versteckte Felder hinter „Datei hochladen“-Knöpfen)
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el && el.tagName === 'INPUT' && el.type === 'file' && el.files && el.files.length) handle(el.files, 'input');
  }, true);

  // Drag & Drop: nur zählen, wenn die Seite das Ablegen selbst übernimmt (Upload-Fläche) – sonst öffnet der Browser die Datei
  document.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt || !dt.files || !dt.files.length) return;
    const files = Array.from(dt.files);
    setTimeout(() => { if (e.defaultPrevented) handle(files, 'drop'); }, 0);
  }, true);

  browser.runtime.onMessage.addListener((m) => { if (m && m.type === 'upload:setting') enabled = m.on !== false; });
})();
