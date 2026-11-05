// eBay: „✦ Antwort mit KI“ an Nachrichtenfeldern (05.11.2026, Feray: eBay-Menü „Nachricht an Käufer“ – „ja“ zur KI-Antwort).
// Erscheint über jedem Nachrichtenfeld auf eBay (Nachricht an Käufer, Antworten im Postfach, Fragen zum Artikel).
// Ein Klick schreibt einen Entwurf aus dem sichtbaren Gesprächsverlauf ins Feld – gesendet wird nie automatisch.
// Läuft mit der eingestellten KI (Standard: ImmoAdv KI lokal, nichts geht ins Internet). Auch in eBay-Rahmen (Fenster).
(() => {
  if (window.__immoadvEbay) return; window.__immoadvEbay = true;
  const done = new WeakSet();
  const isMsgField = (t) => {
    if (!(t instanceof HTMLTextAreaElement) && !(t.isContentEditable && t.getAttribute('role') === 'textbox')) return false;
    const r = t.getBoundingClientRect(); if (r.width < 200 || r.height < 40) return false;
    const hint = `${t.name} ${t.id} ${t.getAttribute('aria-label') || ''} ${t.getAttribute('placeholder') || ''} ${t.closest('form,[role=dialog],section,main')?.innerText.slice(0, 400) || ''}`;
    return /nachricht|message|antwort|reply|frage|mitteilung|text/i.test(hint);
  };
  const context = (t) => {
    let box = t.closest('[role=dialog]') || t.closest('form')?.parentElement || t.closest('main') || document.body;
    for (let i = 0; i < 3 && box.innerText.length < 300 && box.parentElement; i++) box = box.parentElement;
    return box.innerText.replace(/\n{3,}/g, '\n\n').slice(-8000);
  };
  const setText = (t, v) => {
    if (t instanceof HTMLTextAreaElement) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, v); t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); }
    else { t.focus(); document.execCommand('selectAll', false); document.execCommand('insertText', false, v); }
  };
  function attach(t) {
    if (done.has(t)) return; done.add(t);
    const bar = document.createElement('immoadv-ebay-ki');
    bar.style.cssText = 'all:initial;display:block;margin:6px 0';
    const sh = bar.attachShadow({ mode: 'closed' });
    sh.innerHTML = `<style>*{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;box-sizing:border-box}
      .r{display:flex;gap:6px;align-items:center;flex-wrap:wrap}button{height:32px;padding:0 14px;border-radius:999px;border:1px solid rgba(140,175,255,.4);background:#0F2240;color:#eef3fb;font-size:13px;font-weight:600;cursor:pointer}
      button:hover{background:#183863}button:disabled{opacity:.6;cursor:default}input{height:32px;flex:1;min-width:160px;border-radius:999px;border:1px solid #c7d2e0;padding:0 12px;font-size:13px}
      small{font-size:12px;color:#5b6b80}.s{color:#19C2B0;margin-right:4px}</style>
      <div class="r"><button type="button" id="go"><span class="s">✦</span>Antwort mit KI</button><input id="w" placeholder="optional: was soll drinstehen? z. B. „Versand morgen“" aria-label="Wunsch für die KI-Antwort"><small id="st"></small></div>`;
    t.parentElement.insertBefore(bar, t);
    const go = sh.getElementById('go'), st = sh.getElementById('st');
    go.onclick = () => {
      go.disabled = true; st.textContent = 'schreibt …';
      const port = browser.runtime.connect({ name: 'ai-summary' });
      let out = '';
      port.onMessage.addListener((m) => {
        if (m.t) { out += m.t; setText(t, out.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim()); }
        if (m.error) st.textContent = m.error;
        if (m.done) { go.disabled = false; if (!m.error) st.textContent = 'Entwurf – bitte prüfen und selbst senden'; try { port.disconnect(); } catch (e) { /* zu */ } }
      });
      port.postMessage({ go: true, mode: 'reply', title: document.title, url: location.href, text: context(t), wish: sh.getElementById('w').value.trim() });
    };
  }
  const scan = () => { for (const t of document.querySelectorAll('textarea,[contenteditable=true][role=textbox]')) if (!done.has(t) && isMsgField(t)) attach(t); };
  scan();
  new MutationObserver(() => { clearTimeout(scan.t); scan.t = setTimeout(scan, 400); }).observe(document.documentElement, { childList: true, subtree: true });
})();
