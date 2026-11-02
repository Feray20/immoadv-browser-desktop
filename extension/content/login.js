// Anmeldeformulare: gespeicherte Zugangsdaten direkt am Feld anbieten (wie bei Apple: kleiner Knopf über dem Feld, ein Klick füllt aus)
// und nach dem Absenden „Passwort speichern?“ fragen. Passwörter gehen nur an den eigenen Tresor auf diesem Computer.
(() => {
  if (window.top !== window) return;
  const send = (m) => browser.runtime.sendMessage(m).catch(() => null);
  const vis = (el) => !!(el && el.offsetParent !== null && !el.disabled && !el.readOnly);

  function userFieldFor(pw) {
    const scope = pw.form || document;
    const inputs = [...scope.querySelectorAll('input')].filter((i) => vis(i) && !['hidden', 'password', 'checkbox', 'radio', 'submit', 'button'].includes(i.type));
    const all = [...scope.querySelectorAll('input')]; const idx = all.indexOf(pw);
    return inputs.filter((i) => all.indexOf(i) < idx).pop() || document.querySelector('input[autocomplete="username"], input[type="email"]');
  }
  let lastSent = '';
  function capture(form) {
    const pws = [...(form || document).querySelectorAll('input[type="password"]')].filter((i) => i.value);
    if (!pws.length) return;
    const pass = pws[pws.length - 1].value;   // Registrierung/Passwortwechsel: das letzte Feld ist das neue Passwort
    const u = userFieldFor(pws[0]);
    const user = u && u.value ? u.value.trim() : '';
    const key = user + '\u0000' + pass;
    if (key === lastSent) return;
    lastSent = key;
    send({ type: 'pw:submitted', url: location.href, user, pass });
  }
  window.addEventListener('submit', (e) => capture(e.target), true);
  window.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button, input[type="submit"], [role="button"]') : null;
    if (b) setTimeout(() => capture(b.form || b.closest('form') || document), 0);
  }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.type === 'password') capture(e.target.form || document); }, true);

  // ---------- ImmoAdv-Hinweise im Fade-Stil (abgeschottet in einem Shadow-Root) ----------
  let host = null, root = null;
  function ui() {
    if (root) return root;
    host = document.createElement('immoadv-hinweis');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:12px;right:12px;';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .box{font:13px/1.45 "Segoe UI Variable Text","Segoe UI",-apple-system,system-ui,sans-serif;color:#eef3fb;background:rgba(24,56,99,.97);
        border:1px solid rgba(255,255,255,.14);border-radius:16px;box-shadow:0 18px 48px rgba(0,0,0,.45);padding:14px;width:300px}
      .t{font-weight:600;margin:0 0 4px;display:flex;align-items:center;gap:8px}.t i{width:22px;height:22px;border-radius:7px;background:linear-gradient(120deg,#2A5BD7,#3a6cf0 45%,#19C2B0);display:inline-grid;place-items:center;font-style:normal;font-size:12px}
      p{margin:0 0 10px;color:#a7b4c8}.row{display:flex;gap:6px;flex-wrap:wrap}
      button{font:inherit;height:30px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);color:#eef3fb;cursor:pointer}
      button:hover{background:rgba(255,255,255,.16)}button.a{border:0;background:linear-gradient(120deg,#2A5BD7,#3a6cf0 45%,#19C2B0);color:#fff}
      .u{display:block;width:100%;text-align:left;border-radius:10px;margin:0 0 6px}
      @media (prefers-reduced-motion:no-preference){.box{animation:in .18s cubic-bezier(.2,.8,.2,1)}@keyframes in{from{opacity:0;transform:translateY(-6px)}}}
    </style><div class="box" role="dialog" aria-live="polite"></div>`;
    document.documentElement.append(host);
    return root;
  }
  function close() { if (host) host.remove(); host = null; root = null; }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function setVal(el, v) {
    if (!el) return;
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Wie bei Apple (Feray 02.11.2026): kleine Leiste direkt über dem Anmeldefeld – „Passwort übernehmen“, ein Klick füllt
  // Benutzername und Passwort aus. Kein Windows Hello / Touch ID mehr fürs Ausfüllen (Passkeys fragt die Seite selbst).
  let chip = null, chipFor = null, entriesNow = [];
  function anchorField() {
    const pw = [...document.querySelectorAll('input[type="password"]')].find(vis);
    if (pw) return pw;
    return [...document.querySelectorAll('input[autocomplete="username"], input[type="email"], input[name*="user" i], input[id*="user" i], input[name*="login" i], input[id*="email" i]')].find(vis) || null;
  }
  function placeChip() {
    if (!chip || !chipFor || !chipFor.isConnected) return;
    const r = chipFor.getBoundingClientRect();
    if (!r.width) { chip.style.display = 'none'; return; }
    chip.style.display = '';
    const h = chip.offsetHeight || 36;
    chip.style.left = Math.max(8, Math.min(window.innerWidth - chip.offsetWidth - 8, r.left)) + 'px';
    chip.style.top = (r.top - h - 6 >= 4 ? r.top - h - 6 : r.bottom + 6) + 'px';
  }
  async function fillWith(e, b) {
    if (b) b.textContent = 'Wird übernommen …';
    const r = await send({ type: 'pw:fill', id: e.id, url: location.href });
    if (!r || !r.pass) { if (b) b.textContent = 'Nicht möglich'; return; }
    const pw = [...document.querySelectorAll('input[type="password"]')].find(vis);
    const u = pw ? userFieldFor(pw) : anchorField();
    if (vis(u) && r.user) setVal(u, r.user);
    if (pw) setVal(pw, r.pass);
    closeChip();
  }
  function closeChip() { if (chip) chip.remove(); chip = null; chipFor = null; }
  function offerFill(entries, field) {
    entriesNow = entries;
    const f = field || anchorField();
    if (!f) return;
    closeChip();
    chip = document.createElement('immoadv-pw');
    chip.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;top:0;';
    const sr = chip.attachShadow({ mode: 'closed' });
    sr.innerHTML = `<style>
      .c{display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:min(520px,calc(100vw - 16px));font:13px/1 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;
        background:rgba(15,34,64,.97);border:1px solid rgba(140,175,255,.3);border-radius:12px;padding:5px;box-shadow:0 10px 28px rgba(0,0,0,.35)}
      button{font:inherit;height:28px;padding:0 11px;border-radius:8px;border:0;cursor:pointer;color:#fff;background:linear-gradient(120deg,#2A5BD7,#3a6cf0 45%,#19C2B0);white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}
      button.x{background:transparent;color:#a7b4c8;padding:0 8px}button.x:hover{color:#fff}
      .k{color:#cfe0ff;padding:0 4px 0 6px}
    </style><div class="c" role="group" aria-label="Gespeicherte Anmeldung"><span class="k">🔑</span>${entries.slice(0, 4).map((e, i) => `<button data-i="${i}" title="Passwort übernehmen">${esc(entries.length > 1 ? (e.user || 'Passwort übernehmen') : (e.user ? 'Passwort übernehmen · ' + e.user : 'Passwort übernehmen'))}</button>`).join('')}<button class="x" data-x aria-label="Schließen">✕</button></div>`;
    sr.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('mousedown', (ev) => { ev.preventDefault(); fillWith(entries[b.dataset.i], b); }));
    sr.querySelector('[data-x]').addEventListener('mousedown', (ev) => { ev.preventDefault(); closeChip(); });
    chipFor = f;
    document.documentElement.append(chip);
    placeChip();
  }
  window.addEventListener('scroll', placeChip, { passive: true, capture: true });
  window.addEventListener('resize', placeChip, { passive: true });
  // Erneut anbieten, wenn ein Anmeldefeld angeklickt wird (z. B. nach „Schließen“ oder bei zweistufiger Anmeldung wie eBay).
  document.addEventListener('focusin', (ev) => {
    const t = ev.target;
    if (!entriesNow.length || !(t instanceof HTMLInputElement) || chipFor === t) return;
    if (t.type === 'password' || /user|login|mail|benutzer|konto/i.test(`${t.name} ${t.id} ${t.autocomplete} ${t.type}`)) offerFill(entriesNow, t);
  }, true);
  async function offerSave(p) {
    const box = ui().querySelector('.box');
    box.innerHTML = `<div class="t"><i>🔑</i>Passwort speichern?</div><p>${esc(p.user || 'Anmeldung')} auf ${esc(p.site)} – verschlüsselt im ImmoAdv-Tresor, auf allen deinen Geräten.</p>
      <div class="row"><button class="a" data-c="save">Speichern</button><button data-c="never">Nie für diese Seite</button><button data-c="no">Nein</button></div>`;
    box.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { send({ type: 'pw:decide', choice: b.dataset.c }); close(); }));
    setTimeout(close, 45000);
  }

  let asked = false;
  async function look() {
    if (asked || !anchorField()) return;
    asked = true;
    const entries = await send({ type: 'pw:forUrl', url: location.href });
    if (entries && entries.length) offerFill(entries);
  }
  (async () => {
    const p = await send({ type: 'pw:pending', url: location.href });
    if (p) offerSave(p);
    look();
    const mo = new MutationObserver(() => { look(); if (asked) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 20000);
  })();
})();
