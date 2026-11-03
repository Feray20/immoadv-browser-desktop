// Neue Browser-Funktionen (Feray 03.11.2026: „neue Browser-Funktionen alle einbauen“):
//   1. Seite als PDF speichern          5. Arbeitsbereiche (Tabs eines Fensters merken, öffnen, ersetzen)
//   2. Ganzseiten-Bildschirmfoto        6. „Später ansehen“ (Lesezeichen-Ordner – gleicht über den Geräte-Abgleich ab)
//      mit Markieren und Schwärzen      7. KI auf jeder Seite (zusammenfassen, übersetzen, Antwort entwerfen) – in ai.js
//   3. Formulare mit Firmendaten füllen
//   4. Belege an ImmoAdv Steuern senden (über das eigene, angemeldete immoadv.de-Fenster – keine Zugangsdaten im Browser)
// Nichts wird ohne Klick abgeschickt: Formulare werden nur gefüllt, nie gesendet.
'use strict';
const Tools = (() => {
  const shots = new Map();      // id → { data, w, h, title, url } – nur bis die Bearbeiten-Seite sie abholt
  const belege = new Map();     // id → { buf, name, mime }
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Seite';

  function note(title, message) {
    browser.notifications.create({ type: 'basic', iconUrl: browser.runtime.getURL('icons/icon128.png'), title, message }).catch(() => {});
  }

  // ---------- 1. Seite als PDF ----------
  async function savePdf(tab) {
    const r = await browser.tabs.saveAsPdf({ toFileName: `${safe(tab && tab.title)}.pdf`, shrinkToFit: true, showBackgroundColors: true, headerLeft: '', headerRight: '', footerLeft: '', footerRight: '' }).catch((e) => e.message);
    if (r === 'saved') note('Als PDF gespeichert', `„${safe(tab && tab.title)}.pdf“ liegt im gewählten Ordner.`);
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

  // ---------- 3. Firmendaten in Formulare ----------
  async function fillFirm(tab, frameId) {
    const firm = Settings.get('firm') || {};
    if (!Object.values(firm).some((v) => String(v || '').trim())) {
      await browser.tabs.create({ url: browser.runtime.getURL('pages/tools.html#firma') });
      return { filled: 0, empty: true };
    }
    const opt = frameId ? { frameId } : {};
    await browser.tabs.executeScript(tab.id, { ...opt, code: `window.__immoFirm = ${JSON.stringify(firm)};` });
    const [r] = await browser.tabs.executeScript(tab.id, { ...opt, file: '/content/firmfill.js' });
    return r || { filled: 0 };
  }

  // ---------- 4. Belege an ImmoAdv Steuern ----------
  const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  async function beleg(url, tab) {
    if (!/^(https?|file):/i.test(url || '')) { note('Beleg nicht gesendet', 'Nur PDFs und Bilder von Webseiten können gesendet werden.'); return false; }
    let res;
    try { res = await fetch(url, { credentials: 'include' }); } catch (e) { note('Beleg nicht geladen', 'Die Datei konnte nicht geladen werden.'); return false; }
    if (!res.ok) { note('Beleg nicht geladen', `Die Seite antwortet mit Fehler ${res.status}.`); return false; }
    let mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    let name = '';
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
    if (m) { try { name = decodeURIComponent(m[1] || m[2]); } catch (e) { name = m[1] || m[2]; } }
    if (!name) { try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch (e) { name = ''; } }
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!Object.values(MIME).includes(mime)) mime = MIME[ext] || mime;
    if (!Object.values(MIME).includes(mime)) {
      note('Kein PDF oder Bild', 'Diese Seite ist eine normale Webseite. Erst „Seite als PDF speichern“, dann die PDF in ImmoAdv Steuern ablegen.');
      return false;
    }
    const want = Object.keys(MIME).find((k) => MIME[k] === mime);
    if (!name || !MIME[ext]) name = `${safe(name.replace(/\.[^.]*$/, '') || (tab && tab.title) || 'Beleg')}.${want === 'jpeg' ? 'jpg' : want}`;
    const buf = await res.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 60 * 1024 * 1024) { note('Beleg zu groß', 'Höchstens 60 MB je Beleg.'); return false; }
    const id = crypto.randomUUID();
    belege.set(id, { buf, name, mime });
    setTimeout(() => belege.delete(id), 5 * 60000);
    // Das eigene ImmoAdv-Fenster lädt hoch – mit der Anmeldung, die dort ohnehin besteht
    let [t] = await browser.tabs.query({ url: ['https://immoadv.de/intern*', 'https://www.immoadv.de/intern*'] }).catch(() => []);
    if (!t) {
      t = await browser.tabs.create({ url: 'https://immoadv.de/intern', active: false, index: tab ? tab.index + 1 : undefined });
      await new Promise((ok) => {
        const done = (tid, ch) => { if (tid === t.id && ch.status === 'complete') { browser.tabs.onUpdated.removeListener(done); ok(); } };
        browser.tabs.onUpdated.addListener(done); setTimeout(ok, 20000);
      });
      await new Promise((ok) => setTimeout(ok, 2500));   // App-Module laden
    }
    try {
      await browser.tabs.executeScript(t.id, { code: `(async () => {
        const d = await browser.runtime.sendMessage({ type: 'beleg:take', id: ${JSON.stringify(id)} });
        if (!d) return;
        const ack = (e) => { if (e.source === window && e.data && e.data.type === 'immoadv-beleg-ok' && e.data.id === ${JSON.stringify(id)}) { removeEventListener('message', ack); browser.runtime.sendMessage({ type: 'beleg:done', id: ${JSON.stringify(id)}, ok: !!e.data.ok, name: d.name }); } };
        addEventListener('message', ack);
        window.postMessage({ type: 'immoadv-beleg', id: ${JSON.stringify(id)}, name: d.name, mime: d.mime, buf: d.buf }, location.origin);
        setTimeout(() => { removeEventListener('message', ack); }, 120000);
      })();` });
    } catch (e) { belege.delete(id); note('Beleg nicht gesendet', 'ImmoAdv Steuern ist gerade nicht erreichbar. Bitte auf immoadv.de anmelden und erneut senden.'); return false; }
    // Kam keine Antwort, ist die Seite nicht angemeldet
    setTimeout(() => { if (pendingBeleg(id)) { belege.delete(id); browser.tabs.update(t.id, { active: true }).catch(() => {}); note('Bitte anmelden', 'Im geöffneten ImmoAdv-Fenster anmelden und den Beleg danach erneut senden.'); } }, 30000);
    return true;
  }
  const takeBeleg = (id) => { const b = belege.get(id); if (!b) return null; belege.set(id, { ...b, taken: true, buf: null }); return b; };
  function belegDone(id, ok, name) {
    belege.delete(id);
    note(ok ? 'Beleg an ImmoAdv Steuern gesendet' : 'Beleg nicht gespeichert', ok ? `„${name}“ wird automatisch erkannt und zugeordnet.` : `„${name}“ – Hinweis steht im ImmoAdv-Fenster.`);
  }
  // „taken“-Belege nicht als „nicht angemeldet“ werten
  const pendingBeleg = (id) => { const b = belege.get(id); return !!b && !b.taken; };

  // ---------- 5. Arbeitsbereiche ----------
  const spaces = () => (Settings.get('spaces') || []).filter((s) => s && s.id && Array.isArray(s.tabs));
  async function windowTabs(windowId) {
    const tabs = await browser.tabs.query({ windowId });
    return tabs.filter((t) => /^https?:/.test(t.url || '') && !t.incognito).slice(0, 80).map((t) => ({ url: t.url, title: (t.title || '').slice(0, 200), pinned: !!t.pinned }));
  }
  async function spaceSave({ name, windowId, id }) {
    const tabs = await windowTabs(windowId);
    if (!tabs.length) return { error: 'In diesem Fenster sind keine Webseiten offen.' };
    const list = spaces();
    const i = id ? list.findIndex((s) => s.id === id) : -1;
    const item = { id: id || crypto.randomUUID(), name: String(name || (i >= 0 ? list[i].name : '') || 'Arbeitsbereich').slice(0, 60), tabs, at: Date.now() };
    if (i >= 0) list[i] = item; else list.unshift(item);
    await Settings.set({ spaces: list.slice(0, 30) });
    return { ok: true, spaces: spaces() };
  }
  async function spaceOpen({ id, windowId, replace }) {
    const s = spaces().find((x) => x.id === id);
    if (!s || !s.tabs.length) return { error: 'Arbeitsbereich nicht gefunden.' };
    if (!replace) { const w = await browser.windows.create({ url: s.tabs.map((t) => t.url) }); for (const [i, t] of (w.tabs || []).entries()) if (s.tabs[i] && s.tabs[i].pinned) browser.tabs.update(t.id, { pinned: true }).catch(() => {}); return { ok: true }; }
    const old = await browser.tabs.query({ windowId });
    for (const [i, t] of s.tabs.entries()) await browser.tabs.create({ windowId, url: t.url, pinned: t.pinned, active: i === 0 }).catch(() => {});
    // alte Tabs schließen (über „Geschlossenen Tab wieder öffnen“ und den Verlauf zurückholbar)
    await browser.tabs.remove(old.filter((t) => !t.pinned || !s.tabs.some((x) => x.url === t.url)).map((t) => t.id)).catch(() => {});
    return { ok: true };
  }
  async function spaceRemove({ id }) { await Settings.set({ spaces: spaces().filter((s) => s.id !== id) }); return { ok: true, spaces: spaces() }; }

  // ---------- 6. Später ansehen ----------
  const LATER = 'Später ansehen';
  async function laterFolder() {
    const tree = await browser.bookmarks.getTree();
    const toolbar = (tree[0].children || []).find((c) => c.id === 'toolbar_____') || tree[0].children[1];
    const kids = await browser.bookmarks.getChildren(toolbar.id);
    return (kids.find((k) => !k.url && k.title === LATER) || await browser.bookmarks.create({ parentId: toolbar.id, title: LATER, index: 0 })).id;
  }
  async function laterAdd(url, title) {
    if (!/^https?:/.test(url || '')) return { error: 'Nur Webseiten können gemerkt werden.' };
    const parentId = await laterFolder();
    const have = (await browser.bookmarks.getChildren(parentId)).find((b) => b.url === url);
    if (!have) await browser.bookmarks.create({ parentId, url, title: String(title || url).slice(0, 300), index: 0 });
    note('Für später gemerkt', `${String(title || url).slice(0, 80)} – steht unter „Später ansehen“ auf allen deinen Geräten mit dem ImmoAdv Browser.`);
    return { ok: true };
  }
  async function laterList() { return (await browser.bookmarks.getChildren(await laterFolder())).filter((b) => b.url).map((b) => ({ id: b.id, url: b.url, title: b.title, added: b.dateAdded })); }
  async function laterDone(id) { const b = (await browser.bookmarks.get(id).catch(() => []))[0]; if (b && b.url && b.parentId === await laterFolder()) await browser.bookmarks.remove(id); return { ok: true }; }

  return { savePdf, fullShot, takeShot, fillFirm, beleg, takeBeleg, belegDone, pendingBeleg, spaces, spaceSave, spaceOpen, spaceRemove, laterAdd, laterList, laterDone, stamp };
})();
