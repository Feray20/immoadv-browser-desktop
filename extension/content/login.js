// Anmeldeformulare: gespeicherte Zugangsdaten anbieten (Ausfüllen erst nach Windows Hello / Touch ID)
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
      .box{font:13px/1.45 "Segoe UI Variable Text","Segoe UI",-apple-system,system-ui,sans-serif;color:#eef3fb;background:rgba(13,27,48,.97);
        border:1px solid rgba(255,255,255,.14);border-radius:16px;box-shadow:0 18px 48px rgba(0,0,0,.45);padding:14px;width:300px}
      .t{font-weight:600;margin:0 0 4px;display:flex;align-items:center;gap:8px}.t i{width:22px;height:22px;border-radius:7px;background:linear-gradient(120deg,#2A5BD7,#3a6cf0 45%,#19C2B0);display:inline-grid;place-items:center;font-style:normal;font-size:12px}
      p{margin:0 0 10px;color:#a7b4c8}.row{display:flex;gap:6px;flex-wrap:wrap}
      button{font:inherit;height:30px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.045);color:#eef3fb;cursor:pointer}
      button:hover{background:rgba(255,255,255,.11)}button.a{border:0;background:linear-gradient(120deg,#2A5BD7,#3a6cf0 45%,#19C2B0);color:#fff}
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
  async function offerFill(entries) {
    const box = ui().querySelector('.box');
    box.innerHTML = `<div class="t"><i>🔑</i>Gespeicherte Anmeldung</div><p>Mit Windows Hello / Touch ID freigeben und ausfüllen.</p>
      ${entries.map((e, i) => `<button class="u" data-i="${i}">${esc(e.user || '(ohne Benutzername)')}</button>`).join('')}
      <div class="row"><button data-x>Schließen</button></div>`;
    box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
      b.textContent = 'Warte auf Freigabe …';
      const r = await send({ type: 'pw:fill', id: entries[b.dataset.i].id, url: location.href });
      if (!r || !r.pass) { b.textContent = 'Freigabe abgebrochen'; return; }
      const pw = [...document.querySelectorAll('input[type="password"]')].find(vis);
      const u = pw ? userFieldFor(pw) : document.querySelector('input[autocomplete="username"], input[type="email"]');
      if (vis(u) && r.user) setVal(u, r.user);
      if (pw) setVal(pw, r.pass);
      close();
    }));
    box.querySelector('[data-x]').addEventListener('click', close);
  }
  async function offerSave(p) {
    const box = ui().querySelector('.box');
    box.innerHTML = `<div class="t"><i>🔑</i>Passwort speichern?</div><p>${esc(p.user || 'Anmeldung')} auf ${esc(p.site)} – verschlüsselt im ImmoAdv-Tresor, auf allen deinen Geräten.</p>
      <div class="row"><button class="a" data-c="save">Speichern</button><button data-c="never">Nie für diese Seite</button><button data-c="no">Nein</button></div>`;
    box.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { send({ type: 'pw:decide', choice: b.dataset.c }); close(); }));
    setTimeout(close, 45000);
  }

  let asked = false;
  async function look() {
    if (asked || !document.querySelector('input[type="password"]')) return;
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
