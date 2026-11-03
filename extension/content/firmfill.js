// Formular mit den eigenen Firmendaten füllen (nur auf Klick, schickt nie ab). Erkennt Felder an autocomplete,
// name, id, Beschriftung und Platzhalter – deutsch und englisch. Bereits ausgefüllte Felder bleiben unverändert.
(() => {
  const F = window.__immoFirm || {};
  delete window.__immoFirm;
  const RULES = [
    ['vat', /ust.?id|umsatzsteuer.?id|vat|tax.?id|steuer.?id/i, []],
    ['taxno', /steuernummer|steuer.?nr|tax.?number/i, []],
    ['company', /firma|firmenname|unternehmen|company|organi[sz]ation|business.?name/i, ['organization']],
    ['first', /vorname|first.?name|given.?name|fname/i, ['given-name']],
    ['last', /nachname|last.?name|family.?name|surname|lname/i, ['family-name']],
    ['name', /^(name|full.?name|ihr name|your name|ansprechpartner|kontaktperson|contact)$|vollst.ndiger name|ansprechpartner/i, ['name']],
    ['email', /e.?mail/i, ['email']],
    ['phone', /telefon|phone|tel\b|mobil|handy/i, ['tel', 'tel-national']],
    ['street', /stra(ß|ss)e|street|adresse|address.?(line)?.?1?$|anschrift/i, ['street-address', 'address-line1']],
    ['zip', /plz|postleitzahl|zip|postal/i, ['postal-code']],
    ['city', /\bort\b|stadt|city|town|wohnort/i, ['address-level2']],
    ['country', /land\b|country|staat/i, ['country', 'country-name']],
    ['website', /website|webseite|homepage|\burl\b|internetseite/i, ['url']],
  ];
  const parts = String(F.name || '').trim().split(/\s+/);
  const val = { ...F, first: F.first || (parts.length > 1 ? parts.slice(0, -1).join(' ') : ''), last: F.last || (parts.length > 1 ? parts[parts.length - 1] : '') };
  const labelOf = (el) => {
    const t = [];
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t.push(l.textContent); }
    const p = el.closest('label'); if (p) t.push(p.textContent);
    t.push(el.getAttribute('aria-label') || '', el.placeholder || '', el.name || '', el.id || '');
    return t.map((x) => String(x).replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean);
  };
  const setVal = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (el instanceof HTMLSelectElement) {
      const o = [...el.options].find((x) => x.text.trim().toLowerCase() === v.toLowerCase() || x.value.toLowerCase() === v.toLowerCase() || (v.toLowerCase() === 'deutschland' && /^(de|deu|germany)$/i.test(x.value)));
      if (!o) return false; v = o.value;
    }
    el.focus(); d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur();
    return true;
  };
  let filled = 0;
  const used = new Set();
  const fields = [...document.querySelectorAll('input, textarea, select')].filter((el) => {
    if (el.disabled || el.readOnly) return false;
    const t = (el.type || '').toLowerCase();
    if (el.tagName === 'INPUT' && !['', 'text', 'email', 'tel', 'url', 'search'].includes(t)) return false;
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && String(el.value || '').trim() === '';
  });
  for (const el of fields) {
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).pop();
    const lab = labelOf(el);
    let key = null;
    for (const [k, re, acs] of RULES) { if (acs.includes(ac)) { key = k; break; } }
    if (!key) for (const [k, re] of RULES) { if (lab.some((x) => re.test(x))) { key = k; break; } }
    if (!key) continue;
    if (el.type === 'email') key = 'email'; else if (el.type === 'tel') key = 'phone';
    const v = String(val[key] || '').trim();
    if (!v) continue;
    if (setVal(el, v)) { filled++; used.add(key); el.style.transition = 'box-shadow .3s'; el.style.boxShadow = '0 0 0 2px rgba(25,194,176,.7)'; setTimeout(() => { el.style.boxShadow = ''; }, 1600); }
  }
  return { filled };
})();
