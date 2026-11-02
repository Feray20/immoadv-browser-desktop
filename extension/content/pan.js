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
  let on = false, live = false, x0 = 0, y0 = 0, s0 = 0, sc = null, raf = 0, dx = 0, eatUntil = 0;
  addEventListener('pointerdown', (e) => {
    on = false;
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.detail > 1 || e.defaultPrevented) return;
    const t = e.target; if (!(t instanceof Element) || t.closest(NOGO)) return;
    sc = scroller(t); if (!sc) return;
    on = true; live = false; x0 = e.clientX; y0 = e.clientY; s0 = sc.scrollLeft; dx = 0;
  }, { passive: true });
  addEventListener('pointermove', (e) => {
    if (!on) return;
    if (!(e.buttons & 1)) { on = false; return; }
    dx = e.clientX - x0; const dy = e.clientY - y0;
    if (!live) {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { on = false; return; }
      if (Math.abs(dx) < 6) return;
      live = true;
      try { getSelection().removeAllRanges(); } catch (er) { /* egal */ }
      document.documentElement.style.setProperty('cursor', 'grabbing', 'important');
      document.documentElement.style.setProperty('user-select', 'none', 'important');
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (live && sc) sc.scrollLeft = s0 - dx; });
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
