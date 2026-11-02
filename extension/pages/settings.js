'use strict';
const $ = (id) => document.getElementById(id);
const send = (m) => browser.runtime.sendMessage(m);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isMac = navigator.platform.startsWith('Mac');
const lockName = isMac ? 'Touch ID' : 'Windows Hello';
let st = null, tab = (location.hash || '#allgemein').slice(1);
const ENGINE_KEYS = ['tabLayout', 'bookmarkBar', 'httpsOnly', 'dnsProvider', 'suspendMinutes', 'historyDays', 'restoreSession', 'searchEngine'];

function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2600); }
const sw = (id, on, label, desc) => `<div class="row"><span>${label}${desc ? `<span class="desc">${desc}</span>` : ''}</span><label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i></label></div>`;
async function setS(patch) {
  st.settings = await send({ type: 'settings:set', patch });
  if (Object.keys(patch).some((k) => ENGINE_KEYS.includes(k))) {
    const r = await send({ type: 'engine:set', patch });
    if (r && r.restart) $('restart').classList.remove('hidden');
  }
}
const bindSwitch = (id, key, after) => { const el = $(id); if (el) el.onchange = async () => { await setS({ [key]: el.checked }); if (after) after(el.checked); }; };
const foldList = (key, label, html, n) => `<details class="fold"><summary>${label} <span class="hint">${n}</span></summary>${html}</details>`;
const dom = (v) => String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

