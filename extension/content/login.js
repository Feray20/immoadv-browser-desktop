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
    // Zweistufige Anmeldung (Google, Microsoft, eBay, Amazon: erst E-Mail, dann Passwort auf einer neuen Seite) – den
    // Benutzernamen aus Schritt 1 nehmen, sonst würde das Passwort ohne Namen gespeichert (03.11.2026).
    let user = u && u.value ? u.value.trim() : '';
    if (!user) { try { const m = JSON.parse(sessionStorage.getItem('immoadv-pw-user') || 'null'); if (m && m.h === location.hostname && Date.now() - m.at < 15 * 60000) user = m.u; } catch (e) { /* egal */ } }
    const key = user + '\u0000' + pass;
    if (key === lastSent) return;
    lastSent = key;
    send({ type: 'pw:submitted', url: location.href, user, pass });
  }
  // Schritt 1 einer zweistufigen Anmeldung merken (nur Name/E-Mail, nur in dieser Seite, 15 Minuten).
  function rememberUser(scope) {
    if ((scope || document).querySelector('input[type="password"]')) return;
    const f = [...(scope || document).querySelectorAll('input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[id*="email" i], input[id*="user" i]')].find((i) => vis(i) && i.value && i.value.length < 200);
    if (f) { try { sessionStorage.setItem('immoadv-pw-user', JSON.stringify({ h: location.hostname, u: f.value.trim(), at: Date.now() })); } catch (e) { /* egal */ } }
  }
  window.addEventListener('submit', (e) => rememberUser(e.target), true);
  window.addEventListener('click', (e) => { const b = e.target && e.target.closest ? e.target.closest('button, input[type="submit"], [role="button"]') : null; if (b) rememberUser(b.form || b.closest('form') || document); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.type !== 'password') rememberUser(e.target.form || document); }, true);
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
  // Echte Anmeldefelder erkennen (Feray 02.11.2026: „Passwort-Eingabe muss er automatisch erkennen und ob Passkey
  // oder nicht – wie beim Mac“): Passwortfeld oder Benutzername/E-Mail einer Anmeldung. Nie bei Bestätigungs-Codes
  // (2-Faktor, SMS), Suchfeldern, Newsletter- oder Kontaktformularen und nie bei unsichtbaren Feldern.
  const shown = (el) => { if (!vis(el)) return false; const r = el.getBoundingClientRect(); if (r.width < 40 || r.height < 14) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && el.getAttribute('aria-hidden') !== 'true'; };
  const sig = (el) => `${el.name} ${el.id} ${el.autocomplete} ${el.getAttribute('aria-label') || ''} ${el.placeholder || ''}`.toLowerCase();
  const isCode = (el) => /one-time-code/.test(el.autocomplete || '') || /otp|totp|2fa|mfa|pin\b|code|token|verif|bestätig|sms/.test(sig(el)) || (el.inputMode === 'numeric' && Number(el.maxLength) > 0 && Number(el.maxLength) <= 8);
  const isPasskey = (el) => /webauthn/i.test(el.getAttribute('autocomplete') || '');
  function isLoginField(el) {
    if (!(el instanceof HTMLInputElement) || !shown(el) || isCode(el)) return false;
    if (el.type === 'password') return !isNewPw(el);
    if (!['text', 'email', 'tel', ''].includes(el.type)) return false;
    if (/search|suche|newsletter|subscribe|coupon|gutschein|promo/.test(sig(el))) return false;
    if (/\busername\b|webauthn/.test(el.autocomplete || '')) return true;
    const scope = el.form || el.closest('[role="dialog"], main, body');
    const pwNear = !!scope && [...scope.querySelectorAll('input[type="password"]')].some(shown);
    const looksUser = el.type === 'email' || /user|login|mail|benutzer|konto|account|identifier|anmelde/.test(sig(el));
    // Zweistufige Anmeldung (Google, eBay, Microsoft): erst nur E-Mail – dann muss die Seite nach Anmeldung aussehen.
    const loginPage = /login|signin|sign-in|anmeld|auth|account|konto/i.test(location.pathname + location.hostname + document.title);
    return looksUser && (pwNear || loginPage);
  }
  function anchorField() {
    const a = document.activeElement;
    if (a && isLoginField(a)) return a;
    return [...document.querySelectorAll('input[type="password"]')].find(isLoginField) || null;
  }
  // Gleiche Symbole wie am Mac (Schlüssel bzw. Person mit Schlüssel) – SVG statt Emoji, damit alle Zeilen exakt auf einer Linie stehen.
  const ICON_KEY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M16 7l3 3M18 5l2 2"/></svg>';
  const ICON_PK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="7" r="4"/><path d="M2 21v-1a6 6 0 0 1 9.5-4.9"/><circle cx="17" cy="16" r="2.5"/><path d="M18.8 17.8 22 21M20.5 19.5l-1 1"/></svg>';
  function placeChip() {
    if (!chip || !chipFor || !chipFor.isConnected) return;
    const r = chipFor.getBoundingClientRect();
    if (!r.width) { chip.style.display = 'none'; return; }
    chip.style.display = 'block';
    const h = chip.offsetHeight || 36;
    // Wie am Mac: Liste direkt unter dem Feld, so breit wie das Feld (oben nur, wenn unten kein Platz ist).
    chip.style.minWidth = Math.max(220, Math.min(r.width, 420)) + 'px';
    chip.style.left = Math.max(8, Math.min(window.innerWidth - chip.offsetWidth - 8, r.left)) + 'px';
    chip.style.top = (r.bottom + 4 + h <= window.innerHeight - 4 ? r.bottom + 4 : Math.max(4, r.top - h - 4)) + 'px';
  }
  async function fillWith(e, b) {
    const sm = b && b.querySelector('small');
    // Text erst nach einer halben Sekunde – im Normalfall ist das Feld bis dahin schon ausgefüllt (04.11.2026)
    const wait0 = setTimeout(() => { if (sm && sm.isConnected) sm.textContent = 'Wird übernommen …'; }, 500);
    // Wartet die Freigabe länger (Mac: Schlüsselbund-Abfrage nach einem Update), sagen, was zu tun ist – statt still zu hängen.
    const slow = setTimeout(() => { if (sm && sm.isConnected) sm.textContent = navigator.platform.startsWith('Mac') ? 'Bitte die Mac-Abfrage „Schlüsselbund“ mit „Immer erlauben“ bestätigen …' : 'Bitte die Windows-Abfrage bestätigen …'; }, 4000);
    // Nie länger als 30 s „Wird übernommen …“ (05.11.2026) – danach Hinweis und erneut tippen möglich.
    const r = await Promise.race([send({ type: 'pw:fill', id: e.id, url: location.href }).catch(() => null), new Promise((res) => setTimeout(() => res(null), 30000))]);
    clearTimeout(slow); clearTimeout(wait0);
    if (!r || !r.pass) { if (sm) sm.textContent = 'Konnte nicht ausfüllen – ist der ImmoAdv Browser über sein Symbol gestartet? Erneut tippen.'; return; }
    const pw = [...document.querySelectorAll('input[type="password"]')].find(vis);
    // Feld, auf dem die Liste stand, zuerst – dann das zum Passwortfeld gehörende Benutzerfeld.
    const u = chipFor && chipFor.type !== 'password' && vis(chipFor) ? chipFor : pw ? userFieldFor(pw) : anchorField();
    if (vis(u) && r.user) setVal(u, r.user);
    if (pw) setVal(pw, r.pass);
    // Zweistufige Anmeldung (Google, Microsoft, eBay, Amazon): Passwortfeld kommt erst im nächsten Schritt – das Passwort
    // 3 Minuten nur im Arbeitsspeicher dieser Seite bereithalten und einsetzen, sobald das Feld erscheint.
    else { heldPass = { pass: r.pass, until: Date.now() + 180000 }; watchHeld(); }
    closeChip();
  }
  function closeChip() { if (chip) chip.remove(); chip = null; chipFor = null; }
  let heldPass = null, heldMo = null;
  function useHeld() {
    if (!heldPass) return;
    if (Date.now() > heldPass.until) { heldPass = null; if (heldMo) heldMo.disconnect(); heldMo = null; return; }
    const pw = [...document.querySelectorAll('input[type="password"]')].find((i) => vis(i) && !i.value && !isNewPw(i));
    if (!pw) return;
    setVal(pw, heldPass.pass); heldPass = null; if (heldMo) heldMo.disconnect(); heldMo = null;
  }
  function watchHeld() { if (heldMo) return; heldMo = new MutationObserver(() => useHeld()); heldMo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'style', 'class', 'hidden'] }); setTimeout(() => { heldPass = null; if (heldMo) heldMo.disconnect(); heldMo = null; }, 180000); }
  function offerFill(entries, field) {
    entriesNow = entries;
    const f = field || anchorField();
    if (!f) return;
    closeChip();
    chip = document.createElement('immoadv-pw');
    chip.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;top:0;';
    const sr = chip.attachShadow({ mode: 'closed' });
    const host0 = location.hostname.replace(/^www\./, '');
    sr.innerHTML = `<style>
      .c{box-sizing:border-box;width:100%;max-width:min(420px,calc(100vw - 16px));font:13px/1.25 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;color:#eef3fb;
        background:rgba(15,34,64,.98);border:1px solid rgba(140,175,255,.28);border-radius:12px;padding:5px;box-shadow:0 14px 34px rgba(0,0,0,.4)}
      .h{display:flex;justify-content:space-between;align-items:center;padding:4px 8px 6px;color:#a7b4c8;font-size:11.5px}
      .r{display:flex;gap:10px;align-items:center;width:100%;min-height:40px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
      .r:hover,.r:focus-visible{background:linear-gradient(120deg,#2A5BD7,#3a6cf0 45%,#19C2B0);color:#fff;outline:none}
      .i{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.12);color:#cfe0ff}
      .i svg{width:15px;height:15px;display:block}.r:hover .i,.r:focus-visible .i{background:rgba(255,255,255,.22);color:#fff}
      .t{flex:1}
      .t{min-width:0}.t b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.t small{display:block;color:#a7b4c8;font-size:11.5px}
      .r:hover small{color:#e5edff}.x{border:0;background:transparent;color:#a7b4c8;cursor:pointer;font:inherit;padding:0 2px}.x:hover{color:#fff}
    </style><div class="c" role="listbox" aria-label="Gespeicherte Anmeldung"><div class="h"><span>Gespeichertes Passwort · ${esc(host0)}</span><button class="x" data-x aria-label="Schließen">✕</button></div>
      ${entries.slice(0, 6).map((e, i) => `<button class="r" role="option" data-i="${i}"><span class="i">${ICON_KEY}</span><span class="t"><b>${esc(e.user || 'Ohne Benutzername')}</b><small>${esc(e.host || host0)}</small></span></button>`).join('')}</div>`;
    sr.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('mousedown', (ev) => { ev.preventDefault(); fillWith(entries[b.dataset.i], b); }));
    sr.querySelector('[data-x]').addEventListener('mousedown', (ev) => { ev.preventDefault(); closeChip(); });
    chipFor = f;
    document.documentElement.append(chip);
    placeChip();
    if (!warmed) { warmed = true; send({ type: 'pw:warm' }); }
  }
  let warmed = false;
  document.addEventListener('focusout', (ev) => { if (chip && ev.target === chipFor) setTimeout(() => { if (chip && document.activeElement !== chipFor) closeChip(); }, 150); }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && chip) closeChip(); }, true);
  window.addEventListener('scroll', placeChip, { passive: true, capture: true });
  window.addEventListener('resize', placeChip, { passive: true });
  // Starkes Passwort vorschlagen (Registrierung / Passwort ändern): Knopf über dem Feld, füllt alle neuen Passwortfelder.
  function genPass() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', r = new Uint32Array(18); crypto.getRandomValues(r);
    const raw = [...r].map((x) => A[x % A.length]).join('');
    return `${raw.slice(0, 6)}-${raw.slice(6, 12)}-${raw.slice(12, 18)}`;
  }
  function isNewPw(t) {
    if (!(t instanceof HTMLInputElement) || t.type !== 'password') return false;
    if (/new-password/i.test(t.autocomplete || '')) return true;
    const scope = t.form || document; const pws = [...scope.querySelectorAll('input[type="password"]')].filter(vis);
    return pws.length >= 2 && !/current-password/i.test(t.autocomplete || '');
  }
  function offerGenerate(t) {
    closeChip();
    chip = document.createElement('immoadv-pw');
    chip.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;top:0;';
    const sr = chip.attachShadow({ mode: 'closed' });
    sr.innerHTML = `<style>.c{display:flex;gap:6px;align-items:center;font:13px/1 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;background:rgba(15,34,64,.97);border:1px solid rgba(140,175,255,.3);border-radius:12px;padding:5px;box-shadow:0 10px 28px rgba(0,0,0,.35)}
      button{font:inherit;height:28px;padding:0 11px;border-radius:8px;border:0;cursor:pointer;color:#fff;background:linear-gradient(120deg,#2A5BD7,#3a6cf0 45%,#19C2B0)}button.x{background:transparent;color:#a7b4c8;padding:0 8px}</style>
      <div class="c"><span style="color:#cfe0ff;padding:0 4px 0 6px">🔐</span><button data-g>Starkes Passwort verwenden</button><button class="x" data-x>✕</button></div>`;
    sr.querySelector('[data-g]').addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const pw = genPass(); const scope = t.form || document;
      for (const f of [...scope.querySelectorAll('input[type="password"]')].filter(vis)) if (isNewPw(f) || f === t) setVal(f, pw);
      closeChip();
    });
    sr.querySelector('[data-x]').addEventListener('mousedown', (ev) => { ev.preventDefault(); closeChip(); });
    chipFor = t; document.documentElement.append(chip); placeChip();
  }
  document.addEventListener('focusin', (ev) => { const t = ev.target; if (isNewPw(t) && chipFor !== t && !t.value) offerGenerate(t); }, true);

  // Erneut anbieten, wenn ein Anmeldefeld angeklickt wird (z. B. nach „Schließen“ oder bei zweistufiger Anmeldung wie eBay).
  document.addEventListener('focusin', (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) || chipFor === t || isNewPw(t) || !isLoginField(t)) return;
    if (!entriesNow.length) { asked = false; look(); return; }
    offerFill(entriesNow, t);
  }, true);
  async function offerSave(p) {
    const box = ui().querySelector('.box');
    const upd = p.mode === 'update';
    box.innerHTML = upd
      ? `<div class="t"><i>🔑</i>Passwort aktualisieren?</div><p>Für ${esc(p.user || 'diese Anmeldung')} auf ${esc(p.site)} ist ein anderes Passwort gespeichert. Das neue übernehmen – auf allen deinen Geräten.</p>
      <div class="row"><button class="a" data-c="save">Aktualisieren</button><button data-c="no">Nein</button></div>`
      : `<div class="t"><i>🔑</i>Passwort speichern?</div><p>${esc(p.user || 'Anmeldung')} auf ${esc(p.site)} – verschlüsselt im ImmoAdv-Tresor, auf allen deinen Geräten.</p>
      <div class="row"><button class="a" data-c="save">Speichern</button><button data-c="never">Nie für diese Seite</button><button data-c="no">Nein</button></div>`;
    box.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { send({ type: 'pw:decide', choice: b.dataset.c }); close(); }));
    setTimeout(close, 45000);
  }

  // Nur Einträge für diese Seite holen (einmal), angezeigt wird erst beim Antippen eines Anmeldefelds – wie am Mac.
  let asked = false;
  async function look() {
    if (asked || !anchorField()) return;
    asked = true;
    const entries = await send({ type: 'pw:forUrl', url: location.href });
    if (entries && entries.length) { entriesNow = entries; const a = document.activeElement; if (a && isLoginField(a)) offerFill(entries, a); }
  }
  // „Passwort speichern?“ auch ohne neuen Seitenaufbau (Hintergrund meldet sich nach dem Absenden selbst).
  let offered = '';
  const showOffer = (p) => { const k = `${p.user}|${p.site}|${p.mode}`; if (k === offered) return; offered = k; offerSave(p); };
  browser.runtime.onMessage.addListener((m) => { if (m && m.type === 'pw:offer' && m.p) showOffer(m.p); });
  (async () => {
    const p = await send({ type: 'pw:pending', url: location.href });
    if (p) showOffer(p);
    look();
    const mo = new MutationObserver(() => { look(); if (asked) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 20000);
  })();
})();
