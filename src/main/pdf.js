// PDF-Werkzeug: Mozillas PDF.js mit Bearbeitungsleiste (ausfüllen, markieren, zeichnen, Text, Bild, Unterschrift).
// Läuft in einer abgeschotteten Sitzung ohne Internetzugang. Speichern schreibt in die Originaldatei.
const { session, protocol, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEME = 'immoadv-pdf';
const files = new Map();   // token → Dateipfad
let pdfSession = null;

function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
}

const viewerRoot = () => app.isPackaged
  ? path.join(process.resourcesPath, 'pdfjs')
  : path.join(__dirname, '..', '..', 'vendor', 'pdfjs');

const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.ftl': 'text/plain', '.json': 'application/json',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };

const officeRoot = path.join(__dirname, '..', 'office');
// PDF-Studio (Texterkennung, Geradeziehen, Seiten bearbeiten): Oberfläche im Programm, Bausteine aus resources/studio
const studioRoot = path.join(__dirname, '..', 'studio');
const studioVendor = () => (app.isPackaged ? path.join(process.resourcesPath, 'studio') : path.join(__dirname, '..', '..', 'vendor', 'studio'));
const FILE_MIME = { '.pdf': 'application/pdf', '.docx': 'application/octet-stream', '.xlsx': 'application/octet-stream', '.pptx': 'application/octet-stream',
  '.csv': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };

// Läuft im Viewer vor dem Start: Unterschrift-Werkzeug an, deutsche Oberfläche, keine Netzwerk-Funktionen
const SETUP = `document.addEventListener('webviewerloaded', () => {
  const o = window.PDFViewerApplicationOptions;
  const set = (k, v) => { try { o.set(k, v); } catch (e) {} };
  set('enableScripting', false);          // kein JavaScript aus PDFs
  set('enableSignatureEditor', true);
  set('enableHighlightEditor', true);
  set('enableAltText', false);
  set('disablePreferences', true);
  set('localeProperties', { lang: 'de' });
  set('isEvalSupported', false);
  set('defaultUrl', '');
});`;