const SEGS = [['allgemein', 'Allgemein'], ['datenschutz', 'Datenschutz'], ['sicherheit', 'Sicherheit'], ['passwoerter', 'Passwörter'], ['adressen', 'Adressen'], ['sync', 'Sync'], ['vpn', 'NordVPN'], ['ki', 'KI'], ['merkliste', 'Merkliste'], ['updates', 'Updates']];
function nav() {
  $('seg').innerHTML = SEGS.map(([k, l]) => `<button data-k="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
  $('seg').querySelectorAll('button').forEach((b) => { b.onclick = () => { tab = b.dataset.k; history.replaceState(null, '', '#' + tab); render(); }; });
}
const body = (html) => { $('body').innerHTML = html; };

async function render() {
  st = await send({ type: 'state' });
  $('ver').textContent = 'Version ' + st.version + (st.native ? '' : ' · Programm nicht verbunden');
  nav();
  ({ allgemein, datenschutz, sicherheit, passwoerter, adressen, sync, vpn, ki, merkliste, updates }[tab] || allgemein)();
}

function allgemein() {
  const s = st.settings;
  const engines = [['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['startpage', 'Startpage'], ['bing', 'Bing'], ['ecosia', 'Ecosia']];
  body(`<div class="group"><h3>Google-Konto</h3><p class="small">Google, YouTube (Premium), Gmail und Passkeys funktionieren direkt hier im ImmoAdv Browser – einfach auf google.com anmelden. Du bleibst angemeldet.</p></div>
    <div class="group"><h3>Standardbrowser</h3><div class="row"><span>ImmoAdv Browser als Standard<span class="desc">Links aus Mails, Programmen und PDFs öffnen hier</span></span><button class="pill accent" id="defBtn">Festlegen</button></div></div>
    <div class="group"><h3>Start & Tabs</h3>
      ${sw('sRestore', s.restoreSession !== false, 'Offene Tabs beim Start wiederherstellen')}
      <div class="row"><span>Tabs anzeigen</span><select id="sLayout"><option value="horizontal" ${s.tabLayout !== 'vertical' ? 'selected' : ''}>Oben (waagerecht)</option><option value="vertical" ${s.tabLayout === 'vertical' ? 'selected' : ''}>Links (senkrecht)</option></select></div>
      <div class="row"><span>Hintergrund-Tabs schlafen legen<span class="desc">spart Arbeitsspeicher und Akku</span></span><select id="sSuspend">${[[0, 'Nie'], [15, 'nach 15 Min.'], [30, 'nach 30 Min.'], [60, 'nach 1 Std.']].map(([v, l]) => `<option value="${v}" ${Number(s.suspendMinutes) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${sw('sBar', s.bookmarkBar !== false, 'Lesezeichenleiste', 'Strg/⌘+Umschalt+B')}</div>
    <div class="group"><h3>Suche</h3><div class="row"><span>Suchmaschine</span><select id="sEngine">${engines.map(([v, l]) => `<option value="${v}" ${s.searchEngine === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="group"><h3>Downloads</h3><div class="row"><span>Speichern in<span class="desc" id="dlDir">${esc(s.downloadDir || 'Download-Ordner')}</span></span><button class="pill" id="sDl">Ordner wählen …</button></div></div>
    <div class="group"><h3>Tastenkürzel</h3>${[['Neuer Tab', 'Strg+T'], ['Tab schließen', 'Strg+W'], ['Geschlossenen Tab öffnen', 'Strg+Umschalt+T'], ['Adressleiste', 'Strg+L'], ['Suchen auf der Seite', 'Strg+F'], ['KI-Assistent', 'Strg+Umschalt+A'], ['ImmoAdv-Menü', 'Alt+Umschalt+I'], ['Verlauf', 'Strg+H'], ['Downloads', 'Strg+Umschalt+Y'], ['Lesezeichen setzen', 'Strg+D']].map(([l, k]) => `<div class="row"><span>${l}</span><span class="hint">${isMac ? k.replace('Strg', '⌘') : k}</span></div>`).join('')}</div>
    <div class="group"><h3>Erweitert</h3><p class="small">Selten gebrauchte Motor-Einstellungen (Schriften, Sprachen, Barrierefreiheit): <b>about:preferences?firefox</b> in die Adressleiste eingeben.</p></div>
    <p class="hint">ImmoAdv Browser ${esc(st.version)} · Motor: Firefox ESR ${esc((navigator.userAgent.match(/Firefox\/([\d.]+)/) || [])[1] || '')} (Mozilla, automatische Sicherheitsupdates)</p>`);
  bindSwitch('sRestore', 'restoreSession'); bindSwitch('sBar', 'bookmarkBar');
  $('sLayout').onchange = () => setS({ tabLayout: $('sLayout').value });
  $('sSuspend').onchange = () => setS({ suspendMinutes: Number($('sSuspend').value) });
  $('sEngine').onchange = () => setS({ searchEngine: $('sEngine').value });
  $('defBtn').onclick = async () => { const r = await send({ type: 'engine:set', patch: { makeDefault: true } }); toast(r && r.message ? r.message : 'Windows-Einstellungen geöffnet: bei „ImmoAdv Browser“ auf „Als Standard festlegen“ klicken'); };
  $('sDl').onclick = async () => { const r = await send({ type: 'engine:set', patch: { chooseDownloadDir: true } }); if (r && r.dir) { $('dlDir').textContent = r.dir; $('restart').classList.remove('hidden'); } };
}

function datenschutz() {
  const s = st.settings;
  const keep = s.keepSignedIn || [];
  body(`<div class="group"><h3>Spurlos surfen</h3>${sw('pTrace', s.traceless !== false, 'Cookies einer Seite löschen, sobald ihr letzter Tab zu ist', 'außer auf den Seiten unten und Seiten mit gespeichertem Passwort')}</div>
    <div class="group"><h3>Angemeldet bleiben</h3>
      ${foldList('keep', 'Seiten anzeigen', keep.map((d, i) => `<div class="list-item"><div class="grow"><b>${esc(d)}</b></div><button class="icon" data-k="${i}" title="Entfernen" aria-label="Entfernen">✕</button></div>`).join(''), keep.length)}
      <div class="addrow"><input type="text" id="kAdd" placeholder="z. B. amazon.de"><button class="pill" id="kAddBtn">Hinzufügen</button></div></div>
    <div class="group"><h3>Verlauf</h3><div class="row"><span>Verlauf aufbewahren<span class="desc">nur auf diesem Computer</span></span><select id="pHist">${[[0, 'Gar nicht'], [7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage'], [365, '1 Jahr']].map(([v, l]) => `<option value="${v}" ${Number(s.historyDays) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="group"><h3>Links</h3>${sw('pClean', s.cleanLinks !== false, 'Tracking aus Links entfernen', 'utm, fbclid, gclid …')}</div>
    <div class="group"><h3>Firefox-Schutz (zusätzlich)</h3><p class="small">Strenger Tracking-Schutz, vollständiger Cookie-Schutz (jede Seite eigene Keksdose), Fingerprinting-Schutz und „Bitte nicht verkaufen“-Signal sind fest eingeschaltet.</p></div>`);
  bindSwitch('pTrace', 'traceless'); bindSwitch('pClean', 'cleanLinks');
  $('body').querySelectorAll('[data-k]').forEach((b) => { b.onclick = async () => { const l = [...keep]; l.splice(+b.dataset.k, 1); await setS({ keepSignedIn: l }); datenschutz(); }; });
  $('kAddBtn').onclick = async () => { const d = dom($('kAdd').value); if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return toast('Bitte eine Domain wie amazon.de eingeben'); await setS({ keepSignedIn: [...new Set([...keep, d])] }); datenschutz(); };
  $('pHist').onchange = async () => { await setS({ historyDays: Number($('pHist').value) }); };
}

function sicherheit() {
  const s = st.settings, l = st.lists || { counts: {} };
  const n = (x) => Number(x || 0).toLocaleString('de-DE');
  body(`<div class="kpi"><div><b>${n(l.counts.werbung)}</b><span>Werbe-/Tracker-Adressen</span></div><div><b>${n(l.counts.malware)}</b><span>Malware-Adressen</span></div><div><b>${n(l.counts.phishing)}</b><span>Phishing-Adressen</span></div></div>
    <div class="group"><h3>Blocker</h3>
      ${sw('xAds', s.blockAds !== false, 'Werbung & Tracker blockieren', 'HaGeZi Multi PRO')}
      ${sw('xMal', s.blockMalware !== false, 'Malware-Seiten blockieren', 'URLhaus, täglich frisch')}
      ${sw('xPhi', s.blockPhishing !== false, 'Phishing-Seiten blockieren', 'Phishing-Filter, täglich frisch')}
      ${sw('xFresh', s.freshLists !== false, 'Listen täglich aktualisieren')}
      <button class="secondary" id="xRefresh">Listen jetzt aktualisieren</button></div>
    <div class="group"><h3>Ausnahmen</h3><p class="small">Auf diesen Seiten wird nichts blockiert:</p>
      ${(s.allowlist || []).length ? foldList('allow', 'Ausnahmen anzeigen', s.allowlist.map((d, i) => `<div class="list-item"><div class="grow"><b>${esc(d)}</b></div><button class="icon" data-a="${i}" aria-label="Entfernen">✕</button></div>`).join(''), s.allowlist.length) : '<p class="hint">keine</p>'}
      <div class="addrow"><input type="text" id="aAdd" placeholder="z. B. meinebank.de"><button class="pill" id="aAddBtn">Hinzufügen</button></div>
      <p class="small">Eigene Sperrliste:</p>
      ${(s.blocklist || []).length ? foldList('block', 'Sperrliste anzeigen', s.blocklist.map((d, i) => `<div class="list-item"><div class="grow"><b>${esc(d)}</b></div><button class="icon" data-b="${i}" aria-label="Entfernen">✕</button></div>`).join(''), s.blocklist.length) : '<p class="hint">leer</p>'}
      <div class="addrow"><input type="text" id="bAdd" placeholder="Domain sperren"><button class="pill" id="bAddBtn">Sperren</button></div></div>
    <div class="group"><h3>Verbindung</h3>
      ${sw('xHttps', s.httpsOnly !== false, 'Nur HTTPS', 'unverschlüsselte Seiten werden umgestellt')}
      <div class="row"><span>Verschlüsseltes DNS<span class="desc">wenn NordVPN aus ist</span></span><select id="xDns">${[['quad9', 'Quad9 (Schweiz)'], ['mullvad', 'Mullvad (Schweden)'], ['cloudflare', 'Cloudflare'], ['google', 'Google'], ['system', 'System-DNS (unverschlüsselt)']].map(([v, t]) => `<option value="${v}" ${s.dnsProvider === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <div class="group"><h3>Passkeys</h3><p class="small">Passkeys (Google, Microsoft, Amazon …) laufen direkt über ${lockName} bzw. dein Handy oder einen Sicherheitsschlüssel – wie in jedem großen Browser.</p></div>`);
  bindSwitch('xAds', 'blockAds'); bindSwitch('xMal', 'blockMalware'); bindSwitch('xPhi', 'blockPhishing'); bindSwitch('xFresh', 'freshLists'); bindSwitch('xHttps', 'httpsOnly');
  $('xDns').onchange = () => setS({ dnsProvider: $('xDns').value });
  $('xRefresh').onclick = async () => { $('xRefresh').textContent = 'Aktualisiert …'; st.lists = await send({ type: 'lists:refresh' }); sicherheit(); toast('Listen aktualisiert'); };
  $('aAddBtn').onclick = async () => { const d = dom($('aAdd').value); if (d.includes('.')) { await setS({ allowlist: [...new Set([...(s.allowlist || []), d])] }); sicherheit(); } };
  $('bAddBtn').onclick = async () => { const d = dom($('bAdd').value); if (d.includes('.')) { await setS({ blocklist: [...new Set([...(s.blocklist || []), d])] }); sicherheit(); } };
  $('body').querySelectorAll('[data-a]').forEach((b) => { b.onclick = async () => { const l2 = [...s.allowlist]; l2.splice(+b.dataset.a, 1); await setS({ allowlist: l2 }); sicherheit(); }; });
  $('body').querySelectorAll('[data-b]').forEach((b) => { b.onclick = async () => { const l2 = [...s.blocklist]; l2.splice(+b.dataset.b, 1); await setS({ blocklist: l2 }); sicherheit(); }; });
}

// Adressen (Feray 02.11.2026): keine „Adresse speichern?“-Abfrage mehr – eigene Adressen trägt man hier selbst ein.
// Nur diese werden beim Ausfüllen von Formularen angeboten; fremde Lieferadressen (Kunden) werden nie gespeichert.
function adressen() {
  body(`<div class="group"><h3>Meine Adressen</h3><p class="small">Der Browser fragt beim Bestellen nicht mehr, ob er eine Adresse speichern soll – so landen keine Kundenadressen im Browser. Deine eigenen Adressen (Privat, Firma, Lager …) trägst du hier selbst ein. Sie werden beim Ausfüllen von Formularen angeboten.</p>
    <button class="primary" id="adrOpen">Adressen ansehen, hinzufügen, bearbeiten</button>
    <p class="small">Gespeichert nur auf diesem Computer. Beim Ausfüllen auf ein Adressfeld klicken und die Adresse aus der Liste wählen.</p></div>`);
  $('adrOpen').onclick = () => browser.tabs.create({ url: browser.runtime.getURL('pages/cmd.html?c=addresses'), active: false });
}

// Sync (Feray 02.11.2026: „Mac und Windows nahtlos, mit den Passwörtern“): ImmoAdv-Konto + eigenes Sync-Passwort.
// Alles wird auf dem Gerät mit dem Sync-Passwort verschlüsselt; ImmoAdv speichert nur Chiffretext.
async function sync() {
  let z = await send({ type: 'sync:state' }).catch(() => null) || { status: 'error', message: 'Programm nicht erreichbar' };
  const msg = z.message ? `<p class="small" style="color:#ffb3bb">${esc(z.message)}</p>` : '';
  const when = (t) => (t ? new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
  if (z.status === 'off' || z.status === 'needLogin' || z.status === 'error') {
    body(`<div class="group"><h3>Geräte abgleichen</h3><p class="small">Passwörter, Lesezeichen, Einstellungen und offene Tabs zwischen deinem Windows-PC und Mac – Ende-zu-Ende-verschlüsselt. Anmelden mit deinem ImmoAdv-Konto.</p>
      <input type="email" id="syE" placeholder="E-Mail" autocomplete="username" value="${esc(z.email || '')}" style="width:100%;margin-top:8px">
      <input type="password" id="syP" placeholder="Passwort" autocomplete="current-password" style="width:100%;margin-top:8px">
      <button class="primary" id="syGo">Anmelden</button>${msg}</div>`);
    const go = async () => { $('syGo').disabled = true; await send({ type: 'sync:login', email: $('syE').value, password: $('syP').value }); sync(); };
    $('syGo').onclick = go; $('syP').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    return;
  }
  if (z.status === 'needMfa') {
    body(`<div class="group"><h3>Bestätigungscode</h3><p class="small">6-stelliger Code aus deiner Authenticator-App.</p>
      <input type="text" id="syC" inputmode="numeric" autocomplete="one-time-code" maxlength="8" style="width:100%;margin-top:8px"><button class="primary" id="syGo">Bestätigen</button>${msg}</div>`);
    const go = async () => { $('syGo').disabled = true; await send({ type: 'sync:mfa', code: $('syC').value }); sync(); };
    $('syGo').onclick = go; $('syC').onkeydown = (e) => { if (e.key === 'Enter') go(); }; $('syC').focus();
    return;
  }
  if (z.status === 'needPassphrase') {
    body(`<div class="group"><h3>${z.hasKey ? 'Sync-Passwort eingeben' : 'Sync-Passwort festlegen'}</h3>
      <p class="small">${z.hasKey ? 'Dasselbe Sync-Passwort wie auf deinem anderen Gerät.' : 'Neues Sync-Passwort (mindestens 8 Zeichen). Damit werden deine Daten verschlüsselt – auf allen Geräten gleich. <b>Gut merken:</b> Ohne dieses Passwort kann niemand, auch ImmoAdv nicht, die Daten wiederherstellen.'}</p>
      <input type="password" id="syK" autocomplete="new-password" placeholder="Sync-Passwort" style="width:100%;margin-top:8px">
      ${z.hasKey ? '' : '<input type="password" id="syK2" autocomplete="new-password" placeholder="Sync-Passwort wiederholen" style="width:100%;margin-top:8px">'}
      <button class="primary" id="syGo">${z.hasKey ? 'Entsperren und abgleichen' : 'Festlegen und abgleichen'}</button>${msg}</div>`);
    const go = async () => {
      if (!z.hasKey && $('syK').value !== $('syK2').value) return toast('Die beiden Eingaben sind verschieden');
      $('syGo').disabled = true; $('syGo').textContent = 'Wird verschlüsselt …';
      await send({ type: 'sync:pass', pass: $('syK').value }); sync();
    };
    $('syGo').onclick = go;
    return;
  }
  const c = z.counts || {}, tabs = z.remoteTabs || [];
  body(`<div class="group"><h3>Sync ist an</h3>
      <div class="row"><span>Konto<span class="desc">${esc(z.email || '')}</span></span><span class="hint">${z.status === 'on' ? '● verbunden' : esc(z.status)}</span></div>
      <div class="row"><span>Zuletzt abgeglichen</span><span class="hint">${when(z.lastSync)}</span></div>
      <div class="row"><span>Passwörter · Lesezeichen</span><span class="hint">${c.passwords ?? '–'} · ${c.bookmarks ?? '–'}</span></div>
      <p class="small">Abgeglichen werden Passwörter, Lesezeichen, Einstellungen (Ausnahmen, Sperrliste, Suchmaschine …) und offene Tabs – automatisch jede Minute und nach jeder Änderung.</p>
      <button class="secondary" id="syNow">Jetzt abgleichen</button>${msg}</div>
    <div class="group"><h3>Tabs auf deinen anderen Geräten</h3>${tabs.length ? tabs.map((d) => `<details class="fold"><summary>${esc(d.name || 'Gerät')} <span class="hint">${d.tabs.length} Tabs · ${when(d.at)}</span></summary>${d.tabs.map((t) => `<div class="list-item"><div class="grow"><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title || t.url)}</a></div></div>`).join('')}</details>`).join('') : '<p class="hint">Noch keine anderen Geräte.</p>'}</div>
    <div class="group"><button class="danger" id="syOut">Auf diesem Gerät abmelden</button><p class="small">Daten auf diesem Gerät bleiben erhalten.</p></div>`);
  $('syNow').onclick = async () => { $('syNow').disabled = true; $('syNow').textContent = 'Gleicht ab …'; await send({ type: 'sync:now' }); sync(); };
  $('syOut').onclick = async () => { if (confirm('Sync auf diesem Gerät beenden?')) { await send({ type: 'sync:logout' }); sync(); } };
}
browser.runtime.onMessage.addListener((m) => { if (m && m.type === 'sync' && tab === 'sync' && !document.activeElement?.matches('input')) sync(); });

async function passwoerter() {
  body('<p class="hint">Lädt …</p>');
  let list = [];
  try { list = await send({ type: 'pw:list' }); } catch (e) { body(`<p class="hint">${esc(e.message)}</p>`); return; }
  const q = (passwoerter.q || '').toLowerCase();
  const shown = list.filter((p) => !q || (p.site + ' ' + p.user).toLowerCase().includes(q)).sort((a, b) => a.site.localeCompare(b.site));
  body(`<div class="group"><h3>Passwort-Tresor · ${list.length} Einträge</h3><p class="small">Jedes Passwort einzeln verschlüsselt (${isMac ? 'Mac-Schlüsselbund' : 'Windows DPAPI'}). Anzeigen, Kopieren und Ausfüllen nur nach ${lockName}.</p>
      <input type="search" id="pwQ" placeholder="Suchen …" value="${esc(passwoerter.q || '')}" style="width:100%">
      ${shown.map((p) => `<div class="list-item"><div class="grow"><b>${esc(p.site)}</b><span class="desc">${esc(p.user || '(ohne Benutzername)')}</span></div>
        <button class="pill" data-copy="${esc(p.id)}">Kopieren</button><button class="pill ghost" data-show="${esc(p.id)}">Anzeigen</button><button class="icon" data-del="${esc(p.id)}" aria-label="Löschen">✕</button></div>`).join('') || '<p class="hint">Keine Einträge</p>'}</div>
    <div class="group"><h3>Passkeys</h3><p class="small">Passkeys werden nie kopiert – sie bleiben sicher dort, wo sie erstellt wurden. Im ImmoAdv Browser kannst du sie so nutzen:</p>
      <p class="small">${isMac
        ? '• <b>Mit Touch ID auf diesem Mac:</b> Deine Passkeys aus dem iCloud-Schlüsselbund stehen direkt zur Verfügung – dieselben wie auf iPhone und iPad, ohne QR-Code. Neue Passkeys landen im iCloud-Schlüsselbund und sind sofort auch auf iPhone und iPad da.<br>• <b>Voraussetzung:</b> Systemeinstellungen → [dein Name] → iCloud → „Passwörter & Schlüsselbund“ ist an. Ohne iCloud werden neue Passkeys nur auf diesem Mac gespeichert.<br>• <b>Mit dem iPhone oder Android-Gerät:</b> Bei der Anmeldung „iPhone, iPad oder Android-Gerät“ wählen und den QR-Code scannen – für Passkeys, die nur dort liegen (z. B. im Google-Passwortmanager). Bluetooth am Mac muss an sein.<br>• <b>Mit einem Sicherheitsschlüssel</b> (z. B. YubiKey): einstecken oder an den Mac halten, wenn die Seite danach fragt.'
        : '• <b>Mit Windows Hello</b> auf diesem PC (neue Passkeys werden hier gespeichert).<br>• <b>Mit dem iPhone:</b> Bei der Anmeldung „iPhone, iPad oder Android-Gerät“ wählen und den QR-Code scannen – so nutzt du deine iCloud-Passkeys auch am PC.<br>• <b>Mit einem Sicherheitsschlüssel</b> (z. B. YubiKey): einstecken, wenn die Seite danach fragt.'}</p></div>
    <div class="group"><h3>Importieren</h3><p class="small">CSV aus Google (passwords.google.com → Einstellungen → Exportieren), Apple „Passwörter“, Chrome, Edge oder Firefox.</p><button class="secondary" id="pwImport">CSV-Datei auswählen …</button></div>`);
  $('pwQ').oninput = () => { passwoerter.q = $('pwQ').value; const pos = $('pwQ').selectionStart; passwoerter().then(() => { $('pwQ').focus(); $('pwQ').setSelectionRange(pos, pos); }); };
  $('body').querySelectorAll('[data-copy]').forEach((b) => { b.onclick = async () => { const r = await send({ type: 'pw:copy', id: b.dataset.copy }); toast(r ? 'Kopiert – wird nach 30 Sekunden aus der Zwischenablage entfernt' : 'Freigabe abgebrochen'); }; });
  $('body').querySelectorAll('[data-show]').forEach((b) => { b.onclick = async () => { const r = await send({ type: 'pw:reveal', id: b.dataset.show }); if (r) { b.textContent = r.pass; setTimeout(() => { b.textContent = 'Anzeigen'; }, 15000); } else toast('Freigabe abgebrochen'); }; });
  $('body').querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { if (confirm('Diesen Eintrag löschen?')) { await send({ type: 'pw:delete', id: b.dataset.del }); passwoerter(); } }; });
  $('pwImport').onclick = async () => { const r = await send({ type: 'pw:import' }); if (r) toast(r.error || `${r.added} übernommen${r.skipped ? `, ${r.skipped} übersprungen` : ''}`); passwoerter(); };
}

function vpn() {
  const v = st.vpn || {};
  if (!v.loggedIn) {
    body(`<div class="group"><h3>NordVPN anmelden</h3>
      <p class="small">Einmal anmelden – danach läuft jeder Tab automatisch über NordVPN: schnellster Server, stiller Serverwechsel, WLAN ↔ Mobilfunk ohne Zutun. Ohne Verbindung wird nichts ungeschützt geladen. Die NordVPN-App brauchst du nicht.</p>
      <p><input type="text" id="vUser" placeholder="Dienst-Benutzername" autocomplete="off" style="width:100%"></p>
      <p><input type="password" id="vPass" placeholder="Dienst-Passwort" autocomplete="off" style="width:100%"></p>
      <button class="primary" id="vLogin">Anmelden</button>
      <p class="hint">Wichtig: Nicht E-Mail/Passwort, sondern die <b>Dienst-Zugangsdaten</b>: nordaccount.com → NordVPN → „Manuelle Einrichtung“ → Dienst-Zugangsdaten. Gespeichert verschlüsselt (${isMac ? 'Mac-Schlüsselbund' : 'Windows DPAPI'}).</p></div>`);
    $('vLogin').onclick = async () => {
      const u = $('vUser').value.trim(), p = $('vPass').value;
      if (!u || !p) return toast('Bitte beide Felder ausfüllen');
      $('vLogin').disabled = true; $('vLogin').textContent = 'Verbindet …';
      try { st.vpn = await send({ type: 'vpn:login', user: u, pass: p }); toast('NordVPN eingerichtet'); } catch (e) { toast('Anmeldung nicht möglich: ' + e.message); }
      vpn();
    };
    return;
  }
  const label = v.status === 'on' ? 'Aktiv · geprüft' : v.status === 'authfail' ? 'Zugangsdaten abgelehnt' : v.status === 'error' ? 'Gestört' : (v.message || 'verbindet …');
  body(`<div class="group"><h3>Status</h3>
      <div class="row"><span>Verbindung</span><span class="badge ${v.status === 'on' ? 'ok' : v.status === 'authfail' || v.status === 'error' ? 'bad' : 'warn'}">${esc(label)}</span></div>
      ${v.status !== 'on' && v.message ? `<p class="small">${esc(v.message)}</p>` : ''}
      <div class="row"><span>Server</span><b>${esc(v.server || '–')}</b></div>
      <div class="row"><span>Land</span><select id="vCountry">${st.countries.map((c) => `<option value="${c.code}" ${(st.settings.vpnCountry || 'auto') === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
    <p class="small">Läuft über NordVPNs verschlüsselten Proxy (TLS) für alle Tabs inkl. DNS. Andere Programme auf dem Computer sind davon nicht betroffen.</p>
    <button class="secondary" id="vRe">Verbindung neu prüfen</button>
    <button class="secondary" id="vEdit">Andere Zugangsdaten eingeben</button>
    <button class="danger" id="vOut">Abmelden</button>`);
  $('vRe').onclick = async () => { $('vRe').textContent = 'Prüft …'; st.vpn = await send({ type: 'vpn:recheck' }); vpn(); };
  $('vEdit').onclick = async () => { st.vpn = await send({ type: 'vpn:logout' }); vpn(); };
  $('vCountry').onchange = async () => { st.vpn = await send({ type: 'vpn:country', code: $('vCountry').value }); toast('Land gewechselt'); vpn(); };
  $('vOut').onclick = async () => { if (confirm('NordVPN abmelden? Danach läuft alles ohne VPN.')) { st.vpn = await send({ type: 'vpn:logout' }); vpn(); } };
}

const AI_PROVIDERS = [
  { id: 'anthropic', name: 'Claude (Anthropic)', model: 'claude-sonnet-5-5', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', name: 'ChatGPT (OpenAI)', model: 'gpt-5-mini', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'ollama', name: 'Ollama (lokal, offline)', model: 'llama3.2', needsKey: false, keyUrl: '' }
];
async function ki() {
  const info = await send({ type: 'ai:config' }).catch(() => ({}));
  const s = st.settings, models = s.aiModels || {};
  const prov = info.provider || s.aiProvider || 'anthropic';
  const p = AI_PROVIDERS.find((x) => x.id === prov) || AI_PROVIDERS[0];
  body(`<div class="group"><h3>Anbieter</h3>
      <div class="row"><span>KI-Anbieter</span><select id="aProv">${AI_PROVIDERS.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="row"><span>Modell</span><input type="text" id="aModel" value="${esc(models[p.id] || p.model)}" style="width:200px"></div>
      ${p.needsKey ? `<div class="row"><span>Schlüssel<span class="desc">${info.hasKey ? 'gespeichert ✓' : 'noch keiner'}</span></span></div>
        <p><input type="password" id="aKey" placeholder="${info.hasKey ? '•••••••• (neu eingeben zum Ändern)' : 'API-Schlüssel einfügen'}" autocomplete="off" style="width:100%"></p>
        <p class="hint">Schlüssel erstellen: <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">${esc(p.keyUrl.replace('https://', ''))}</a>. Gespeichert verschlüsselt, nie im Klartext.</p>`
      : '<p class="small">Ollama läuft komplett auf deinem Computer – keine Daten gehen ins Internet.</p>'}
      <button class="primary" id="aSave">Speichern</button></div>
    <div class="group"><h3>Eigene Vorgaben</h3><textarea id="aInstr" rows="4" style="width:100%" placeholder="z. B. Ich bin Immobilien-Investorin, rechne in Euro, antworte kurz.">${esc(s.aiInstructions || '')}</textarea>
      <p class="hint">Gilt für jede Antwort. Seiteninhalte können diese Vorgaben nicht ändern.</p></div>
    <div class="group"><h3>Datenschutz</h3>${sw('aHist', s.aiKeepHistory !== false, 'KI-Gespräche speichern', 'nur lokal')}<p class="small">Seiteninhalte gehen nur an den Anbieter, wenn „Seite einbeziehen“ an ist. Passwörter, Formulareingaben und Verlauf nie.</p></div>`);
  bindSwitch('aHist', 'aiKeepHistory');
  $('aProv').onchange = async () => { await setS({ aiProvider: $('aProv').value }); ki(); };
  $('aSave').onclick = async () => {
    await setS({ aiModels: { ...models, [p.id]: $('aModel').value.trim() || p.model }, aiInstructions: $('aInstr').value.slice(0, 2000) });
    if ($('aKey') && $('aKey').value.trim()) await send({ type: 'ai:setKey', provider: p.id, key: $('aKey').value.trim() });
    toast('KI gespeichert'); ki();
  };
}

function merkliste() {
  const w = (st.settings.watchlist || []).filter((x) => /^https?:/.test(x.url || ''));
  const eur = (n) => Number(n || 0).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €';
  body(`<div class="group"><h3>Merkliste · ${w.length} Objekte</h3>
    ${w.map((x) => `<div class="list-item"><div class="grow"><a href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.title)}</b></a><span class="desc">${esc([x.city, x.source].filter(Boolean).join(' · '))}</span></div>
      <span class="hint">${eur(x.price)}${x.brutto ? ` · ${x.brutto.toFixed(1).replace('.', ',')} % brutto` : ''}${x.cashflow != null ? ` · ${eur(x.cashflow)}/Monat` : ''}</span><button class="icon" data-w="${x.id}" aria-label="Entfernen">✕</button></div>`).join('') || '<p class="hint">Noch leer – im Immobilien-Check auf „Auf die Merkliste“ tippen.</p>'}</div>`);
  $('body').querySelectorAll('[data-w]').forEach((b) => { b.onclick = async () => { await send({ type: 'watch:remove', id: Number(b.dataset.w) }); st = await send({ type: 'state' }); merkliste(); }; });
}

function updates() {
  const u = st.update || {};
  const line = { checking: 'Sucht nach Updates …', current: 'Aktuell', available: `Version ${u.version} verfügbar`, downloading: `Lädt Version ${u.version} … ${u.progress || 0} %`, ready: `Version ${u.version} bereit`, restarting: 'Wird installiert …', error: u.message || 'Fehler', unsupported: 'Updates nur in der installierten Version' }[u.status] || 'Bereit';
  body(`<div class="group"><h3>ImmoAdv Browser ${esc(st.version)}</h3>
      <div class="row"><span>Status</span><b>${esc(line)}</b></div>
      ${['available', 'ready', 'downloading'].includes(u.status) ? '<button class="primary" id="uNow">Update jetzt installieren</button>' : '<button class="secondary" id="uCheck">Nach Updates suchen</button>'}
      ${sw('uAuto', st.settings.autoUpdate !== false, 'Updates automatisch laden', 'werden beim nächsten Beenden still installiert')}</div>
    <p class="small">„Update jetzt installieren“ lädt die neue Version, installiert sie ohne weitere Fragen und startet den Browser neu. Tabs, Lesezeichen, Passwörter und Einstellungen bleiben erhalten. Den Firefox-Motor hält Mozilla automatisch aktuell.</p>`);
  if ($('uNow')) $('uNow').onclick = async () => { $('uNow').disabled = true; $('uNow').textContent = 'Wird installiert …'; await send({ type: 'update:now' }); };
  if ($('uCheck')) $('uCheck').onclick = async () => { st.update = await send({ type: 'update:check' }); updates(); };
  bindSwitch('uAuto', 'autoUpdate');
}

$('restartNow').onclick = () => send({ type: 'engine:set', patch: { restart: true } });
browser.runtime.onMessage.addListener((m) => { if (m && (m.type === 'vpn' || m.type === 'update')) { if (m.type === 'vpn') st.vpn = m.data; else st.update = m.data; if (tab === 'vpn') vpn(); if (tab === 'updates') updates(); } });
render();
