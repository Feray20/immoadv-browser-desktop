// KI-Zusammenfassung direkt auf der Webseite (05.11.2026, Feray: „KI zusammenfassen vom Menü weg, direkt auf der Website“).
// Ein kleiner Knopf „✦ Zusammenfassen“ unten rechts – nur auf Seiten mit viel Fließtext (Artikel, Exposés, Ratgeber),
// nicht in Web-Apps wie Postfach, Shop-Verwaltung oder Anmeldung. Ein Klick blendet die Zusammenfassung auf der Seite ein.
// Läuft nicht automatisch (das lokale Modell soll nicht bei jeder Seite rechnen). Abschaltbar: ✕ (für diese Seite) bzw.
// Einstellungen → KI. Alles in einem geschlossenen Shadow-DOM – die Seite sieht und beeinflusst nichts davon.
(() => {
  if (window.top !== window || window.__immoadvSummary) return;
  window.__immoadvSummary = true;
  const host0 = location.hostname.replace(/^www\./, '');
  const SKIP = /(^|\.)(immoadv\.de|google\.[a-z.]+|bing\.com|duckduckgo\.com|mail\.[a-z.]+|outlook\.[a-z.]+|office\.com|live\.com|teams\.microsoft\.com|meet\.google\.com|youtube\.com|ebay\.[a-z.]+|amazon\.[a-z.]+|paypal\.com|apple\.com|icloud\.com|github\.com|localhost)$/;
  if (SKIP.test(host0) || location.protocol !== 'https:') return;

  // Genug Fließtext? (Absätze zählen, keine Menüs/Knöpfe)
  function proseLength() {
    let n = 0;
    for (const p of document.querySelectorAll('article p, main p, p')) {
      const t = (p.innerText || '').trim();
      if (t.length > 60) n += t.length;
      if (n > 2500) break;
    }
    return n;
  }
  if (document.querySelector('input[type=password]')) return;

  let shadow = null, root = null, port = null, text = '';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function md(src) {
    let html = '', list = false;
    for (const raw of esc(src).split('\n')) {
      const l = raw.trim(); let m;
      const inl = (s) => s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      if ((m = /^[-*•]\s+(.*)/.exec(l))) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inl(m[1])}</li>`; continue; }
      if (list) { html += '</ul>'; list = false; }
      if ((m = /^#{1,3}\s+(.*)/.exec(l))) html += `<h4>${inl(m[1])}</h4>`;
      else if (l) html += `<p>${inl(l)}</p>`;
    }
    return html + (list ? '</ul>' : '');
  }

  function build() {
    root = document.createElement('immoadv-zusammenfassung');
    root.style.cssText = 'all:initial;position:fixed;z-index:2147483646;right:18px;bottom:18px;';
    shadow = root.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host{all:initial}
      *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
      .pill{display:flex;align-items:center;gap:2px;height:36px;padding:0 4px 0 14px;border-radius:999px;border:1px solid rgba(140,175,255,.35);
        background:rgba(15,34,64,.96);color:#eef3fb;font-size:13px;font-weight:600;box-shadow:0 10px 28px rgba(0,0,0,.32);cursor:pointer}
      .pill:hover{background:rgba(24,56,99,.98)}
      .pill .s{color:#19C2B0;margin-right:6px}
      .x{width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:#a7b4c8;font-size:15px;cursor:pointer;margin-left:4px}
      .x:hover{background:rgba(255,255,255,.1);color:#fff}
      .card{width:min(380px,calc(100vw - 36px));max-height:min(70vh,560px);display:flex;flex-direction:column;border-radius:16px;
        border:1px solid rgba(140,175,255,.3);background:rgba(15,34,64,.98);color:#eef3fb;box-shadow:0 18px 48px rgba(0,0,0,.45);overflow:hidden}
      .head{display:flex;align-items:center;justify-content:space-between;padding:10px 8px 8px 14px;border-bottom:1px solid rgba(255,255,255,.1)}
      .head b{font-size:13px}.head b span{color:#19C2B0}
      .body{padding:10px 14px 12px;overflow-y:auto;font-size:13px;line-height:1.55}
      .body p{margin:4px 0}.body ul{margin:4px 0;padding-left:18px}.body li{margin:3px 0}.body h4{margin:8px 0 4px;font-size:13px}
      .wait{display:flex;align-items:center;gap:8px;color:#a7b4c8}
      .wait i{width:6px;height:6px;border-radius:50%;background:#19C2B0;animation:p 1.2s infinite ease-in-out}
      .wait i:nth-child(2){animation-delay:.15s}.wait i:nth-child(3){animation-delay:.3s}
      @keyframes p{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
      .err{color:#ffd0d5}
      .foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 14px 10px;border-top:1px solid rgba(255,255,255,.1);color:#8a9ab3;font-size:11px}
      .foot button{height:28px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#eef3fb;font-size:12px;cursor:pointer}
      .foot button:hover{background:rgba(255,255,255,.14)}
      @media (prefers-reduced-motion:reduce){.wait i{animation:none}}
    </style><div id="box"></div>`;
    document.documentElement.appendChild(root);
    pill();
  }
  const box = () => shadow.getElementById('box');

  function pill() {
    box().innerHTML = `<div class="pill" role="button" tabindex="0" title="Diese Seite mit der KI zusammenfassen"><span class="s">✦</span>Zusammenfassen<button class="x" title="Auf dieser Seite ausblenden" aria-label="Ausblenden">✕</button></div>`;
    const p = box().querySelector('.pill');
    p.onclick = (e) => { if (e.target.closest('.x')) return; open(); };
    p.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    box().querySelector('.x').onclick = (e) => { e.stopPropagation(); browser.runtime.sendMessage({ type: 'summary:hide', host: host0 }).catch(() => {}); root.remove(); };
  }

  function open() {
    text = '';
    box().innerHTML = `<div class="card" role="dialog" aria-label="KI-Zusammenfassung">
      <div class="head"><b><span>✦</span> Zusammenfassung</b><button class="x" title="Schließen" aria-label="Schließen">✕</button></div>
      <div class="body" aria-live="polite"><div class="wait"><i></i><i></i><i></i><span>KI liest die Seite …</span></div></div>
      <div class="foot"><span>Lokal berechnet · KI kann Fehler machen</span><button class="copy" hidden>Kopieren</button></div></div>`;
    const body = box().querySelector('.body'), copy = box().querySelector('.copy');
    box().querySelector('.x').onclick = () => { try { port && port.disconnect(); } catch (e) {} port = null; pill(); };
    copy.onclick = () => { navigator.clipboard.writeText(text).then(() => { copy.textContent = 'Kopiert ✓'; }).catch(() => {}); };
    const slow = setTimeout(() => { if (!text) { const w = body.querySelector('.wait span'); if (w) w.textContent = 'Modell wird geladen – beim ersten Mal bis zu einer Minute …'; } }, 5000);
    port = browser.runtime.connect({ name: 'ai-summary' });
    port.onMessage.addListener((m) => {
      if (m.t) { text += m.t; body.innerHTML = md(text); }
      if (m.footer) box().querySelector('.foot span').textContent = m.footer;
      if (m.error) { clearTimeout(slow); body.innerHTML = `<p class="err">${esc(m.error)}</p>`; }
      if (m.done) { clearTimeout(slow); if (text) copy.hidden = false; else if (!m.error) body.innerHTML = '<p class="err">Keine Zusammenfassung erhalten – bitte noch einmal versuchen.</p>'; }
    });
    port.onDisconnect.addListener(() => clearTimeout(slow));
    port.postMessage({ go: true, title: document.title, url: location.href, text: (document.body ? document.body.innerText : '').slice(0, 24000) });
  }

  async function maybeShow() {
    let ok = false;
    try { ok = await browser.runtime.sendMessage({ type: 'summary:allowed', host: host0 }); } catch (e) { ok = false; }
    if (!ok || proseLength() < 2500) return;
    build();
  }
  // Etwas warten: Seiten laden Text oft nach
  setTimeout(maybeShow, 1500);
})();