function getSession() {
  if (pdfSession) return pdfSession;
  pdfSession = session.fromPartition('immoadv-pdf', { cache: false });
  // kein Internet für den PDF-Betrachter – Dokumente bleiben lokal
  pdfSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^(https?|wss?|ftp):/i.test(d.url) }));
  pdfSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  pdfSession.protocol.handle(SCHEME, async (req) => {
    const u = new URL(req.url);
    if (u.pathname.startsWith('/__file/')) {
      const p = files.get(u.pathname.slice('/__file/'.length));
      if (!p) return new Response('Nicht gefunden', { status: 404 });
      return new Response(await fs.promises.readFile(p), { headers: { 'content-type': FILE_MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' } });
    }
    // Bild bearbeitet → zurück in die Originaldatei (01.11.2026). Nur für die Datei dieser Kennung, nur PNG/JPEG/WebP,
    // nur wenn der Inhalt wirklich ein Bild dieses Typs ist; atomar über eine Zwischendatei.
    if (u.pathname.startsWith('/__save/') && req.method === 'POST') {
      const p = files.get(u.pathname.slice('/__save/'.length));
      if (!p) return new Response('Datei nicht gefunden', { status: 404 });
      const ext = path.extname(p).toLowerCase();
      const buf = Buffer.from(await req.arrayBuffer());
      if (!buf.length || buf.length > 200 * 1024 * 1024) return new Response('Ungültige Größe', { status: 413 });
      const ok = (ext === '.png' && buf[0] === 0x89 && buf[1] === 0x50)
        || ((ext === '.jpg' || ext === '.jpeg') && buf[0] === 0xff && buf[1] === 0xd8)
        || (ext === '.webp' && buf.slice(8, 12).toString() === 'WEBP');
      if (!ok) return new Response('Dateityp passt nicht', { status: 415 });
      const tmp = p + '.immoadv-tmp';
      try { await fs.promises.writeFile(tmp, buf); await fs.promises.rename(tmp, p); }
      catch (e) { try { await fs.promises.unlink(tmp); } catch {} return new Response('Speichern nicht möglich', { status: 500 }); }
      return new Response('ok');
    }
    // Office-/Bild-Anzeige (01.11.2026): eigene Seite im Programm, gleiche abgeschottete Sitzung wie der PDF-Betrachter.
    if (u.pathname.startsWith('/office/')) {
      const rel = decodeURIComponent(u.pathname.slice('/office/'.length)).replace(/^\/+/, '');
      const full = path.join(officeRoot, rel);
      if (!full.startsWith(officeRoot + path.sep)) return new Response('', { status: 403 });
      try { return new Response(await fs.promises.readFile(full), { headers: { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' } }); }
      catch { return new Response('', { status: 404 }); }
    }
    if (u.pathname.startsWith('/studio/')) {
      const rel = decodeURIComponent(u.pathname.slice('/studio/'.length)).replace(/^\/+/, '');
      const base = rel.startsWith('vendor/') ? studioVendor() : studioRoot;
      const full = path.join(base, rel.startsWith('vendor/') ? rel.slice(7) : rel);
      if (!full.startsWith(base + path.sep)) return new Response('', { status: 403 });
      const type = /\.traineddata$/.test(full) ? 'application/octet-stream' : /\.wasm$/.test(full) ? 'application/wasm' : MIME[path.extname(full)] || 'application/octet-stream';
      try { return new Response(await fs.promises.readFile(full), { headers: { 'content-type': type } }); }
      catch { return new Response('', { status: 404 }); }
    }
    if (u.pathname === '/__setup.js') return new Response(SETUP, { headers: { 'content-type': 'text/javascript' } });
    // Viewer-Dateien
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const full = path.join(viewerRoot(), rel);
    if (!full.startsWith(viewerRoot() + path.sep)) return new Response('', { status: 403 });
    try {
      let body = await fs.promises.readFile(full);
      if (rel === 'web/viewer.html') {
        body = Buffer.from(body.toString('utf8').replace('<head>', `<head><script src="/__setup.js"></script>`));
      }
      return new Response(body, { headers: { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' } });
    } catch { return new Response('', { status: 404 }); }
  });
  return pdfSession;
}

/** Adresse, unter der eine lokale PDF im Viewer geöffnet wird */
function viewerURL(filePath) {
  const token = crypto.randomUUID();
  files.set(token, filePath);
  const file = encodeURIComponent(`/__file/${token}`);   // gleiche Herkunft wie der Viewer
  return `${SCHEME}://viewer/web/viewer.html?file=${file}#locale=de`;
}

/** Adresse für Word/Excel/PowerPoint/Bilder (nur Anzeige) */
function officeURL(filePath) {
  const token = crypto.randomUUID();
  files.set(token, filePath);
  return `${SCHEME}://viewer/office/index.html?file=${encodeURIComponent(token)}&name=${encodeURIComponent(path.basename(filePath))}`;
}

/** PDF-Studio für eine Datei (PDF oder Bild) */
function studioURL(filePath) {
  const token = crypto.randomUUID();
  files.set(token, filePath);
  return `${SCHEME}://viewer/studio/index.html?file=${encodeURIComponent(token)}&name=${encodeURIComponent(path.basename(filePath))}`;
}

/** Speichert alle Änderungen (Formulare, Markierungen, Unterschrift) zurück in die Datei */
async function save(webContents, filePath) {
  const b64 = await webContents.executeJavaScript(`(async () => {
    const d = await PDFViewerApplication.pdfDocument.saveDocument();
    let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
    return btoa(s);
  })()`, true);
  const tmp = filePath + '.immoadv-tmp';
  await fs.promises.writeFile(tmp, Buffer.from(b64, 'base64'));
  await fs.promises.rename(tmp, filePath);
}

module.exports = { registerScheme, getSession, viewerURL, officeURL, studioURL, save };
