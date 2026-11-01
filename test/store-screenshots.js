// Store-Screenshots (Microsoft Store / App Store) – läuft NUR in der Entwicklungsversion mit IMMOADV_SCREENSHOTS=Ordner,
// mit frischem, leerem Profil (keine privaten Daten). Wird nie in die fertige App gepackt (Ordner test/ ist nicht in „files“).
// Ergebnis: 1920×1080-PNGs im angegebenen Ordner.
const { BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const W = 1920, H = 1080;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function storeScreenshots(api) {
  const out = process.env.IMMOADV_SCREENSHOTS;
  fs.mkdirSync(out, { recursive: true });
  const log = (m) => console.log(`[screenshots] ${m}`);
  const win = api.win();

  win.setContentSize(W, H);
  win.center();
  await wait(1500);
  const [cw, ch] = win.getContentSize();
  log(`Fenstergröße ${cw}×${ch}`);

  // Zusammensetzen: Fensteroberfläche + sichtbare Seiten-Ansichten (eigene WebContentsViews) in ein Bild
  const composer = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } });
  await composer.loadURL('data:text/html,<canvas id=c></canvas>');

  async function shot(name) {
    await wait(3500);
    const layers = [];
    const base = await win.webContents.capturePage();
    layers.push({ url: base.toDataURL(), x: 0, y: 0, w: cw, h: ch });
    for (const t of api.tabs()) {
      if (!t.view) continue;
      const visible = typeof t.view.getVisible === 'function' ? t.view.getVisible() : t.id === api.active()?.id;
      if (!visible) continue;
      const b = t.view.getBounds();
      if (!b.width || !b.height) continue;
      const img = await t.view.webContents.capturePage();
      layers.push({ url: img.toDataURL(), x: b.x, y: b.y, w: b.width, h: b.height });
    }
    const png = await composer.webContents.executeJavaScript(`(async () => {
      const L = ${JSON.stringify(layers)};
      const c = document.getElementById('c'); c.width = ${cw}; c.height = ${ch};
      const g = c.getContext('2d');
      for (const l of L) { const i = new Image(); i.src = l.url; await i.decode(); g.drawImage(i, l.x, l.y, l.w, l.h); }
      return c.toDataURL('image/png');
    })()`);
    const file = path.join(out, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
    log(`gespeichert: ${file}`);
  }
  const ui = (js) => win.webContents.executeJavaScript(js).catch((e) => log(`UI: ${e.message}`));
  const closePanel = () => ui('typeof closePanel === "function" && closePanel()');

  // Beispiel-PDF (eigener Inhalt, keine echten Daten)
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 0, y: 742, width: 595, height: 100, color: rgb(0.04, 0.12, 0.23) });
  page.drawText('Exposé – Musterwohnung', { x: 48, y: 785, size: 26, font: bold, color: rgb(1, 1, 1) });
  const lines = [['Wohnfläche', '78 m²'], ['Zimmer', '3'], ['Baujahr', '2012'], ['Kaufpreis', '329.000 €'], ['Hausgeld', '285 € / Monat'], ['Energieklasse', 'B']];
  lines.forEach(([k, v], i) => { page.drawText(k, { x: 48, y: 690 - i * 34, size: 14, font }); page.drawText(v, { x: 300, y: 690 - i * 34, size: 14, font: bold }); });
  page.drawText('Ort, Datum', { x: 48, y: 200, size: 11, font, color: rgb(0.4, 0.4, 0.4) });
  page.drawLine({ start: { x: 48, y: 215 }, end: { x: 250, y: 215 }, thickness: 0.8 });
  page.drawText('Unterschrift', { x: 320, y: 200, size: 11, font, color: rgb(0.4, 0.4, 0.4) });
  page.drawLine({ start: { x: 320, y: 215 }, end: { x: 547, y: 215 }, thickness: 0.8 });
  const pdfFile = path.join(out, '..', 'Expose-Musterwohnung.pdf');
  fs.writeFileSync(pdfFile, await doc.save());

  try {
    await shot('1-startseite');

    const site = api.newTab('https://immoadv.de');
    await wait(4000);
    await shot('2-webseite');

    api.newTab('https://leaserun.com');
    await wait(4000);
    api.toggleSplit(api.active().id);
    await shot('3-geteilte-ansicht');
    api.toggleSplit(api.active().id);      // geteilte Ansicht wieder aus

    api.selectTab(site.id);
    await ui(`openPanel('settings', 'vpn')`);
    await shot('4-nordvpn');
    await closePanel();

    api.openPDF(pdfFile);
    await shot('5-pdf');
  } catch (e) {
    log(`Fehler: ${e.stack || e}`);
  } finally {
    composer.destroy();
    api.quit();
  }
};
