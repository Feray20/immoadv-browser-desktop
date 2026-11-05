// Seitlich mit der Maus ziehen statt Scrollleiste (Feray 02.11.2026: „egal was – mit der Maus nach links und rechts
// ziehen, ohne Probleme“). Gilt nur für Bereiche einer Webseite, die wirklich seitlich scrollen (breite Tabellen,
// Produktreihen, Code-Blöcke). Links, Knöpfe, Felder, Bilder zum Ziehen und Karten/Schieberegler der Seite bleiben
// unberührt; nutzt die Seite die Maus selbst (z. B. Karussell), gewinnt die Seite. Text markieren: Doppelklick/Umschalt.
(() => {
  if (window.__immoadvPan) return; window.__immoadvPan = true;
  const NOGO = 'a,button,input,select,textarea,label,summary,option,video,audio,canvas,iframe,embed,object,[contenteditable=""],[contenteditable="true"],[draggable="true"],[role="slider"],[role="scrollbar"],[role="textbox"],[role="tab"],[role="button"]';
  const scroller = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (e.scrollWidth > e.clientWidth + 4) { const ox = getComputedStyle(e).overflowX; if (ox === 'auto' || ox === 'scroll') return e; }
    }
    // Ganze Seite seitlich (ohne Scrollleiste, 02.11.2026): auch die Seite selbst lässt sich mit der Maus ziehen.
    const root = document.scrollingElement || document.documentElement;
    if (root && root.scrollWidth > root.clientWidth + 4 && getComputedStyle(root).overflowX !== 'hidden' && getComputedStyle(document.body || root).overflowX !== 'hidden') return root;
    return null;
  };
  // Hoch/runter (03.11.2026, Feray: „links rechts oben unten mit der Maus schieben“): auf freier Fläche (kein Text direkt
  // unter der Maus, kein Knopf/Feld) schiebt ein senkrechter Zug den nächsten senkrecht scrollbaren Bereich bzw. die Seite.
  const scrollerY = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (e.scrollHeight > e.clientHeight + 4) { const oy = getComputedStyle(e).overflowY; if (oy === 'auto' || oy === 'scroll') return e; }
    }
    const root = document.scrollingElement || document.documentElement;
    return root && root.scrollHeight > root.clientHeight + 4 ? root : null;
  };
  // Seiten bauen Knöpfe oft aus <div>/<span> (05.11.2026, Feray: „bei eBay gehen manche Knöpfe gar nicht“): Alles mit
  // Hand-Zeiger, Klick-Attribut oder Tastaturfokus gilt als Knopf – dort wird nie gezogen und kein Klick verschluckt.
  const clickable = (el) => {
    for (let e = el, i = 0; e && e !== document.body && i < 6; e = e.parentElement, i++) {
      if (e.hasAttribute('onclick') || e.hasAttribute('tabindex') || e.hasAttribute('data-track') || e.hasAttribute('jsaction')) return true;
      try { if (getComputedStyle(e).cursor === 'pointer') return true; } catch (er) { return true; }
    }
    return false;
  };
  const hasText = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true; return false; };
  let on = false, live = false, x0 = 0, y0 = 0, s0 = 0, sc = null, raf = 0, dx = 0, dy = 0, eatUntil = 0, ysc = null, v0 = 0, vert = false;
  addEventListener('pointerdown', (e) => {
    on = false;
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.detail > 1 || e.defaultPrevented) return;
    const t = e.target; if (!(t instanceof Element) || t.closest(NOGO) || clickable(t)) return;
    sc = scroller(t); ysc = hasText(t) || t instanceof HTMLImageElement ? null : scrollerY(t);
    if (!sc && !ysc) return;
    on = true; live = false; vert = false; x0 = e.clientX; y0 = e.clientY; s0 = sc ? sc.scrollLeft : 0; v0 = ysc ? ysc.scrollTop : 0; dx = 0; dy = 0;
  }, { passive: true });
  addEventListener('pointermove', (e) => {
    if (!on) return;
    if (!(e.buttons & 1)) { on = false; return; }
    dx = e.clientX - x0; dy = e.clientY - y0;
    if (!live) {
      if (Math.abs(dy) > 14 && Math.abs(dy) >= Math.abs(dx)) { if (!ysc) { on = false; return; } vert = true; }
      else if (Math.abs(dx) < 12 || !sc) return;
      live = true;
      try { getSelection().removeAllRanges(); } catch (er) { /* egal */ }
      document.documentElement.style.setProperty('cursor', 'grabbing', 'important');
      document.documentElement.style.setProperty('user-select', 'none', 'important');
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (!live) return; if (vert && ysc) ysc.scrollTop = v0 - dy; else if (sc) sc.scrollLeft = s0 - dx; });
  }, { passive: true });
  const end = () => {
    if (!on) return; on = false;
    if (!live) return; live = false; eatUntil = performance.now() + 300;
    document.documentElement.style.removeProperty('cursor'); document.documentElement.style.removeProperty('user-select');
  };
  addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true);
  addEventListener('click', (e) => { if (performance.now() < eatUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
  addEventListener('selectstart', (e) => { if (live) e.preventDefault(); }, true);
})();
