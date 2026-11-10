// Claude-Connector: Ausführen in der Seite (nur in Tabs, die Claude steuern darf – das prüft lib/remote.js vorher).
// Wird bei Bedarf eingespielt. Nummern (ref) für bedienbare Elemente vergibt browser_read; klicken/eingeben nutzt sie.
(() => {
  if (window.__immoadvRemote) return;
  window.__immoadvRemote = true;
  const refs = new Map(); let next = 1;
  const SENSITIVE = /^(cc-|card|cvc|cvv|iban|password|new-password|current-password|one-time-code)/i;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('alt') || el.name || '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 120);
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.innerText.trim().slice(0, 120); }
    return '';
  };
  function banner(show) {
    let h = document.getElementById('immoadv-claude');
    if (!show) { if (h) h.remove(); return; }
    if (h) return;
    h = document.createElement('immoadv-claude'); h.id = 'immoadv-claude';
    h.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:50%;transform:translateX(-50%);pointer-events:none';
    const sh = h.attachShadow({ mode: 'closed' });
    sh.innerHTML = '<div style="font:600 12px -apple-system,Segoe UI,system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#0F2C59,#1E6FD9);padding:5px 14px;border-radius:0 0 12px 12px;box-shadow:0 6px 18px rgba(0,0,0,.25)">✦ Claude steuert diesen Tab</div>';
    (document.documentElement || document.body).appendChild(h);
  }
  const SECRET_NAME = /pass|pwd|kennwort|passwort|\bpin\b|pin[-_]?code|\btan\b|otp|2fa|mfa|code|card|karte|kreditkarte|cvc|cvv|iban|bic|konto|account[-_]?n|secret|token|geheim/i;
  function read(maxChars) {
    refs.clear(); next = 1;
    const els = [];
    for (const el of document.querySelectorAll('a[href],button,input,textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[contenteditable=true],summary')) {
      if (els.length >= 300) break;
      if (!vis(el) || el.closest('immoadv-claude')) continue;
      const id = next++; refs.set(id, el);
      const tag = el.tagName.toLowerCase();
      const e = { ref: id, tag, label: label(el) };
      const role = el.getAttribute('role'); if (role) e.role = role;
      if (tag === 'a') e.href = String(el.href).slice(0, 300);
      // Audit B10 (10.11.2026): auch aufgedeckte Passwörter, PIN/TAN, Karten- und Kontonummern nie an Claude (Name/ID/Label).
      if (tag === 'input') { e.type = el.type; if (el.type !== 'password' && !SENSITIVE.test(el.autocomplete || '') && !SECRET_NAME.test(`${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.placeholder || ''} ${e.label || ''}`)) e.value = String(el.value || '').slice(0, 120); }
      if (el.disabled) e.disabled = true;
      els.push(e);
    }
    const txt = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').trim();
    return { text: txt.slice(0, maxChars || 20000), truncated: txt.length > (maxChars || 20000), elements: els };
  }
  function el(ref) { const e = refs.get(ref); if (!e || !e.isConnected) throw new Error('Element nicht mehr da – bitte zuerst browser_read erneut aufrufen.'); return e; }
  function click(ref) {
    const e = el(ref);
    e.scrollIntoView({ block: 'center', inline: 'center' });
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    e.click();
    return { clicked: ref, label: label(e) };
  }
  function type(ref, text, enter) {
    const e = el(ref);
    if ((e.type || '').toLowerCase() === 'password' || SENSITIVE.test(e.autocomplete || '') || /card|kreditkarte|cvc|cvv|iban|\bpin\b|\btan\b|pass|kennwort/i.test(`${e.name} ${e.id} ${e.getAttribute('aria-label') || ''}`)) throw new Error('Passwort- und Zahlungsfelder füllt Claude nie aus – das bitte selbst eingeben.');
    e.focus();
    if (e.isContentEditable) { document.execCommand('selectAll', false); document.execCommand('insertText', false, text); }
    else {
      const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(e, text);
      e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (enter) {
      for (const t of ['keydown', 'keypress', 'keyup']) e.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      const f = e.form; if (f) { try { f.requestSubmit(); } catch (x) { /* Seite verarbeitet Enter selbst */ } }
    }
    return { typed: ref, label: label(e) };
  }
  browser.runtime.onMessage.addListener((m) => {
    if (!m || !m.immoadvRemote) return;
    try {
      if (m.op === 'mark') { banner(true); return Promise.resolve({ ok: true }); }
      if (m.op === 'unmark') { banner(false); return Promise.resolve({ ok: true }); }
      // Audit B03 (10.11.2026): Nur auf der Adresse arbeiten, die die Erweiterung eben geprüft hat (Umleitung dazwischen → Abbruch).
      if (m.op !== 'unmark' && (!m.host || String(location.hostname).toLowerCase() !== String(m.host).toLowerCase())) return Promise.resolve({ error: 'Die Seite hat inzwischen die Adresse gewechselt – bitte erneut versuchen.' });
      banner(true);
      if (m.op === 'read') return Promise.resolve(read(m.maxChars));
      if (m.op === 'click') return Promise.resolve(click(m.ref));
      if (m.op === 'type') return Promise.resolve(type(m.ref, String(m.text || ''), !!m.enter));
      if (m.op === 'scroll') { window.scrollBy({ top: (m.direction === 'up' ? -1 : 1) * innerHeight * 0.85 * (m.pages || 1), behavior: 'instant' }); return Promise.resolve({ scrollY: Math.round(scrollY), height: document.documentElement.scrollHeight }); }
      return Promise.resolve({ error: 'Unbekannte Aktion' });
    } catch (e) { return Promise.resolve({ error: String((e && e.message) || e) }); }
  });
})();
