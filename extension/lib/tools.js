// Browser-Werkzeuge: Seite als PDF speichern und Ganzseiten-Bildschirmfoto (mit Markieren und Schwärzen).
// 05.11.2026 (Feray): Arbeitsbereiche, „Später ansehen“, Firmendaten-Formulare und Belege an ImmoAdv Steuern entfernt.
'use strict';
const Tools = (() => {
  const shots = new Map();      // id → { data, w, h, title, url } – nur bis die Bearbeiten-Seite sie abholt
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Seite';

  function note(title, message) {
    browser.notifications.create({ type: 'basic', iconUrl: browser.runtime.getURL('icons/icon128.png'), title, message }).catch(() => {});
  }

  // ---------- 1. Seite als PDF ----------
  // Firefox öffnet dabei immer den Speichern-Dialog (Ordner und Dateiname frei wählbar).
  // 05.11.2026: hieß vorher saveAsPdf (falsch geschrieben) – der Menüpunkt tat deshalb gar nichts.
  async function savePdf(tab) {
    // Mac (05.11.2026): Firefox bietet saveAsPDF am Mac nicht an – dort der Druckdialog von macOS, unten links „PDF“ →
    // „Als PDF sichern …“ (Ordner und Name frei wählbar).
    const mac = (await browser.runtime.getPlatformInfo().catch(() => ({}))).os === 'mac';
    if (mac || typeof browser.tabs.saveAsPDF !== 'function') {
      note('Als PDF speichern', 'Im Druckfenster unten links „PDF“ → „Als PDF sichern …“ wählen – dort Ordner und Namen festlegen.');
      await browser.tabs.update(tab.id, { active: true }).catch(() => {});
      await browser.tabs.print();
      return 'print';
    }
    const r = await browser.tabs.saveAsPDF({ toFileName: `${safe(tab && tab.title)}.pdf`, shrinkToFit: true, showBackgroundColors: true, headerLeft: '', headerRight: '', footerLeft: '', footerRight: '' }).catch((e) => e.message);
    if (r === 'saved' || r === 'replaced') note('Als PDF gespeichert', `„${safe(tab && tab.title)}.pdf“ liegt im gewählten Ordner.`);
    return r;
  }

  // ---------- 2. Ganzseiten-Bildschirmfoto ----------
  async function fullShot(tab) {
    let dim = null;
    try {
      [dim] = await browser.tabs.executeScript(tab.id, { code: `({ w: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, innerWidth),
        h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight), dpr: devicePixelRatio || 1 })` });
    } catch (e) { dim = null; }
    let data, w, h;
    if (dim && dim.w > 0 && dim.h > 0) {
      w = Math.min(dim.w, 8000); h = Math.min(dim.h, 30000);
      // Firefox-Grenzen: höchstens ~32.000 px je Seite und ~200 Mio. Bildpunkte – darunter in voller Schärfe
      const scale = Math.max(0.25, Math.min(dim.dpr, 30000 / h, 30000 / w, Math.sqrt(2e8 / (w * h))));
      try { data = await browser.tabs.captureTab(tab.id, { format: 'png', rect: { x: 0, y: 0, width: w, height: h }, scale }); } catch (e) { data = null; }
    }
    if (!data) { data = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); w = 0; h = 0; }   // z. B. PDF-Ansicht, interne Seiten
    const id = crypto.randomUUID();
    shots.set(id, { data, title: tab.title || '', url: tab.url || '', at: Date.now() });
    setTimeout(() => shots.delete(id), 10 * 60000);
    await browser.tabs.create({ url: browser.runtime.getURL(`pages/shot.html?id=${id}`), index: tab.index + 1, openerTabId: tab.id });
    return true;
  }
  const takeShot = (id) => { const s = shots.get(id) || null; shots.delete(id); return s; };

  return { savePdf, fullShot, takeShot, stamp };
})();
