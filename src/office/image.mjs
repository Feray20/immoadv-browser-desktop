// Bild-Vorschau im ImmoAdv Browser (Wunsch Feray 01.11.2026): exakt wie die frühere Vorschau der ImmoAdv-Software
// (wie Apple Vorschau) – schlanke Leiste mit Name und „Breite × Höhe px · Größe“, Verkleinern, Prozent, Vergrößern,
// An Fenster anpassen, Drehen, Drucken, Kopie speichern und „Bearbeiten“. Bearbeiten öffnet direkt hier die
// Werkzeuge (Drehen, Spiegeln, Zuschneiden, Helligkeit, Kontrast, Sättigung, Wärme) und speichert in die Originaldatei
// oder als Kopie. Alles bleibt auf dem Gerät – die Seite hat keinen Internetzugang.

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (d, s = 17) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  minus: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-4-4"/>', plus: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M20 20l-4-4"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', rot: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  rotl: '<path d="M4 11a8 8 0 1 1 2.3 5.7"/><path d="M4 4v7h7"/>', flip: '<path d="M12 3v18"/><path d="M8 7L3 12l5 5V7zM16 7l5 5-5 5V7z"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="6" y="14" width="12" height="7"/>', dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
};
const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`);
const SAVE_TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

function toast(t) {
  let m = document.getElementById('pvMsg');
  if (!m) { m = document.createElement('p'); m.id = 'pvMsg'; m.className = 'pv-msg'; m.setAttribute('role', 'status'); m.setAttribute('aria-live', 'polite'); document.body.append(m); }
  m.textContent = t; m.hidden = !t; clearTimeout(toast.t); if (t) toast.t = setTimeout(() => { m.hidden = true; }, 4500);
}

function printImage(url, name) {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0'; document.body.append(f);
  const d = f.contentDocument; d.open(); d.write(`<!doctype html><title>${esc(name)}</title><style>@page{margin:10mm}html,body{margin:0;height:100%}img{max-width:100%;max-height:100vh;display:block;margin:auto;object-fit:contain}</style><img src="${url}">`); d.close();
  const im = d.querySelector('img');
  const go = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast('Drucken ist hier nicht möglich.'); } setTimeout(() => f.remove(), 60_000); };
  if (im.complete) go(); else im.onload = go;
}

function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); }

/**
 * Zeigt das Bild in `root`. `token` ist die einmalige Kennung der Datei (zum Speichern zurück in die Originaldatei).
 */
export function showImage(root, { blob, name, ext, token }) {
  let url = URL.createObjectURL(blob);
  let fileSize = blob.size;
  let keys = null;

  // ---------- Vorschau ----------
  function preview() {
    root.className = 'pv';
    root.innerHTML = `<header class="pv-bar"><div class="pv-t"><b title="${esc(name)}">${esc(name)}</b><small>${esc(size(fileSize))}</small></div>
      <div class="pv-g"><button type="button" class="pv-b" data-z="-" title="Verkleinern (Strg −)" aria-label="Verkleinern">${ico(I.minus)}</button><span class="pv-z" aria-live="polite">–</span><button type="button" class="pv-b" data-z="+" title="Vergrößern (Strg +)" aria-label="Vergrößern">${ico(I.plus)}</button><button type="button" class="pv-b" data-z="fit" title="An Fenster anpassen (Strg 0)" aria-label="An Fenster anpassen">${ico(I.fit)}</button></div>
      <div class="pv-g pv-hide"><button type="button" class="pv-b" data-rot title="Ansicht drehen (Strg R)" aria-label="Drehen">${ico(I.rot)}</button><button type="button" class="pv-b" data-pr title="Drucken (Strg P)" aria-label="Drucken">${ico(I.print)}</button></div>
      <div class="pv-g"><button type="button" class="pv-b pv-hide" data-dl title="Kopie speichern unter …" aria-label="Kopie speichern">${ico(I.dl)}</button><button type="button" class="pv-b pri" data-ed title="Werkzeuge öffnen (Strg E)">${ico(I.edit, 16)}<span>Bearbeiten</span></button></div></header>
      <div class="pv-stage${/png|webp|gif/.test(ext) ? ' checker' : ''}" tabindex="0" aria-label="Bild"><img alt="${esc(name)}" draggable="false"></div>`;
    const st = root.querySelector('.pv-stage'), img = st.querySelector('img'), Z = root.querySelector('.pv-z'), sm = root.querySelector('.pv-t small');
    let z = 1, fit = true, rot = 0, tx = 0, ty = 0, W = 0, H = 0;
    const fitZ = () => { const r = rot % 180 ? [H, W] : [W, H]; const s = st.getBoundingClientRect(); return Math.min(1, (s.width - 48) / r[0], (s.height - 48) / r[1]) || 1; };
    const paint = () => { if (!W) return; if (fit) { z = fitZ(); tx = ty = 0; } img.style.width = `${W}px`; img.style.height = `${H}px`; img.style.transform = `translate(${tx}px,${ty}px) rotate(${rot}deg) scale(${z})`; Z.textContent = `${Math.round(z * 100)} %`; st.classList.toggle('grab', !fit && z > fitZ()); };
    const setZ = (n, keep) => { fit = false; z = Math.min(16, Math.max(0.05, n)); if (!keep) { tx = ty = 0; } paint(); };
    img.onload = () => { W = img.naturalWidth; H = img.naturalHeight; sm.textContent = `${W} × ${H} px · ${size(fileSize)}`; paint(); };
    img.onerror = () => { st.classList.remove('checker'); st.innerHTML = '<div class="pv-empty"><b>Bild kann nicht angezeigt werden</b><span>Die Datei ist beschädigt oder das Format wird nicht unterstützt.</span></div>'; };
    img.src = url;
    root.querySelectorAll('[data-z]').forEach((b) => { b.onclick = () => { const k = b.dataset.z; if (k === 'fit') { fit = true; paint(); } else setZ(z * (k === '+' ? 1.25 : 0.8)); }; });
    root.querySelector('[data-rot]').onclick = () => { rot = (rot + 90) % 360; paint(); };
    root.querySelector('[data-pr]').onclick = () => printImage(url, name);
    root.querySelector('[data-dl]').onclick = () => download(url, name);
    root.querySelector('[data-ed]').onclick = () => editor();
    // Strg + Mausrad bzw. Trackpad zoomt; Doppelklick wechselt zwischen 100 % und Anpassen; gezoomt verschieben.
    st.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey && fit) return; e.preventDefault(); st.classList.add('wheel'); clearTimeout(st._w); st._w = setTimeout(() => st.classList.remove('wheel'), 160); if (e.ctrlKey || e.metaKey) setZ(z * Math.exp(-e.deltaY * 0.0022), true); else { tx -= e.deltaX; ty -= e.deltaY; paint(); } }, { passive: false });
    img.addEventListener('dblclick', () => { if (fit || Math.abs(z - fitZ()) < 0.01) setZ(1); else { fit = true; paint(); } });
    let drag = null;
    st.addEventListener('pointerdown', (e) => { if (fit) return; drag = { x: e.clientX - tx, y: e.clientY - ty }; st.setPointerCapture(e.pointerId); st.classList.add('grabbing'); });
    st.addEventListener('pointermove', (e) => { if (!drag) return; tx = e.clientX - drag.x; ty = e.clientY - drag.y; paint(); });
    const up = () => { drag = null; st.classList.remove('grabbing'); };
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    new ResizeObserver(() => paint()).observe(st);
    keys = (e) => {
      const m = e.ctrlKey || e.metaKey; if (!m) return;
      const k = e.key.toLowerCase();
      if (k === '+' || k === '=') { e.preventDefault(); setZ(z * 1.25); } else if (k === '-') { e.preventDefault(); setZ(z * 0.8); } else if (k === '0') { e.preventDefault(); fit = true; paint(); } else if (k === 'r') { e.preventDefault(); rot = (rot + 90) % 360; paint(); } else if (k === 'p') { e.preventDefault(); printImage(url, name); } else if (k === 'e') { e.preventDefault(); editor(); }
    };
    st.focus({ preventScroll: true });
  }

  // ---------- Bearbeiten (Werkzeuge direkt im Browser) ----------
  function editor() {
    keys = null;
    const src = new Image();
    src.onload = () => build(src);
    src.onerror = () => toast('Das Bild kann nicht bearbeitet werden.');
    src.src = url;
  }

  function build(src) {
    const S = { rot: 0, flipX: false, flipY: false, b: 100, c: 100, s: 100, w: 0, crop: null, cropping: false };
    const canSave = Boolean(SAVE_TYPE[ext]);
    root.className = 'pv ed';
    root.innerHTML = `<header class="pv-bar"><div class="pv-t"><b title="${esc(name)}">${esc(name)}</b><small>Bearbeiten</small></div>
      <div class="pv-g"><button type="button" class="pv-b" data-a="rotl" title="Nach links drehen" aria-label="Nach links drehen">${ico(I.rotl)}</button><button type="button" class="pv-b" data-a="rotr" title="Nach rechts drehen" aria-label="Nach rechts drehen">${ico(I.rot)}</button><button type="button" class="pv-b" data-a="flip" title="Spiegeln" aria-label="Spiegeln">${ico(I.flip)}</button><button type="button" class="pv-b" data-a="crop" title="Zuschneiden" aria-pressed="false">${ico(I.crop)}<span class="pv-hide">Zuschneiden</span></button></div>
      <div class="pv-g"><button type="button" class="pv-b" data-a="cancel">Abbrechen</button><button type="button" class="pv-b" data-a="copy" title="Als Kopie speichern unter …">Als Kopie</button>${canSave ? '<button type="button" class="pv-b pri" data-a="save" title="In die Originaldatei speichern (Strg S)">Speichern</button>' : ''}</div></header>
      <div class="pv-edit"><div class="pv-stage checker" aria-label="Bild"><div class="pv-cv"><canvas></canvas><div class="pv-crop" hidden></div></div></div>
      <aside class="pv-side" aria-label="Anpassen"><h3>Anpassen</h3>
        ${[['b', 'Helligkeit'], ['c', 'Kontrast'], ['s', 'Sättigung'], ['w', 'Wärme']].map(([k, l]) => `<label class="pv-sl"><span>${l}<output data-o="${k}">0</output></span><input type="range" data-k="${k}" min="${k === 'w' ? -50 : 0}" max="${k === 'w' ? 50 : 200}" value="${k === 'w' ? 0 : 100}"></label>`).join('')}
        <button type="button" class="pv-b pv-reset" data-a="reset">Zurücksetzen</button>
        ${canSave ? '' : `<p class="pv-note">„.${esc(ext)}“ wird als Kopie im PNG-Format gespeichert.</p>`}
        ${/^(jpe?g|webp)$/.test(ext) ? '<p class="pv-note">Hinweis: Beim Speichern gehen Aufnahmedaten (Datum, Ort, Kamera) verloren. Wer sie behalten will, nimmt „Als Kopie“.</p>' : ''}
      </aside></div>`;
    const cv = root.querySelector('canvas'), ctx = cv.getContext('2d'), wrap = root.querySelector('.pv-cv'), stage = root.querySelector('.pv-stage'), box = root.querySelector('.pv-crop');
    // Wärme als echter Weißabgleich (Rot/Blau-Kanal), nicht mehr Sepia + Farbdrehung – die drehte bei „kühl“ alle Farben
    // um 180° (Prüfung 01.11.2026). Filter liegt als SVG-feColorMatrix im Dokument.
    let wf = document.getElementById('pvWarmSvg');
    if (!wf) { document.body.insertAdjacentHTML('beforeend', '<svg id="pvWarmSvg" width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="pvWarm" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter></svg>'); wf = document.getElementById('pvWarmSvg'); }
    const warmMatrix = () => { const t = S.w / 50; const r = 1 + 0.18 * t, gg = 1 + 0.03 * t, b = 1 - 0.18 * t; wf.querySelector('feColorMatrix').setAttribute('values', `${r} 0 0 0 0 0 ${gg} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0`); };
    const filter = () => `brightness(${S.b}%) contrast(${S.c}%) saturate(${S.s}%)${S.w ? ' url(#pvWarm)' : ''}`;
    const start = JSON.stringify({ rot: 0, flipX: false, flipY: false, b: 100, c: 100, s: 100, w: 0, crop: null });
    const changed = () => JSON.stringify({ rot: S.rot, flipX: S.flipX, flipY: S.flipY, b: S.b, c: S.c, s: S.s, w: S.w, crop: S.crop }) !== start;
    // Anzeige in Bildschirmgröße (ds), volle Auflösung nur beim Speichern – Regler reagieren sofort, viel weniger Speicher
    // bei großen Fotos (Prüfung 01.11.2026). Zuschnitt-Werte bleiben immer in voller Auflösung.
    let ds = 1;
    function render(target, withCrop, scale = 1) {
      const rw = S.rot % 180 ? src.naturalHeight : src.naturalWidth, rh = S.rot % 180 ? src.naturalWidth : src.naturalHeight;
      const c = withCrop && S.crop ? S.crop : { x: 0, y: 0, w: rw, h: rh };
      target.width = Math.max(1, Math.round(c.w * scale)); target.height = Math.max(1, Math.round(c.h * scale));
      const g = target.getContext('2d');
      if (S.w) warmMatrix();
      g.save(); g.scale(scale, scale); g.filter = filter(); g.translate(-c.x, -c.y); g.translate(rw / 2, rh / 2); g.rotate((S.rot * Math.PI) / 180); g.scale(S.flipX ? -1 : 1, S.flipY ? -1 : 1);
      g.drawImage(src, -src.naturalWidth / 2, -src.naturalHeight / 2); g.restore();
    }
    function layout() {
      const r = stage.getBoundingClientRect(); const k = Math.min(1, (r.width - 48) / cv.width, (r.height - 48) / cv.height) || 1;
      wrap.style.width = `${cv.width * k}px`; wrap.style.height = `${cv.height * k}px`; wrap.dataset.k = String(k * ds);
    }
    const fullW = () => cv.width / ds, fullH = () => cv.height / ds;
    function draw() {
      const rw = S.rot % 180 ? src.naturalHeight : src.naturalWidth, rh = S.rot % 180 ? src.naturalWidth : src.naturalHeight;
      const c = !S.cropping && S.crop ? S.crop : { w: rw, h: rh };
      ds = Math.min(1, (Math.max(800, Math.min(2400, Math.max(innerWidth, innerHeight) * (devicePixelRatio || 1)))) / Math.max(c.w, c.h));
      render(cv, !S.cropping, ds); layout(); drawBox();
    }
    let raf = 0; const drawSoon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
    function drawBox() {
      box.hidden = !S.cropping; if (!S.cropping) return;
      const k = Number(wrap.dataset.k) || 1, c = S.crop || { x: 0, y: 0, w: fullW(), h: fullH() };
      Object.assign(box.style, { left: `${c.x * k}px`, top: `${c.y * k}px`, width: `${c.w * k}px`, height: `${c.h * k}px` });
    }
    // Zuschneiden: Rahmen aufziehen; erneut auf „Zuschneiden“ übernimmt den Ausschnitt.
    let d0 = null;
    wrap.addEventListener('pointerdown', (e) => {
      if (!S.cropping) return; const r = wrap.getBoundingClientRect(), k = Number(wrap.dataset.k) || 1;
      d0 = { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!d0) return; const r = wrap.getBoundingClientRect(), k = Number(wrap.dataset.k) || 1;
      const x = Math.min(fullW(), Math.max(0, (e.clientX - r.left) / k)), y = Math.min(fullH(), Math.max(0, (e.clientY - r.top) / k));
      S.crop = { x: Math.min(d0.x, x), y: Math.min(d0.y, y), w: Math.abs(x - d0.x), h: Math.abs(y - d0.y) }; drawBox();
    });
    const endDrag = () => { d0 = null; if (S.crop && (S.crop.w < 8 || S.crop.h < 8)) { S.crop = null; drawBox(); } };
    wrap.addEventListener('pointerup', endDrag); wrap.addEventListener('pointercancel', endDrag);
    const cropBtn = root.querySelector('[data-a="crop"]');
    root.querySelectorAll('input[type=range]').forEach((i) => {
      i.oninput = () => { S[i.dataset.k] = Number(i.value); const o = root.querySelector(`[data-o="${i.dataset.k}"]`); o.textContent = String(i.dataset.k === 'w' ? S.w : S[i.dataset.k] - 100); drawSoon(); };
    });
    async function blobOut(type) {
      const c = document.createElement('canvas'); render(c, true);
      // 0,95 statt 0,92: weniger Qualitätsverlust bei JPEG/WebP (Prüfung 01.11.2026)
      return new Promise((res) => c.toBlob((b) => res(b), type, type === 'image/png' ? undefined : 0.95));
    }
    async function save() {
      // Ohne Änderung nichts schreiben – das Original bleibt unangetastet (kein erneutes Komprimieren, Metadaten bleiben).
      if (!changed()) { toast('Keine Änderungen – Original bleibt unverändert'); preview(); return; }
      const b = await blobOut(SAVE_TYPE[ext]); if (!b) { toast('Speichern ist fehlgeschlagen.'); return; }
      // Version 4: die Erweiterung darf die Originaldatei nicht überschreiben → als Kopie speichern
      if (location.protocol === 'moz-extension:') { copy(); return; }
      try {
        const r = await fetch(`/__save/${encodeURIComponent(token)}`, { method: 'POST', body: b });
        if (!r.ok) throw new Error(await r.text());
        URL.revokeObjectURL(url); url = URL.createObjectURL(b); fileSize = b.size;
        toast('Gespeichert'); preview();
      } catch (e) { toast(`Speichern ist fehlgeschlagen: ${String(e?.message || e).slice(0, 120)}`); }
    }
    async function copy() {
      const type = SAVE_TYPE[ext] || 'image/png';
      const b = await blobOut(type); if (!b) { toast('Speichern ist fehlgeschlagen.'); return; }
      const base = name.replace(/\.[^.]+$/, ''), e2 = SAVE_TYPE[ext] ? ext : 'png';
      const u = URL.createObjectURL(b); download(u, `${base} (bearbeitet).${e2}`); setTimeout(() => URL.revokeObjectURL(u), 60_000);
    }
    root.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'rotl' || a === 'rotr') { S.rot = (S.rot + (a === 'rotr' ? 90 : 270)) % 360; S.crop = null; draw(); }
        else if (a === 'flip') { S.flipX = !S.flipX; S.crop = null; draw(); }   // Zuschnitt passt nach Spiegeln nicht mehr
        else if (a === 'crop') { S.cropping = !S.cropping; cropBtn.setAttribute('aria-pressed', String(S.cropping)); if (S.cropping) S.crop = null; draw(); }
        else if (a === 'reset') { Object.assign(S, { rot: 0, flipX: false, flipY: false, b: 100, c: 100, s: 100, w: 0, crop: null, cropping: false }); cropBtn.setAttribute('aria-pressed', 'false'); root.querySelectorAll('input[type=range]').forEach((i) => { i.value = i.dataset.k === 'w' ? '0' : '100'; }); root.querySelectorAll('output').forEach((o) => { o.textContent = '0'; }); draw(); }
        else if (a === 'cancel') preview();
        else if (a === 'save') save();
        else if (a === 'copy') copy();
      };
    });
    keys = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && canSave) { e.preventDefault(); save(); } else if (e.key === 'Escape') preview(); };
    new ResizeObserver(() => { layout(); drawBox(); }).observe(stage);
    draw();
  }

  addEventListener('keydown', (e) => keys?.(e));
  preview();
}
