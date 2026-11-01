/* Oberfläche des ImmoAdv Browsers 3 (ImmoAdv Fade). Kein Zugriff aufs System – nur über window.immo. */
'use strict';
const $ = (id) => document.getElementById(id);
const api = window.immo;
const C = window.ImmoCalc;

let state = { tabs: [], activeId: null, activeWs: 'privat', workspaces: [], split: null };
let settings = {};
let vpnState = { status: 'nocreds' };
let blockerInfo = { counts: {}, sources: {}, fresh: {} };
let upd = { status: 'idle' };
let appVersion = '', platform = '';
let panel = null;
let overlayOpen = false;     // Dialog über der Webseite → Webseite ausblenden
let suggestOpen = false;
let watchlist = [];
let downloads = [];
let passwords = [];
let online = true;
let aiInfo = { hasKey: false }, aiProviders = [], dnsList = [], countries = [];
let updDismissed = null;
let favicons = {};          // Seite → Symbol (data:), vom Hauptprozess geladen und gemerkt

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (v, d = 0) => (v ?? 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %';
const num = (v) => Number(v || 0).toLocaleString('de-DE');
const activeTab = () => state.tabs.find((t) => t.id === state.activeId);
const wsTabs = () => state.tabs.filter((t) => t.ws === state.activeWs);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const mod = () => (platform === 'darwin' ? '⌘' : 'Strg');
const vertical = () => settings.tabLayout === 'vertical';

// ---------- Layout an den Hauptprozess melden (wo die Webseite liegt) ----------
function pushLayout() {
  const top = $('chrome').offsetHeight;
  $('content').style.top = top + 'px';
  $('panel').style.top = (top + 6) + 'px';
  $('loadbar').style.top = (top - 2) + 'px';
  const left = vertical() ? (settings.sidebarCollapsed ? 64 : 248) : 0;
  const t = activeTab();
  api.layout({ top, left, right: panel ? 388 : 0, hidden: overlayOpen || suggestOpen });
  document.body.classList.toggle('panel-open', !!panel);
  document.body.classList.toggle('loading', !!(t && t.loading));
  document.body.classList.toggle('vertical', vertical());
  document.body.classList.toggle('collapsed', vertical() && !!settings.sidebarCollapsed);
}
new ResizeObserver(pushLayout).observe($('chrome'));

// ---------- Hinweis (im Kopfbereich, damit ihn keine Webseite verdeckt) ----------
let toastTimer = null;
function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 3200);
}

// ---------- Symbole ----------
function favHTML(t) {
  if (t.loading && !t.suspended) return '<span class="tab-fav spin"></span>';
  if (t.kind === 'pdf') return '<span class="tab-fav" style="background:#d4483b">P</span>';
  const h = hostOf(t.url);
  const icon = t.favicon || favicons[h] || favicons[h.split('.').slice(-2).join('.')];
  if (icon) return `<span class="tab-fav"><img src="${esc(icon)}" alt=""></span>`;
  if (!h) return '<span class="tab-fav"><img src="emblem.png" alt=""></span>';
  return `<span class="tab-fav" style="background:${h ? colorFor(h) : 'var(--surface-3)'}">${esc((h || '+')[0].toUpperCase())}</span>`;
}
function colorFor(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 55% 42%)`; }

// ---------- Arbeitsbereiche ----------
function renderWorkspaces() {
  const html = state.workspaces.map((w) => `<button class="ws-dot ${w.id === state.activeWs ? 'active' : ''}" style="--ws:${esc(w.color)}" data-ws="${esc(w.id)}" title="${esc(w.name)}">${esc(w.icon || w.name[0])}</button>`).join('')
    + '<button class="ws-dot" data-wsadd title="Arbeitsbereiche verwalten">⋯</button>';
  for (const el of [$('wsSwitch'), $('sideWs')]) {
    el.innerHTML = html;
    el.querySelectorAll('[data-ws]').forEach((b) => { b.onclick = () => api.selectWorkspace(b.dataset.ws); });
    el.querySelector('[data-wsadd]').onclick = () => openPanel('settings', 'bereiche');
  }
  // Bereichs-Knöpfe oben links ausgeblendet (Wunsch Feray) – Wechsel über ⋯ → Arbeitsbereich
  $('wsSwitch').classList.add('hidden'); $('sideWs').classList.add('hidden');
}

// ---------- Tabs ----------
let dragId = null;
function tabHTML(t) {
  return `<div class="tab ${t.id === state.activeId ? 'active' : ''} ${t.pinned ? 'pinned' : ''} ${t.suspended ? 'suspended' : ''}" role="tab" aria-selected="${t.id === state.activeId}"
    draggable="true" data-id="${t.id}" title="${esc(t.title)}${t.suspended ? ' (schläft – Klick weckt)' : ''}">
    ${favHTML(t)}<span class="tab-title">${esc(t.kind === 'pdf' ? t.fileName || t.title : t.title || 'Neuer Tab')}</span>
    ${t.audible ? '<span class="tab-audio" title="Spielt Ton ab">♪</span>' : ''}
    <button class="tab-x" data-close="${t.id}" title="Tab schließen (${mod()}+W)" aria-label="Tab schließen">✕</button></div>`;
}
function renderTabs() {
  const list = wsTabs();
  if (vertical()) {
    const pinned = list.filter((t) => t.pinned), rest = list.filter((t) => !t.pinned);
    $('sideTabs').innerHTML = (pinned.length ? `<div class="pinned-row">${pinned.map(tabHTML).join('')}</div>` : '') + rest.map(tabHTML).join('');
    $('tabs').innerHTML = '';
  } else {
    $('tabs').innerHTML = list.map(tabHTML).join('');
    $('sideTabs').innerHTML = '';
  }
  document.querySelectorAll('.tab').forEach((el) => {
    const id = el.dataset.id;
    el.onclick = (e) => { if (!e.target.closest('[data-close]')) api.selectTab(id); };
    el.onauxclick = (e) => { if (e.button === 1) api.closeTab(id); };
    el.oncontextmenu = (e) => { e.preventDefault(); api.tabMenu(id); };
    el.ondragstart = (e) => { dragId = id; e.dataTransfer.effectAllowed = 'move'; };
    el.ondragover = (e) => { if (dragId && dragId !== id) { e.preventDefault(); el.classList.add('drop'); } };
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = (e) => { e.preventDefault(); el.classList.remove('drop'); if (dragId && dragId !== id) api.moveTab(dragId, id); dragId = null; };
  });
  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); api.closeTab(b.dataset.close); }; });
}

// ---------- Werkzeugleiste ----------
const isBookmarked = (url) => (settings.bookmarks || []).some((b) => b.url === url);
function renderToolbar() {
  const t = activeTab();
  $('back').disabled = !t || !t.canGoBack;
  $('forward').disabled = !t || !t.canGoForward;
  if (document.activeElement !== $('address')) $('address').value = t ? (t.kind === 'pdf' ? (t.fileName || t.title) : t.url) : '';
  const https = t && /^https:/.test(t.url);
  $('lock').textContent = t && t.url ? (https ? '🔒' : t.kind === 'pdf' ? '📄' : '⚠') : '';
  $('lock').className = 'lock' + (https ? ' ok' : '');
  $('lock').title = https ? 'Verschlüsselte Verbindung (HTTPS), Zertifikat geprüft' : '';
  $('immoBtn').classList.toggle('hidden', !(t && t.listing));
  $('pdfSave').classList.toggle('hidden', !(t && t.kind === 'pdf'));
  $('keyBtn').classList.toggle('hidden', !(t && t.login && t.login.length));
  $('bookmarkBtn').classList.toggle('on', !!(t && t.url && isBookmarked(t.url)));
  $('reload').innerHTML = t && t.loading
    ? '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>';
  $('reload').title = t && t.loading ? 'Laden stoppen' : `Neu laden (${mod()}+R)`;
  // Passwort speichern?
  const offer = t && t.pwOffer;
  $('pwBar').classList.toggle('hidden', !offer);
  if (offer) $('pwText').textContent = `${offer.update ? 'Neues Passwort' : 'Passwort'} für ${offer.site}${offer.user ? ` (${offer.user})` : ''} sicher speichern?`;
  renderShield();
}

function renderShield() {
  const s = $('shield');
  let cls = 'on', text = 'Geschützt', title = 'Blocker, Malware-/Phishing-Schutz und verschlüsseltes DNS aktiv';
  if (!online) { cls = 'off'; text = 'Offline'; title = 'Derzeit keine Internetverbindung'; }
  else if (vpnState.status === 'on') { text = 'VPN'; title = `NordVPN aktiv · ${vpnState.server || ''}`; }
  else if (vpnState.status === 'connecting') { cls = 'warn'; text = 'VPN …'; title = 'NordVPN verbindet'; }
  else if (vpnState.status === 'waiting') { cls = 'warn'; text = 'VPN wartet'; title = 'Wartet auf Internet – ohne VPN wird nichts geladen'; }
  else if (vpnState.status === 'authfail' || vpnState.status === 'error') { cls = 'off'; text = 'VPN-Fehler'; title = vpnState.message || 'NordVPN-Verbindung gestört'; }
  s.className = 'shield ' + cls; $('shieldText').textContent = text; s.title = title;
}

// ---------- Inhalt: Startseite / Hinweise ----------
function renderContent() {
  const t = activeTab();
  const showStart = !t || (!t.url && t.kind === 'web');
  $('start').classList.toggle('hidden', !showStart);
  const box = $('errorBox');
  if (t && t.blocked) {
    const what = { phishing: 'eine bekannte Betrugs-/Phishing-Seite', malware: 'eine Seite, die Schadsoftware verbreitet', eigene: 'auf deiner eigenen Sperrliste', werbung: 'ein Werbe-/Tracking-Dienst' }[t.blocked.kind] || 'gefährlich';
    box.className = 'notice blocked';
    box.innerHTML = `<div class="card fade"><div class="big">⛔</div><h1>Seite blockiert</h1>
      <p><b>${esc(hostOf(t.blocked.url))}</b> ist ${esc(what)}. Der ImmoAdv Browser hat sie zu deinem Schutz nicht geöffnet.</p>
      <div class="row-btns"><button class="primary" id="blkBack">Zurück in Sicherheit</button><button class="secondary" id="blkGo">Trotzdem öffnen</button></div>
      <p class="hint">„Trotzdem öffnen“ gilt nur bis zum Beenden des Browsers.</p></div>`;
    $('blkBack').onclick = () => (t.canGoBack ? api.nav('back') : api.closeTab(t.id));
    $('blkGo').onclick = () => api.allowBlocked(t.id);
  } else if (t && t.error && (vpnState.status === 'authfail' || vpnState.status === 'error')) {
    box.className = 'notice';
    box.innerHTML = `<div class="card fade"><div class="big">🔐</div><h1>${vpnState.status === 'authfail' ? 'NordVPN-Zugangsdaten abgelehnt' : 'NordVPN-Server antwortet nicht'}</h1>
      <p>${esc(vpnState.message || '')}</p><p class="hint">Zu deinem Schutz wird ohne funktionierendes VPN nichts geladen.</p>
      <div class="row-btns"><button class="primary" id="vpnFix">NordVPN-Einstellungen</button><button class="secondary" id="vpnRetry">Erneut verbinden</button></div></div>`;
    $('vpnFix').onclick = () => openPanel('settings', 'vpn');
    $('vpnRetry').onclick = async () => { $('vpnRetry').textContent = 'Prüft …'; vpnState = await api.vpnRecheck(); renderShield(); renderContent(); };
  } else if (t && t.error) {
    const off = /Internetverbindung/.test(t.error);
    box.className = 'notice';
    box.innerHTML = `<div class="card fade"><div class="big">${off ? '📡' : '⚠'}</div><h1>${off ? 'Derzeit keine Internetverbindung' : 'Seite nicht erreichbar'}</h1>
      <p>${esc(off ? 'Sobald wieder Internet da ist, lädt die Seite von selbst – auch nach einem WLAN-Wechsel.' : t.error)}</p>
      <div class="row-btns"><button class="secondary" id="errReload">Neu laden</button></div></div>`;
    $('errReload').onclick = () => api.nav('reload');
  } else box.className = 'notice hidden';
}

function renderStart() {
  const h = new Date().getHours();
  $('greeting').textContent = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
  $('today').textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const favs = (settings.bookmarks || []).filter((b) => !b.folder).slice(0, 12);
  $('favorites').innerHTML = favs.map((b, i) => `<button class="fav" data-i="${i}" title="${esc(b.url)}">${favHTML({ url: b.url, favicon: b.icon })}<span>${esc(b.title)}</span></button>`).join('')
    || '<p class="hint">Mit ☆ in der Adressleiste fügst du Favoriten hinzu.</p>';
  $('favorites').querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => api.navigate(favs[b.dataset.i].url); });
  const st = settings.stats || {};
  const blocked = (st.werbung || 0) + (st.malware || 0) + (st.phishing || 0) + (st.eigene || 0);
  $('statusRow').innerHTML = [
    `<span class="status-chip"><i></i><b>${num(blocked)}</b> Tracker & Gefahren blockiert</span>`,
    vpnState.status === 'on' ? '<span class="status-chip"><i></i>NordVPN aktiv</span>' : vpnState.loggedIn ? '<span class="status-chip warn"><i></i>NordVPN verbindet</span>' : '<span class="status-chip"><i></i>Verschlüsseltes DNS</span>',
    '<span class="status-chip"><i></i>Spurlos surfen</span>'
  ].join('');
}

function renderBookmarkBar() {
  const show = settings.bookmarkBar !== false;
  $('bookmarkbar').classList.toggle('hidden', !show);
  if (!show) return;
  const list = (settings.bookmarks || []).filter((b) => !b.folder);
  $('bookmarkbar').innerHTML = list.slice(0, 30).map((b, i) => `<button class="bm" data-i="${i}" title="${esc(b.url)}">${favHTML({ url: b.url })}${esc(b.title)}</button>`).join('')
    || '<span class="hint small">Lesezeichenleiste – mit ☆ Seiten hinzufügen</span>';
  $('bookmarkbar').querySelectorAll('[data-i]').forEach((b) => {
    b.onclick = (e) => (e.ctrlKey || e.metaKey ? api.newTab(list[b.dataset.i].url) : api.navigate(list[b.dataset.i].url));
    b.onauxclick = (e) => { if (e.button === 1) api.newTab(list[b.dataset.i].url); };
  });
}

function renderAll() { renderWorkspaces(); renderTabs(); renderToolbar(); renderContent(); pushLayout(); }

// ---------- Adressleiste mit Vorschlägen ----------
let sgItems = [], sgSel = 0, sgTimer = null;
function looksLikeURL(s) { return /^https?:\/\//i.test(s) || (!/\s/.test(s) && /^[^\s/]+\.[a-z0-9-]{2,}(:\d+)?(\/.*)?$/i.test(s)); }
async function updateSuggest() {
  const q = $('address').value.trim();
  if (!q || document.activeElement !== $('address')) return closeSuggest();
  const found = await api.suggest(q);
  if ($('address').value.trim() !== q) return;
  sgItems = [{ kind: looksLikeURL(q) ? 'go' : 'search', title: looksLikeURL(q) ? `Öffnen: ${q}` : `Suchen: ${q}`, url: q }, ...found];
  if (!looksLikeURL(q) && aiInfo.hasKey) sgItems.splice(1, 0, { kind: 'ai', title: `KI fragen: ${q}`, url: q });
  sgSel = 0;
  const icon = { go: '→', search: '⌕', ai: '✦', tab: '⧉', bookmark: '★', history: '🕘' };
  $('suggest').innerHTML = sgItems.map((s, i) => `<div class="sg ${i === sgSel ? 'sel' : ''}" data-i="${i}"><span class="k">${icon[s.kind] || '•'}</span><b>${esc(s.title || s.url)}</b>${s.kind !== 'go' && s.kind !== 'search' && s.kind !== 'ai' ? `<small>${esc(hostOf(s.url))}${s.kind === 'tab' ? ' · offener Tab' : ''}</small>` : ''}</div>`).join('');
  $('suggest').querySelectorAll('.sg').forEach((el) => { el.onmousedown = (e) => { e.preventDefault(); runSuggest(+el.dataset.i); }; });
  $('suggest').classList.remove('hidden');
  if (!suggestOpen) { suggestOpen = true; pushLayout(); }
}
function closeSuggest() { $('suggest').classList.add('hidden'); if (suggestOpen) { suggestOpen = false; pushLayout(); } }
function runSuggest(i) {
  const s = sgItems[i]; closeSuggest();
  if (!s) return;
  $('address').blur();
  if (s.kind === 'tab') return api.selectTab(s.id);
  if (s.kind === 'ai') { openPanel('ai'); return aiAsk(s.url, { usePage: false }); }
  api.navigate(s.url);
}
function moveSuggest(d) {
  if ($('suggest').classList.contains('hidden')) return;
  sgSel = (sgSel + d + sgItems.length) % sgItems.length;
  $('suggest').querySelectorAll('.sg').forEach((el, i) => el.classList.toggle('sel', i === sgSel));
  const s = sgItems[sgSel];
  if (s && s.kind !== 'ai') $('address').value = s.kind === 'go' || s.kind === 'search' ? s.url : s.url;
}

// ---------- Suche auf der Seite ----------
function openFind() { $('findbar').classList.remove('hidden'); $('findInput').focus(); $('findInput').select(); }
function closeFind() { $('findbar').classList.add('hidden'); $('findCount').textContent = ''; api.findStop(); }

// ---------- Seitenpanel ----------
let panelSub = null;
function openPanel(kind, sub) {
  panel = kind; panelSub = sub || null;
  $('panel').classList.remove('hidden');
  requestAnimationFrame(() => $('panel').classList.add('open'));
  const map = { immo: renderImmo, summary: renderSummary, watch: renderWatch, ai: renderAI, bookmarks: renderBookmarks, history: renderHistory,
    downloads: renderDownloads, passwords: renderPasswords, privacy: renderPrivacy, settings: renderSettings, tabs: renderTabsPanel };
  (map[kind] || renderSettings)();
  pushLayout();
}
function closePanel() {
  panel = null; $('panel').classList.remove('open');
  setTimeout(() => { if (!panel) $('panel').classList.add('hidden'); }, 200);
  pushLayout();
}
const togglePanel = (k) => (panel === k ? closePanel() : openPanel(k));
function seg(items, current, onPick) {
  return `<div class="tabs-seg">${items.map(([k, label]) => `<button data-seg="${k}" class="${k === current ? 'on' : ''}">${label}</button>`).join('')}</div>`;
}
function wireSeg(onPick) { $('panelBody').querySelectorAll('[data-seg]').forEach((b) => { b.onclick = () => onPick(b.dataset.seg); }); }
function sw(id, checked, label, desc) {
  return `<div class="row"><span>${label}${desc ? `<span class="desc">${desc}</span>` : ''}</span><label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span></span></label></div>`;
}
async function setS(obj) { settings = await api.setSettings(obj); return settings; }

// ---------- KI-Assistent ----------
const ai = { convId: null, reqId: null, el: null, text: '', usePage: true, useSel: false, messages: [] };
function md(src) {
  // sicheres Mini-Markdown: erst alles maskieren, dann wenige Formate erlauben
  const lines = esc(src).split('\n');
  let html = '', list = null, inCode = false, table = [];
  const inline = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="#" data-url="$2">$1</a>');
  const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())));
    html += '<table>' + rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('') + '</table>';
    table = [];
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^```/.test(l)) { flushList(); flushTable(); html += inCode ? '</pre>' : '<pre>'; inCode = !inCode; continue; }
    if (inCode) { html += l + '\n'; continue; }
    if (/^\|.*\|$/.test(l.trim())) { flushList(); table.push(l.trim()); continue; } else flushTable();
    let m;
    if ((m = /^(#{1,3})\s+(.*)/.exec(l))) { flushList(); html += `<h3>${inline(m[2])}</h3>`; }
    else if ((m = /^\s*[-*•]\s+(.*)/.exec(l))) { if (list !== 'ul') { flushList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) { if (list !== 'ol') { flushList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) flushList();
    else { flushList(); html += `<p>${inline(l)}</p>`; }
  }
  flushList(); flushTable(); if (inCode) html += '</pre>';
  return html;
}
function wireLinks(root) { root.querySelectorAll('[data-url]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); if (/^https?:/.test(a.dataset.url)) api.newTab(a.dataset.url); }; }); }

function msgHTML(m) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.content)}</div>`;
  return `<div class="msg ai"><span class="ai-badge">KI-Antwort</span><div class="md">${md(m.content)}</div>
    <div class="meta">${m.source ? `Quelle: <a href="#" data-url="${esc(m.source.url)}">${esc(m.source.title || hostOf(m.source.url))}</a> ·` : ''} ${esc(m.model || '')}
    <button data-copy>Kopieren</button></div></div>`;
}
async function renderAI() {
  $('panelTitle').textContent = 'KI-Assistent';
  aiInfo = await api.aiConfig();
  if (panel !== 'ai') return;
  if (!aiInfo.hasKey) {
    $('panelBody').innerHTML = `<div class="group"><h3>Einrichten</h3>
      <p>Der Assistent fasst Seiten zusammen, erklärt, übersetzt und beantwortet Fragen zur geöffneten Seite. Dafür brauchst du einen eigenen Zugang:</p>
      <ul class="points"><li><b>Claude</b> oder <b>ChatGPT</b> – Schlüssel beim Anbieter erstellen (kostet je nach Nutzung ein paar Cent).</li><li><b>Ollama</b> – kostenlos und komplett lokal auf deinem Computer.</li></ul>
      <button class="primary" id="aiSetup">Jetzt einrichten</button></div>
      <p class="hint">Ohne Zugang gibt es keine KI-Antworten. Die einfache Kurzfassung (${mod()}+J) funktioniert immer – ganz ohne KI und ohne Internet.</p>`;
    $('aiSetup').onclick = () => openPanel('settings', 'ki');
    return;
  }
  const convs = await api.aiConversations();
  const conv = ai.convId ? await api.aiConversation(ai.convId) : null;
  ai.messages = conv ? conv.messages : [];
  const t = activeTab();
  $('panelBody').innerHTML = `
    <div class="row" style="padding-top:0"><select id="aiConvs"><option value="">Neues Gespräch</option>${convs.map((c) => `<option value="${esc(c.id)}" ${c.id === ai.convId ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>
      <button class="icon" id="aiNew" title="Neues Gespräch">＋</button>${ai.convId ? '<button class="icon" id="aiExport" title="Als Markdown exportieren">⇩</button><button class="icon" id="aiDel" title="Gespräch löschen">🗑</button>' : ''}</div>
    <div id="aiLog">${ai.messages.map(msgHTML).join('') || `<p class="hint">Frag etwas zur geöffneten Seite – oder ganz allgemein. ${esc(aiInfo.name)} · ${esc(aiInfo.model)}</p>
      <div class="chips">${[['Zusammenfassen', 'Fasse diese Seite in 5 Stichpunkten zusammen.'], ['Wichtigste Zahlen', 'Welche Zahlen, Preise und Fakten stehen auf dieser Seite? Als Tabelle.'], ['Einfach erklären', 'Erkläre den Inhalt dieser Seite einfach.'], ['Übersetzen', 'Übersetze den Hauptinhalt dieser Seite ins Deutsche.'], ['Risiken prüfen', 'Welche Risiken, Haken oder Kosten nennt diese Seite? Nur was dort steht.']].map(([l, q]) => `<button class="chip" data-q="${esc(q)}">${l}</button>`).join('')}</div>`}</div>
    <div class="ai-compose">
      <div class="ai-opts"><label><input type="checkbox" id="aiPage" ${ai.usePage ? 'checked' : ''} ${t && t.url && t.kind === 'web' ? '' : 'disabled'}> Seite einbeziehen</label>
        <label><input type="checkbox" id="aiSel" ${ai.useSel ? 'checked' : ''}> Markierten Text</label></div>
      <textarea id="aiInput" rows="3" placeholder="Frage stellen … (Enter senden, Umschalt+Enter neue Zeile)"></textarea>
      <button class="primary" id="aiSend">${ai.reqId ? 'Stopp' : 'Senden'}</button>
      <p class="hint">Webseiten-Inhalte gehen nur mit „Seite einbeziehen“ an ${esc(aiInfo.name)}. Passwörter und Formulareingaben nie. KI kann Fehler machen – Quellen prüfen.</p>
    </div>`;
  wireLinks($('aiLog'));
  $('aiLog').querySelectorAll('[data-copy]').forEach((b, i) => { b.onclick = () => navigator.clipboard.writeText(ai.messages.filter((m) => m.role !== 'user')[i]?.content || '').then(() => toast('Kopiert')); });
  $('aiLog').querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => aiAsk(b.dataset.q); });
  $('aiConvs').onchange = () => { ai.convId = $('aiConvs').value || null; renderAI(); };
  $('aiNew').onclick = () => { ai.convId = null; renderAI(); };
  if ($('aiDel')) $('aiDel').onclick = async () => { if (confirm('Dieses Gespräch löschen?')) { await api.aiDelete(ai.convId); ai.convId = null; renderAI(); } };
  if ($('aiExport')) $('aiExport').onclick = async () => { const f = await api.aiExport(ai.convId); if (f) toast(`In „${f}“ gespeichert`); };
  $('aiPage').onchange = () => { ai.usePage = $('aiPage').checked; };
  $('aiSel').onchange = () => { ai.useSel = $('aiSel').checked; };
  $('aiInput').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiAsk($('aiInput').value); } };
  $('aiSend').onclick = () => (ai.reqId ? api.aiStop(ai.reqId) : aiAsk($('aiInput').value));
  $('panelBody').scrollTop = $('panelBody').scrollHeight;
  $('aiInput').focus();
}
async function aiAsk(question, opts = {}) {
  question = String(question || '').trim();
  if (!question || ai.reqId) return;
  if (panel !== 'ai') { openPanel('ai'); await new Promise((r) => setTimeout(r, 60)); }
  const t = activeTab();
  const usePage = opts.usePage ?? (ai.usePage && !!(t && t.url && t.kind === 'web'));
  const useSelection = opts.selection ?? ai.useSel;
  const log = $('aiLog'); if (!log) return;
  if (!ai.messages.length) log.innerHTML = '';
  log.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(question)}</div><div class="msg ai" id="aiLive"><span class="ai-badge">KI-Antwort</span><div class="md"><div class="skeleton"></div><div class="skeleton short"></div></div></div>`);
  if ($('aiInput')) $('aiInput').value = '';
  ai.el = $('aiLive'); ai.text = '';
  const r = await api.aiAsk({ convId: ai.convId, question, usePage, useSelection });
  if (!r || r.error) {
    ai.el.className = 'msg err'; ai.el.textContent = r && r.error === 'nokey' ? 'Bitte zuerst in den Einstellungen → KI einen Zugang einrichten.' : 'Bitte eine Frage eingeben.';
    return;
  }
  ai.reqId = r.id; ai.convId = r.convId;
  if ($('aiSend')) $('aiSend').textContent = 'Stopp';
}
api.onAiChunk(({ id, text }) => {
  if (id !== ai.reqId || !ai.el) return;
  ai.text += text;
  ai.el.querySelector('.md').innerHTML = md(ai.text);
  const pb = $('panelBody'); if (pb.scrollHeight - pb.scrollTop - pb.clientHeight < 160) pb.scrollTop = pb.scrollHeight;
});
api.onAiDone(({ id, convId, source, model }) => {
  if (id !== ai.reqId) return;
  ai.reqId = null; ai.convId = convId;
  ai.messages.push({ role: 'user' }, { role: 'assistant', content: ai.text, source, model });
  if (ai.el) {
    ai.el.removeAttribute('id');
    ai.el.insertAdjacentHTML('beforeend', `<div class="meta">${source ? `Quelle: <a href="#" data-url="${esc(source.url)}">${esc(source.title || hostOf(source.url))}</a> ·` : ''} ${esc(model)} <button data-copylive>Kopieren</button></div>`);
    wireLinks(ai.el);
    const txt = ai.text;
    ai.el.querySelector('[data-copylive]').onclick = () => navigator.clipboard.writeText(txt).then(() => toast('Kopiert'));
  }
  if ($('aiSend')) $('aiSend').textContent = 'Senden';
});
api.onAiError(({ id, message, partial }) => {
  if (id !== ai.reqId) return;
  ai.reqId = null;
  if (ai.el) { ai.el.className = 'msg err'; ai.el.innerHTML = (partial ? md(partial) : '') + `<p>${esc(message)}</p>`; ai.el.removeAttribute('id'); }
  if ($('aiSend')) $('aiSend').textContent = 'Senden';
});
api.onAiPrompt(({ text, selection }) => { openPanel('ai'); setTimeout(() => aiAsk(text, { usePage: false, selection: !!selection }), 80); });

// ---------- Lesezeichen ----------
let bmQuery = '';
function renderBookmarks() {
  $('panelTitle').textContent = 'Lesezeichen';
  const all = settings.bookmarks || [];
  const q = bmQuery.toLowerCase();
  const list = all.map((b, i) => ({ ...b, i })).filter((b) => !q || (b.title + ' ' + b.url + ' ' + (b.folder || '') + ' ' + (b.tags || []).join(' ')).toLowerCase().includes(q));
  const folders = [...new Set(list.map((b) => b.folder || ''))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'de')));
  const t = activeTab();
  $('panelBody').innerHTML = `
    <input type="search" id="bmSearch" placeholder="Lesezeichen durchsuchen (Titel, Adresse, Ordner, Tags)" value="${esc(bmQuery)}">
    ${t && t.url && t.kind === 'web' && !isBookmarked(t.url) ? '<button class="secondary" id="bmAdd">☆ Aktuelle Seite hinzufügen</button>' : ''}
    ${folders.map((f) => `<p class="day">${f ? '📁 ' + esc(f) : 'Lesezeichenleiste'}</p>` + list.filter((b) => (b.folder || '') === f).map((b) => `
      <div class="list-item" data-open="${b.i}">${favHTML({ url: b.url })}<div class="grow"><b>${esc(b.title)}</b><small>${esc(hostOf(b.url))}${(b.tags || []).map((x) => ` <span class="tag">${esc(x)}</span>`).join('')}</small></div>
      <button class="icon" data-edit="${b.i}" title="Bearbeiten">✎</button><button class="icon" data-del="${b.i}" title="Entfernen">✕</button></div>`).join('')).join('') || '<p class="hint">Keine Lesezeichen gefunden.</p>'}
    <div class="group"><h3>Übernehmen & sichern</h3>
      <button class="secondary" id="bmImport">Aus Chrome, Safari, Edge oder Firefox importieren …</button>
      <button class="secondary" id="bmExport">Exportieren (HTML)</button>
      <p class="hint">Im alten Browser: Lesezeichen-Manager → „Exportieren“ → die HTML-Datei hier importieren. Doppelte werden erkannt und übersprungen.</p></div>`;
  $('bmSearch').oninput = () => { bmQuery = $('bmSearch').value; const pos = $('bmSearch').selectionStart; renderBookmarks(); $('bmSearch').focus(); $('bmSearch').setSelectionRange(pos, pos); };
  if ($('bmAdd')) $('bmAdd').onclick = () => bookmarkCurrent();
  $('panelBody').querySelectorAll('[data-open]').forEach((el) => { el.onclick = (e) => { if (!e.target.closest('button')) api.navigate(all[el.dataset.open].url); }; });
  $('panelBody').querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { const l = [...all]; l.splice(+b.dataset.del, 1); await setS({ bookmarks: l }); renderBookmarks(); renderBookmarkBar(); renderStart(); }; });
  $('panelBody').querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editBookmark(+b.dataset.edit); });
  $('bmImport').onclick = async () => { const r = await api.importBookmarks(); if (r) { settings.bookmarks = r.bookmarks; toast(`${r.added} Lesezeichen übernommen${r.duplicates ? `, ${r.duplicates} doppelte übersprungen` : ''}`); renderBookmarks(); renderBookmarkBar(); renderStart(); } };
  $('bmExport').onclick = async () => { const f = await api.exportBookmarks(); if (f) toast(`Gespeichert als „${f}“`); };
}
function editBookmark(i) {
  const b = (settings.bookmarks || [])[i]; if (!b) return;
  const folders = [...new Set((settings.bookmarks || []).map((x) => x.folder).filter(Boolean))];
  $('panelBody').innerHTML = `<div class="group"><h3>Lesezeichen bearbeiten</h3>
    <p><input type="text" id="beTitle" value="${esc(b.title)}" placeholder="Titel"></p>
    <p><input type="text" id="beUrl" value="${esc(b.url)}" placeholder="Adresse"></p>
    <p><input type="text" id="beFolder" value="${esc(b.folder || '')}" list="beFolders" placeholder="Ordner (leer = Lesezeichenleiste, Unterordner mit „ / “)"><datalist id="beFolders">${folders.map((f) => `<option value="${esc(f)}">`).join('')}</datalist></p>
    <p><input type="text" id="beTags" value="${esc((b.tags || []).join(', '))}" placeholder="Tags, mit Komma getrennt"></p>
    <button class="primary" id="beSave">Speichern</button><button class="link" id="beCancel">Abbrechen</button></div>`;
  $('beSave').onclick = async () => {
    const url = $('beUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) return toast('Bitte eine Adresse mit https:// eingeben');
    const l = [...settings.bookmarks];
    l[i] = { ...b, title: $('beTitle').value.trim() || hostOf(url), url, folder: $('beFolder').value.trim(), tags: $('beTags').value.split(',').map((x) => x.trim()).filter(Boolean) };
    await setS({ bookmarks: l }); renderBookmarks(); renderBookmarkBar(); renderStart();
  };
  $('beCancel').onclick = renderBookmarks;
}
async function bookmarkCurrent() {
  const t = activeTab();
  if (!t || !t.url || t.kind !== 'web') return;
  const l = [...(settings.bookmarks || [])];
  const i = l.findIndex((b) => b.url === t.url);
  if (i >= 0) { l.splice(i, 1); await setS({ bookmarks: l }); toast('Lesezeichen entfernt'); }
  else { l.push({ title: (t.title || hostOf(t.url)).slice(0, 80), url: t.url, folder: '', tags: [] }); await setS({ bookmarks: l }); toast('Als Lesezeichen gespeichert'); }
  renderToolbar(); renderBookmarkBar(); renderStart(); if (panel === 'bookmarks') renderBookmarks();
}

// ---------- Verlauf ----------
let histQuery = '', histRange = 'all';
async function renderHistory() {
  $('panelTitle').textContent = 'Verlauf';
  if (!Number(settings.historyDays)) {
    $('panelBody').innerHTML = '<p class="hint">Der Verlauf ist ausgeschaltet – es wird nichts gespeichert.</p><button class="secondary" id="hOn">Verlauf einschalten (30 Tage)</button>';
    $('hOn').onclick = async () => { await setS({ historyDays: 30 }); renderHistory(); };
    return;
  }
  const now = Date.now(), day = 86400000;
  const from = { today: new Date().setHours(0, 0, 0, 0), week: now - 7 * day, month: now - 30 * day, all: 0 }[histRange];
  const items = await api.historySearch({ q: histQuery.replace(/site:\S+/, '').trim(), from, site: (/site:(\S+)/.exec(histQuery) || [])[1] || '' });
  if (panel !== 'history') return;
  let lastDay = '';
  const rows = items.map((h) => {
    const d = new Date(h.t).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    const head = d !== lastDay ? `<p class="day">${esc(d)}</p>` : ''; lastDay = d;
    return head + `<div class="list-item" data-url="${esc(h.url)}">${favHTML({ url: h.url })}<div class="grow"><b>${esc(h.title || h.url)}</b><small>${new Date(h.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ${esc(hostOf(h.url))}</small></div><button class="icon" data-del="${esc(h.id)}" title="Aus Verlauf löschen">✕</button></div>`;
  }).join('');
  $('panelBody').innerHTML = `<input type="search" id="hSearch" placeholder="Verlauf durchsuchen (z. B. wohnung site:immowelt.de)" value="${esc(histQuery)}">
    ${seg([['today', 'Heute'], ['week', '7 Tage'], ['month', '30 Tage'], ['all', 'Alles']], histRange)}
    ${rows || '<p class="hint">Nichts gefunden.</p>'}
    <div class="group"><h3>Löschen</h3><button class="danger" id="hClearRange">${histRange === 'all' ? 'Gesamten Verlauf löschen' : 'Diesen Zeitraum löschen'}</button>
    <p class="hint">Verlauf bleibt nur auf diesem Computer und wird nach ${settings.historyDays} Tagen automatisch gelöscht (Einstellungen → Datenschutz).</p></div>`;
  $('hSearch').oninput = () => { histQuery = $('hSearch').value; clearTimeout(renderHistory.t); renderHistory.t = setTimeout(async () => { const pos = $('hSearch').selectionStart; await renderHistory(); $('hSearch').focus(); $('hSearch').setSelectionRange(pos, pos); }, 150); };
  wireSeg((k) => { histRange = k; renderHistory(); });
  $('panelBody').querySelectorAll('.list-item[data-url]').forEach((el) => { el.onclick = (e) => { if (!e.target.closest('button')) api.navigate(el.dataset.url); }; el.onauxclick = (e) => { if (e.button === 1) api.newTab(el.dataset.url); }; });
  $('panelBody').querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { await api.historyRemove(b.dataset.del); renderHistory(); }; });
  $('hClearRange').onclick = async () => { if (confirm(histRange === 'all' ? 'Gesamten Verlauf löschen?' : 'Verlauf dieses Zeitraums löschen?')) { await api.historyClear({ from }); toast('Verlauf gelöscht'); renderHistory(); } };
}

// ---------- Downloads ----------
function renderDownloads() {
  $('panelTitle').textContent = 'Downloads';
  const label = { progress: 'Lädt …', paused: 'Pausiert', scanning: 'Virenprüfung …', done: 'Fertig', cancelled: 'Abgebrochen', threat: 'Virus gefunden – gelöscht' };
  const scan = { clean: ' · virengeprüft (Microsoft Defender)', system: ' · Prüfung durch macOS beim Öffnen', skipped: '' };
  $('panelBody').innerHTML = (downloads.map((d) => `<div class="list-item" data-id="${d.id}"><span class="tab-fav">${d.state === 'threat' ? '⛔' : '⇩'}</span>
    <div class="grow"><b>${esc(d.name)}</b><small>${label[d.state] || ''}${d.state === 'done' ? scan[d.scan] || '' : ''}${d.state === 'progress' && d.total ? ` · ${Math.round(d.received / d.total * 100)} %` : ''}</small>
    ${d.state === 'progress' ? `<div class="bar"><i style="width:${d.total ? Math.round(d.received / d.total * 100) : 30}%"></i></div>` : ''}</div>
    ${d.state === 'progress' ? `<button class="icon" data-cancel="${d.id}" title="Abbrechen">✕</button>` : d.state === 'done' ? `<button class="icon" data-show="${d.id}" title="Im Ordner zeigen">📁</button>` : ''}</div>`).join('')
    || '<p class="hint">Keine Downloads in dieser Sitzung.</p>') + `
    <div class="group"><h3>Ordner</h3><div class="row"><span>Speichern in</span><b>${esc(settings._dlName || '')}</b></div>
      <button class="secondary" id="dlOpen">Download-Ordner öffnen</button><button class="secondary" id="dlChoose">Anderen Ordner wählen …</button>
      ${downloads.some((d) => d.state !== 'progress') ? '<button class="link" id="dlClear">Liste leeren</button>' : ''}</div>`;
  $('panelBody').querySelectorAll('.list-item[data-id]').forEach((el) => { el.ondblclick = () => api.openDownload(el.dataset.id); });
  $('panelBody').querySelectorAll('[data-cancel]').forEach((b) => { b.onclick = () => api.cancelDownload(b.dataset.cancel); });
  $('panelBody').querySelectorAll('[data-show]').forEach((b) => { b.onclick = () => api.showDownload(b.dataset.show); });
  $('dlOpen').onclick = () => api.openDownloadDir();
  $('dlChoose').onclick = async () => { const n = await api.chooseDownloadDir(); if (n) { settings._dlName = n; toast(`Downloads gehen jetzt nach „${n}“`); renderDownloads(); } };
  if ($('dlClear')) $('dlClear').onclick = () => api.clearDownloads();
}

// ---------- Passwörter ----------
let pwQuery = '';
async function renderPasswords() {
  $('panelTitle').textContent = 'Passwörter';
  passwords = await api.pwList();
  if (panel !== 'passwords') return;
  const q = pwQuery.toLowerCase();
  const list = passwords.filter((p) => !q || (p.site + ' ' + p.user).toLowerCase().includes(q)).sort((a, b) => a.site.localeCompare(b.site, 'de'));
  const lockName = platform === 'darwin' ? 'Touch ID' : 'Windows Hello';
  $('panelBody').innerHTML = `
    <input type="search" id="pwSearch" placeholder="${passwords.length} Passwörter durchsuchen" value="${esc(pwQuery)}">
    ${list.map((p) => `<div class="list-item">${favHTML({ url: 'https://' + p.host })}<div class="grow"><b>${esc(p.site)}</b><small>${esc(p.user || '(ohne Benutzername)')}</small><small id="pv-${p.id}"></small></div>
      <button class="icon" data-reveal="${p.id}" title="Anzeigen (${lockName})">👁</button><button class="icon" data-copy="${p.id}" title="Passwort kopieren (${lockName})">⧉</button><button class="icon" data-del="${p.id}" title="Löschen">🗑</button></div>`).join('') || '<p class="hint">Noch keine Passwörter gespeichert.</p>'}
    <div class="group"><h3>Übernehmen</h3>
      <button class="secondary" id="pwImport">Passwörter importieren (CSV) …</button>
      <p class="hint"><b>iPhone/Mac:</b> App „Passwörter“ → Ablage → „Alle Passwörter exportieren“.<br><b>Google/Chrome:</b> passwords.google.com → Einstellungen → Exportieren.<br>Danach die CSV-Datei hier wählen und anschließend <b>löschen</b> (sie ist unverschlüsselt).</p></div>
    <div class="group"><h3>Sicherheit</h3><p class="small">Jedes Passwort ist einzeln mit der Verschlüsselung deines Systems gesichert (${platform === 'darwin' ? 'Mac-Schlüsselbund' : 'Windows DPAPI'}). Anzeigen und Ausfüllen nur nach ${lockName}. Passwörter verlassen diesen Computer nicht.</p>
    <p class="hint">Geräte-Abgleich mit iPhone/Mac ist in Arbeit; bis dahin per Export/Import übertragen.</p></div>`;
  $('pwSearch').oninput = () => { pwQuery = $('pwSearch').value; const pos = $('pwSearch').selectionStart; renderPasswords().then(() => { $('pwSearch').focus(); $('pwSearch').setSelectionRange(pos, pos); }); };
  $('panelBody').querySelectorAll('[data-reveal]').forEach((b) => { b.onclick = async () => { const r = await api.pwReveal(b.dataset.reveal); const el = $('pv-' + b.dataset.reveal); if (r && el) { el.textContent = r.pass; setTimeout(() => { el.textContent = ''; }, 20000); } }; });
  $('panelBody').querySelectorAll('[data-copy]').forEach((b) => { b.onclick = async () => { const r = await api.pwReveal(b.dataset.copy); if (r) { await navigator.clipboard.writeText(r.pass); toast('Passwort kopiert – wird in 30 Sekunden aus der Zwischenablage entfernt'); setTimeout(() => navigator.clipboard.writeText(''), 30000); } }; });
  $('panelBody').querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { const p = passwords.find((x) => x.id === b.dataset.del); if (p && confirm(`Passwort für ${p.site}${p.user ? ` (${p.user})` : ''} löschen?`)) { passwords = await api.pwDelete(p.id); renderPasswords(); } }; });
  $('pwImport').onclick = async () => { const r = await api.pwImport(); if (!r) return; if (r.error) return toast(r.error); toast(`${r.added} Passwörter übernommen${r.skipped ? `, ${r.skipped} übersprungen` : ''} – bitte die CSV-Datei jetzt löschen`); renderPasswords(); };
}

// ---------- Datenschutz-Center (echte Werte) ----------
async function renderPrivacy() {
  $('panelTitle').textContent = 'Datenschutz-Center';
  const st = settings.stats || {};
  const since = st.since ? new Date(st.since).toLocaleDateString('de-DE') : 'heute';
  const fresh = blockerInfo.fresh || {};
  const t = activeTab();
  $('panelBody').innerHTML = `
    <div class="stat-grid">
      <div class="stat"><b>${num(st.werbung)}</b><span>Werbung & Tracker</span></div>
      <div class="stat"><b>${num(st.malware)}</b><span>Malware-Seiten</span></div>
      <div class="stat"><b>${num(st.phishing)}</b><span>Phishing-Seiten</span></div>
      <div class="stat"><b>${num(st.eigene)}</b><span>Eigene Sperrliste</span></div>
    </div><p class="hint">Gezählt seit ${esc(since)} – echte Treffer des Blockers.</p>
    <div class="group"><h3>Verbindung</h3>
      <div class="row"><span>NordVPN</span><b>${vpnState.status === 'on' ? 'aktiv · ' + esc(vpnState.server || '') : vpnState.loggedIn ? esc(vpnState.message || 'verbindet') : 'nicht angemeldet'}</b></div>
      <div class="row"><span>DNS</span><b>${vpnState.status === 'on' ? 'über NordVPN' : esc((dnsList.find((d) => d.id === settings.dnsProvider) || {}).name || 'Quad9')}</b></div>
      <div class="row"><span>Diese Seite</span><b>${t && /^https:/.test(t.url) ? '🔒 HTTPS, Zertifikat gültig' : t && t.url ? 'nicht verschlüsselt' : '–'}</b></div>
      <div class="row"><span>WebRTC (echte IP)</span><b>${vpnState.status === 'on' ? 'nur über VPN' : 'lokale IP verborgen'}</b></div>
    </div>
    <div class="group"><h3>Filterlisten</h3>
      ${Object.entries(blockerInfo.counts || {}).map(([k, v]) => `<div class="row"><span>${{ werbung: 'Werbung & Tracker', malware: 'Malware', phishing: 'Phishing' }[k] || k}<span class="desc">${esc((blockerInfo.sources[k] || {}).name || '')}${fresh[k] ? ' · aktualisiert ' + new Date(fresh[k].date).toLocaleDateString('de-DE') : ''}</span></span><b>${num(v)} Einträge</b></div>`).join('')}
      <button class="secondary" id="prRefresh">Listen jetzt aktualisieren</button></div>
    <div class="group"><h3>Spurlos</h3>
      <p class="small">Verlässt du eine Seite (letzter Tab zu), werden ihre Cookies und Website-Daten nach wenigen Sekunden gelöscht – außer bei Seiten, bei denen du angemeldet bleiben willst (${(settings.keepSignedIn || []).length}). Tracking-Zusätze in Links werden entfernt, „Global Privacy Control“ wird gesendet.</p>
      <button class="secondary" id="prKeep">Angemeldet bleiben bei …</button>
      <button class="danger" id="prClear">Alle Website-Daten jetzt löschen</button></div>
    <p class="hint">Kein Schutz ist 100 %. Webseiten, bei denen du dich anmeldest, wissen, wer du bist.</p>`;
  $('prRefresh').onclick = async () => { $('prRefresh').textContent = 'Lädt …'; blockerInfo = await api.refreshLists(); toast('Listen aktualisiert'); renderPrivacy(); };
  $('prKeep').onclick = () => openPanel('settings', 'datenschutz');
  $('prClear').onclick = async () => { if (confirm('Alle Cookies und Website-Daten löschen? Du wirst überall abgemeldet.')) await api.clearSiteData(); };
}

// ---------- Tabs-Übersicht (Suche + Vorschau) ----------
let tabsQuery = '';
async function renderTabsPanel() {
  $('panelTitle').textContent = 'Alle Tabs';
  const q = tabsQuery.toLowerCase();
  const list = state.tabs.filter((t) => !q || (t.title + ' ' + t.url).toLowerCase().includes(q));
  $('panelBody').innerHTML = `<input type="search" id="tsSearch" placeholder="Tabs durchsuchen" value="${esc(tabsQuery)}">` +
    state.workspaces.map((w) => { const l = list.filter((t) => t.ws === w.id); return l.length ? `<p class="day">${esc(w.name)}</p>` + l.map((t) => `<div class="tab-card" data-id="${t.id}"><div class="thumb" id="th-${t.id}">${t.suspended ? 'schläft' : ''}</div><div class="grow" style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</b><small class="hint">${esc(hostOf(t.url))}</small></div></div>`).join('') : ''; }).join('');
  $('tsSearch').oninput = () => { tabsQuery = $('tsSearch').value; const pos = $('tsSearch').selectionStart; renderTabsPanel().then(() => { $('tsSearch').focus(); $('tsSearch').setSelectionRange(pos, pos); }); };
  $('panelBody').querySelectorAll('.tab-card').forEach((el) => { el.onclick = () => api.selectTab(el.dataset.id); });
  for (const t of list.filter((x) => !x.suspended && x.id !== state.activeId).slice(0, 16)) {
    api.tabPreview(t.id).then((img) => { const el = $('th-' + t.id); if (img && el) el.style.backgroundImage = `url("${img}")`; });
  }
}

// ---------- Einstellungen ----------
let setTab = 'allgemein';
function renderSettings() {
  if (panelSub) { setTab = panelSub; panelSub = null; }
  $('panelTitle').textContent = 'Einstellungen';
  const body = { allgemein: setGeneral, datenschutz: setPrivacy, sicherheit: setSecurity, vpn: setVPN, ki: setAI, bereiche: setWorkspaces, updates: setUpdates }[setTab] || setGeneral;
  $('panelBody').innerHTML = seg([['allgemein', 'Allgemein'], ['datenschutz', 'Datenschutz'], ['sicherheit', 'Sicherheit'], ['vpn', 'NordVPN'], ['ki', 'KI'], ['bereiche', 'Bereiche'], ['updates', 'Updates']], setTab) + '<div id="setBody"></div>';
  wireSeg((k) => { setTab = k; renderSettings(); });
  body();
}
const setBody = (html) => { $('setBody').innerHTML = html; };
const bindSwitch = (id, key, after) => { const el = $(id); if (el) el.onchange = async () => { await setS({ [key]: el.checked }); if (after) after(el.checked); }; };

function setGeneral() {
  const engines = [['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['startpage', 'Startpage'], ['bing', 'Bing'], ['ecosia', 'Ecosia']];
  setBody(`<div class="group"><h3>Standardbrowser</h3><div class="row"><span>ImmoAdv Browser als Standard<span class="desc" id="defDesc">Links aus Mails, Programmen und PDFs öffnen hier</span></span><button class="pill accent" id="defBtn">Festlegen</button></div></div>
    <div class="group"><h3>Google-Konto</h3>${sw('sGoogle', settings.googleExternal !== false, 'Gmail, Drive & Google-Anmeldung in Chrome öffnen', 'Google erlaubt die Anmeldung nur in Chrome, Edge, Firefox und Safari. Suche und YouTube bleiben hier.')}</div>
    <div class="group"><h3>Start & Tabs</h3>
      ${sw('sRestore', settings.restoreSession !== false, 'Offene Tabs beim Start wiederherstellen', 'Nur Adressen, keine Inhalte')}
      <div class="row"><span>Tabs anzeigen</span><select id="sLayout"><option value="horizontal" ${!vertical() ? 'selected' : ''}>Oben (waagerecht)</option><option value="vertical" ${vertical() ? 'selected' : ''}>Links (senkrecht)</option></select></div>
      <div class="row"><span>Hintergrund-Tabs schlafen legen<span class="desc">spart Arbeitsspeicher und Akku</span></span><select id="sSuspend">${[[0, 'Nie'], [15, 'nach 15 Min.'], [30, 'nach 30 Min.'], [60, 'nach 1 Std.']].map(([v, l]) => `<option value="${v}" ${Number(settings.suspendMinutes) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${sw('sBar', settings.bookmarkBar !== false, 'Lesezeichenleiste', `${mod()}+Umschalt+B`)}</div>
    <div class="group"><h3>Suche</h3><div class="row"><span>Suchmaschine</span><select id="sEngine">${engines.map(([v, l]) => `<option value="${v}" ${settings.searchEngine === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="group"><h3>Downloads</h3><div class="row"><span>Speichern in</span><b>${esc(settings._dlName || '')}</b></div><button class="secondary" id="sDl">Ordner wählen …</button></div>
    <div class="group"><h3>Tastenkürzel</h3>${[['Neuer Tab', 'T'], ['Tab schließen', 'W'], ['Geschlossenen Tab öffnen', 'Umschalt+T'], ['Nächster Tab', 'Tab'], ['Adressleiste', 'L'], ['Suchen auf der Seite', 'F'], ['Schnellbefehle', 'K'], ['KI-Assistent', 'Umschalt+A'], ['Kurzfassung', 'J'], ['Verlauf', 'H'], ['Downloads', 'E'], ['Lesezeichen setzen', 'D'], ['Geteilte Ansicht', 'Umschalt+S'], ['Einstellungen', ',']].map(([l, k]) => `<div class="row"><span>${l}</span><span class="hint">${mod()}+${k}</span></div>`).join('')}<div class="row"><span>Entwicklertools</span><span class="hint">F12</span></div></div>
    <p class="hint">ImmoAdv Browser ${esc(appVersion)} · Chromium ${esc((navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || '')}</p>`);
  api.isDefaultBrowser().then((d) => { if (d && $('defBtn')) { $('defBtn').textContent = 'Ist Standard ✓'; $('defBtn').className = 'pill'; } });
  $('defBtn').onclick = async () => {
    const r = await api.makeDefaultBrowser();
    if (r && r.how === 'windows') toast('Windows-Einstellungen geöffnet: bei „ImmoAdv Browser“ auf „Als Standard festlegen“ klicken');
    else toast('Bitte in der Mac-Abfrage „ImmoAdv Browser verwenden“ wählen');
  };
  bindSwitch('sRestore', 'restoreSession');
  bindSwitch('sGoogle', 'googleExternal');
  bindSwitch('sBar', 'bookmarkBar', renderBookmarkBar);
  $('sLayout').onchange = async () => { await setS({ tabLayout: $('sLayout').value }); renderAll(); };
  $('sSuspend').onchange = () => setS({ suspendMinutes: Number($('sSuspend').value) });
  $('sEngine').onchange = () => setS({ searchEngine: $('sEngine').value });
  $('sDl').onclick = async () => { const n = await api.chooseDownloadDir(); if (n) { settings._dlName = n; setGeneral(); } };
}

// Lange Listen einklappbar (nur Anzeige – ändert nichts an den Regeln)
const openLists = new Set();
function foldList(key, label, itemsHTML, count) {
  return `<details class="fold" data-fold="${key}" ${openLists.has(key) ? 'open' : ''}><summary>${label} <span class="hint">${count}</span></summary>${itemsHTML}</details>`;
}
function wireFolds() { $('panelBody').querySelectorAll('details[data-fold]').forEach((d) => { d.ontoggle = () => (d.open ? openLists.add(d.dataset.fold) : openLists.delete(d.dataset.fold)); }); }

// aktuelle Seite nur anbieten, wenn sie noch nicht (auch nicht über die Hauptdomain) in der Liste ist
function curKeepable() {
  const t = activeTab(); const h = t && /^https?:/.test(t.url) ? hostOf(t.url) : '';
  if (!h) return '';
  const site = h.split('.').slice(-2).join('.');
  return (settings.keepSignedIn || []).some((d) => h === d || h.endsWith('.' + d)) ? '' : site;
}

function setPrivacy() {
  setBody(`<div class="group"><h3>Angemeldet bleiben</h3><p class="small">Überall sonst werden Cookies gelöscht, sobald du eine Seite verlässt.</p>
      ${foldList('keep', 'Seiten anzeigen', (settings.keepSignedIn || []).map((d, i) => `<div class="list-item"><div class="grow"><b>${esc(d)}</b></div><button class="icon" data-k="${i}" title="Entfernen">✕</button></div>`).join(''), (settings.keepSignedIn || []).length)}
      <div class="row"><input type="text" id="kAdd" placeholder="z. B. amazon.de"><button class="pill" id="kAddBtn">Hinzufügen</button></div>
      ${curKeepable() ? `<button class="secondary" id="kCur">Aktuelle Seite (${esc(curKeepable())}) hinzufügen</button>` : ''}</div>
    <div class="group"><h3>Verlauf</h3><div class="row"><span>Verlauf aufbewahren<span class="desc">nur auf diesem Computer</span></span><select id="pHist">${[[0, 'Gar nicht'], [7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage'], [365, '1 Jahr']].map(([v, l]) => `<option value="${v}" ${Number(settings.historyDays) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="group"><h3>Links & Berechtigungen</h3>
      ${sw('pClean', settings.cleanLinks !== false, 'Tracking aus Links entfernen', 'utm, fbclid, gclid …')}
      <button class="secondary" id="pPerms">Gespeicherte Seiten-Berechtigungen zurücksetzen</button></div>
    <div class="group"><h3>KI</h3>${sw('pAiHist', settings.aiKeepHistory !== false, 'KI-Gespräche speichern', 'nur lokal')}<button class="secondary" id="pAiDel">Alle KI-Gespräche löschen</button></div>
    <button class="danger" id="pAll">Alle Website-Daten löschen</button>`);
  wireFolds();
  $('panelBody').querySelectorAll('[data-k]').forEach((b) => { b.onclick = async () => { const l = [...settings.keepSignedIn]; l.splice(+b.dataset.k, 1); await setS({ keepSignedIn: l }); setPrivacy(); }; });
  const addKeep = async (v) => { const d = String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return toast('Bitte eine Domain wie amazon.de eingeben'); await setS({ keepSignedIn: [...new Set([...(settings.keepSignedIn || []), d])] }); setPrivacy(); };
  $('kAddBtn').onclick = () => addKeep($('kAdd').value);
  if ($('kCur')) $('kCur').onclick = () => addKeep(curKeepable());
  $('pHist').onchange = async () => { const v = Number($('pHist').value); if (v === 0 && !confirm('Verlauf ausschalten und den bisherigen Verlauf löschen?')) { $('pHist').value = settings.historyDays; return; } await setS({ historyDays: v }); };
  bindSwitch('pClean', 'cleanLinks');
  bindSwitch('pAiHist', 'aiKeepHistory');
  $('pPerms').onclick = async () => { if (confirm('Alle gespeicherten Entscheidungen (Kamera, Mikrofon, Standort …) zurücksetzen?')) { await api.resetPermissions(); toast('Zurückgesetzt'); } };
  $('pAiDel').onclick = async () => { if (confirm('Alle KI-Gespräche löschen?')) { await api.aiDeleteAll(); ai.convId = null; toast('Gelöscht'); } };
  $('pAll').onclick = async () => { if (confirm('Alle Cookies und Website-Daten löschen? Du wirst überall abgemeldet.')) await api.clearSiteData(); };
}

function setSecurity() {
  const lockName = platform === 'darwin' ? 'Touch ID' : 'Windows Hello';
  setBody(`<div class="group"><h3>Blocker</h3>
      ${sw('xAds', settings.blockAds !== false, 'Werbung & Tracker blockieren', 'HaGeZi Multi PRO')}
      ${sw('xMal', settings.blockMalware !== false, 'Malware-Seiten blockieren', 'URLhaus, täglich frisch')}
      ${sw('xPhi', settings.blockPhishing !== false, 'Phishing-Seiten blockieren', 'Phishing-Filter, täglich frisch')}
      ${sw('xFresh', settings.freshLists !== false, 'Listen täglich aktualisieren')}</div>
    <div class="group"><h3>Ausnahmen</h3><p class="small">Auf diesen Seiten wird nichts blockiert:</p>
      ${(settings.allowlist || []).length ? foldList('allow', 'Ausnahmen anzeigen', settings.allowlist.map((d, i) => `<div class="list-item"><div class="grow"><b>${esc(d)}</b></div><button class="icon" data-a="${i}">✕</button></div>`).join(''), settings.allowlist.length) : '<p class="hint">keine</p>'}
      <div class="row"><input type="text" id="aAdd" placeholder="z. B. meinebank.de"><button class="pill" id="aAddBtn">Hinzufügen</button></div>
      <p class="small">Eigene Sperrliste:</p>
      ${(settings.blocklist || []).length ? foldList('block', 'Sperrliste anzeigen', settings.blocklist.map((d, i) => `<div class="list-item"><div class="grow"><b>${esc(d)}</b></div><button class="icon" data-b="${i}">✕</button></div>`).join(''), settings.blocklist.length) : '<p class="hint">leer</p>'}
      <div class="row"><input type="text" id="bAdd" placeholder="Domain sperren"><button class="pill" id="bAddBtn">Sperren</button></div></div>
    <div class="group"><h3>Verbindung</h3>
      ${sw('xHttps', settings.httpsOnly !== false, 'Nur HTTPS', 'unverschlüsselte Seiten werden umgestellt')}
      <div class="row"><span>Verschlüsseltes DNS<span class="desc">wenn NordVPN aus ist</span></span><select id="xDns">${dnsList.map((d) => `<option value="${d.id}" ${settings.dnsProvider === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
      ${sw('xJs', settings.javaScript !== false, 'JavaScript', 'aus = sicherer, aber viele Seiten gehen nicht')}</div>
    <div class="group"><h3>Sperre</h3>${sw('xLock', !!settings.appLock, `Beim Start mit ${lockName} entsperren`)}<button class="secondary" id="xTest">${lockName} testen</button></div>`);
  wireFolds();
  bindSwitch('xAds', 'blockAds'); bindSwitch('xMal', 'blockMalware'); bindSwitch('xPhi', 'blockPhishing'); bindSwitch('xFresh', 'freshLists');
  bindSwitch('xHttps', 'httpsOnly'); bindSwitch('xJs', 'javaScript'); bindSwitch('xLock', 'appLock');
  const dom = (v) => String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  $('aAddBtn').onclick = async () => { const d = dom($('aAdd').value); if (d.includes('.')) { await setS({ allowlist: [...new Set([...(settings.allowlist || []), d])] }); setSecurity(); } };
  $('bAddBtn').onclick = async () => { const d = dom($('bAdd').value); if (d.includes('.')) { await setS({ blocklist: [...new Set([...(settings.blocklist || []), d])] }); setSecurity(); } };
  $('panelBody').querySelectorAll('[data-a]').forEach((b) => { b.onclick = async () => { const l = [...settings.allowlist]; l.splice(+b.dataset.a, 1); await setS({ allowlist: l }); setSecurity(); }; });
  $('panelBody').querySelectorAll('[data-b]').forEach((b) => { b.onclick = async () => { const l = [...settings.blocklist]; l.splice(+b.dataset.b, 1); await setS({ blocklist: l }); setSecurity(); }; });
  $('xDns').onchange = () => setS({ dnsProvider: $('xDns').value });
  $('xTest').onclick = async () => { const r = await api.pwTestUnlock(); toast(r && r.ok ? (r.noBiometric ? `${lockName} ist auf diesem Gerät nicht eingerichtet – es gilt die normale Anmeldung` : 'Erfolgreich') : 'Abgebrochen'); };
}

function setVPN() {
  if (!vpnState.loggedIn) {
    setBody(`<div class="group"><h3>NordVPN anmelden</h3>
      <p class="small">Einmal anmelden – danach läuft jeder Tab automatisch über NordVPN: schnellster Server, stiller Serverwechsel, WLAN ↔ Mobilfunk ohne Zutun. Ohne Verbindung wird nichts ungeschützt geladen. Die NordVPN-App brauchst du nicht.</p>
      <p><input type="text" id="vUser" placeholder="Dienst-Benutzername" autocomplete="off"></p>
      <p><input type="password" id="vPass" placeholder="Dienst-Passwort" autocomplete="off"></p>
      <button class="primary" id="vLogin">Anmelden</button>
      <p class="hint">Wichtig: Nicht E-Mail/Passwort, sondern die <b>Dienst-Zugangsdaten</b>: nordaccount.com → NordVPN → „Manuelle Einrichtung“ → Dienst-Zugangsdaten. Gespeichert verschlüsselt mit ${platform === 'darwin' ? 'dem Mac-Schlüsselbund' : 'Windows DPAPI'}.</p></div>`);
    $('vLogin').onclick = async () => {
      const u = $('vUser').value.trim(), p = $('vPass').value;
      if (!u || !p) return toast('Bitte beide Felder ausfüllen');
      $('vLogin').disabled = true; $('vLogin').textContent = 'Verbindet …';
      const ok = await api.vpnLogin(u, p);
      vpnState = (await api.state()).vpn;
      toast(ok ? 'NordVPN eingerichtet' : 'Anmeldung nicht möglich');
      setVPN(); renderShield();
    };
    return;
  }
  setBody(`<div class="group"><h3>Status</h3>
      <div class="row"><span>Verbindung</span><b class="${vpnState.status === 'on' ? 'pos' : vpnState.status === 'authfail' || vpnState.status === 'error' ? 'neg' : ''}">${vpnState.status === 'on' ? 'Aktiv · geprüft' : vpnState.status === 'authfail' ? 'Zugangsdaten abgelehnt' : vpnState.status === 'error' ? 'Gestört' : esc(vpnState.message || 'verbindet …')}</b></div>
      ${vpnState.status !== 'on' && vpnState.message ? `<p class="small">${esc(vpnState.message)}</p>` : ''}
      <div class="row"><span>Server</span><b>${esc(vpnState.server || '–')}</b></div>
      <div class="row"><span>Land</span><select id="vCountry">${countries.map((c) => `<option value="${c.code}" ${vpnState.country === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
    <p class="small">Läuft über NordVPNs verschlüsselten Proxy (TLS) für alle Tabs inkl. DNS. Andere Programme auf dem Computer sind davon nicht betroffen.</p>
    <button class="secondary" id="vRe">Verbindung neu prüfen</button>
    <button class="secondary" id="vEdit">Andere Zugangsdaten eingeben</button>
    <button class="danger" id="vOut">Abmelden</button><button class="link" id="vLog">VPN-Protokoll anzeigen</button>`);
  $('vRe').onclick = async () => { $('vRe').textContent = 'Prüft …'; vpnState = await api.vpnRecheck(); setVPN(); renderShield(); renderContent(); };
  $('vEdit').onclick = async () => { vpnState = await api.vpnLogout(); setVPN(); renderShield(); };
  $('vLog').onclick = async () => { if (!(await api.vpnLog())) toast('Noch kein Protokoll'); };
  $('vCountry').onchange = async () => { vpnState = await api.vpnCountry($('vCountry').value); toast('Land gewechselt'); setVPN(); };
  $('vOut').onclick = async () => { if (confirm('NordVPN abmelden? Danach läuft alles ohne VPN.')) { vpnState = await api.vpnLogout(); setVPN(); renderShield(); } };
}

async function setAI() {
  aiInfo = await api.aiConfig();
  const models = settings.aiModels || {};
  const p = aiProviders.find((x) => x.id === aiInfo.provider) || aiProviders[0];
  setBody(`<div class="group"><h3>Anbieter</h3>
      <div class="row"><span>KI-Anbieter</span><select id="aProv">${aiProviders.map((x) => `<option value="${x.id}" ${x.id === aiInfo.provider ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="row"><span>Modell</span><input type="text" id="aModel" value="${esc(models[p.id] || p.model)}" style="width:180px"></div>
      ${p.needsKey ? `<div class="row"><span>Schlüssel<span class="desc">${aiInfo.hasKey ? 'gespeichert ✓' : 'noch keiner'}</span></span></div>
        <p><input type="password" id="aKey" placeholder="${aiInfo.hasKey ? '•••••••• (neu eingeben zum Ändern)' : 'API-Schlüssel einfügen'}" autocomplete="off"></p>
        <button class="primary" id="aSave">Speichern</button>${aiInfo.hasKey ? '<button class="link" id="aRemove">Schlüssel entfernen</button>' : ''}
        <p class="hint">Schlüssel erstellen: <a href="#" data-url="${esc(p.keyUrl)}">${esc(p.keyUrl.replace('https://', ''))}</a>. Gespeichert verschlüsselt, nie im Klartext.</p>`
      : `<p class="small">Ollama läuft komplett auf deinem Computer – keine Daten gehen ins Internet. Einmal <a href="#" data-url="https://ollama.com/download">Ollama installieren</a> und im Terminal <code>ollama pull ${esc(models.ollama || p.model)}</code> ausführen.</p><button class="primary" id="aSave">Speichern</button>`}</div>
    <div class="group"><h3>Eigene Vorgaben</h3><textarea id="aInstr" rows="4" placeholder="z. B. Ich bin Immobilien-Investorin, rechne in Euro, antworte kurz.">${esc(settings.aiInstructions || '')}</textarea>
      <p class="hint">Gilt für jede Antwort. Seiteninhalte können diese Vorgaben nicht ändern.</p></div>
    <div class="group"><h3>Datenschutz</h3><p class="small">Seiteninhalte gehen nur an den Anbieter, wenn „Seite einbeziehen“ an ist. Passwörter, Formulareingaben und Verlauf nie. Der Assistent kann nichts klicken, kaufen oder senden.</p></div>`);
  wireLinks($('setBody'));
  $('aProv').onchange = async () => { await setS({ aiProvider: $('aProv').value }); setAI(); };
  $('aSave').onclick = async () => {
    await setS({ aiModels: { ...models, [p.id]: $('aModel').value.trim() || p.model }, aiInstructions: $('aInstr').value.slice(0, 2000) });
    if ($('aKey') && $('aKey').value.trim()) await api.aiSetKey(p.id, $('aKey').value.trim());
    aiInfo = await api.aiConfig(); toast('KI gespeichert'); setAI();
  };
  $('aInstr').onchange = () => setS({ aiInstructions: $('aInstr').value.slice(0, 2000) });
  if ($('aRemove')) $('aRemove').onclick = async () => { await api.aiSetKey(p.id, ''); aiInfo = await api.aiConfig(); setAI(); };
}

function setWorkspaces() {
  const COLORS = ['#2A5BD7', '#19C2B0', '#8b5cf6', '#f2b34a', '#ff5d6c', '#2fcf8a'];
  setBody(`<p class="small">Jeder Bereich hat eigene Tabs – z. B. „Privat“ und „Immobilien“. Wechseln oben links bzw. in der Seitenleiste.</p>
    ${state.workspaces.map((w, i) => `<div class="group"><div class="row" style="padding:0"><input type="text" data-name="${i}" value="${esc(w.name)}" style="flex:1"><input type="text" data-icon="${i}" value="${esc(w.icon || '')}" style="width:46px;text-align:center" maxlength="2" title="Symbol"></div>
      <div class="chips">${COLORS.map((c) => `<button class="chip" data-color="${i}" data-c="${c}" style="background:${c};width:28px;${w.color === c ? 'outline:2px solid #fff' : ''}" aria-label="Farbe"></button>`).join('')}
      ${state.workspaces.length > 1 ? `<button class="chip" data-wdel="${i}">Entfernen</button>` : ''}</div></div>`).join('')}
    <button class="secondary" id="wAdd">＋ Bereich hinzufügen</button><button class="primary" id="wSave">Speichern</button>
    <p class="hint">Entfernst du einen Bereich, wandern seine Tabs in den ersten Bereich – es geht nichts verloren.</p>`);
  const list = state.workspaces.map((w) => ({ ...w }));
  $('setBody').querySelectorAll('[data-name]').forEach((el) => { el.oninput = () => { list[el.dataset.name].name = el.value; }; });
  $('setBody').querySelectorAll('[data-icon]').forEach((el) => { el.oninput = () => { list[el.dataset.icon].icon = el.value; }; });
  $('setBody').querySelectorAll('[data-color]').forEach((el) => { el.onclick = () => { list[el.dataset.color].color = el.dataset.c; el.parentElement.querySelectorAll('[data-c]').forEach((x) => { x.style.outline = x === el ? '2px solid #fff' : ''; }); }; });
  $('setBody').querySelectorAll('[data-wdel]').forEach((el) => { el.onclick = async () => { list.splice(+el.dataset.wdel, 1); state.workspaces = await api.saveWorkspaces(list); setWorkspaces(); }; });
  $('wAdd').onclick = async () => { list.push({ id: 'ws-' + Date.now().toString(36), name: 'Neuer Bereich', color: COLORS[list.length % COLORS.length], icon: '◆' }); state.workspaces = await api.saveWorkspaces(list); setWorkspaces(); };
  $('wSave').onclick = async () => { state.workspaces = await api.saveWorkspaces(list); renderWorkspaces(); toast('Bereiche gespeichert'); };
}

function updateLine() {
  return { checking: 'Suche nach Updates …', current: 'Aktuell – du hast die neueste Version', available: `Version ${upd.version} verfügbar`, downloading: `Lädt Version ${upd.version} … ${upd.progress || 0} %`,
    ready: `Version ${upd.version} ist bereit`, installing: 'Wird installiert – der Browser startet gleich neu', retry: upd.message, error: upd.message, unsupported: upd.message }[upd.status] || '–';
}
function setUpdates() {
  const can = ['available', 'ready', 'retry', 'error', 'current', 'idle'].includes(upd.status);
  setBody(`<div class="group"><h3>ImmoAdv Browser ${esc(appVersion)}</h3>
      <div class="row"><span>Status</span><b>${esc(updateLine())}</b></div>
      ${upd.status === 'downloading' ? `<div class="bar"><i style="width:${upd.progress || 0}%"></i></div>` : ''}
      ${['available', 'ready', 'downloading'].includes(upd.status) ? '<button class="primary" id="uNow">Update jetzt installieren</button>' : `<button class="secondary" id="uCheck" ${can ? '' : 'disabled'}>Nach Updates suchen</button>`}
      ${sw('uAuto', settings.autoUpdate !== false, 'Updates automatisch laden', 'werden beim nächsten Beenden still installiert')}</div>
    <p class="small">„Update jetzt installieren“ lädt die neue Version, installiert sie ohne weitere Fragen und startet den Browser neu. Tabs, Lesezeichen, Passwörter und Einstellungen bleiben erhalten.</p>
    <button class="link" id="uLog">Update-Protokoll anzeigen</button>`);
  if ($('uNow')) $('uNow').onclick = () => { api.updateNow(); toast('Update wird geladen und installiert …'); };
  if ($('uCheck')) $('uCheck').onclick = () => api.checkUpdate();
  $('uAuto').onchange = () => api.setAutoUpdate($('uAuto').checked);
  $('uLog').onclick = async () => { if (!(await api.showUpdateLog())) toast('Noch kein Protokoll vorhanden'); };
}

// ---------- Update-Fenster ----------
function renderUpdate() {
  const pop = $('updatePop');
  const show = ['available', 'downloading', 'ready', 'installing'].includes(upd.status) && updDismissed !== upd.version && upd.version;
  if (show) {
    $('upTitle').textContent = upd.status === 'installing' ? 'Wird installiert …' : `Neue Version ${upd.version}`;
    $('upNotes').textContent = upd.notes || 'Verbesserungen und Fehlerbehebungen.';
    $('upProgress').classList.toggle('hidden', upd.status !== 'downloading');
    $('upBar').style.width = (upd.progress || 0) + '%';
    $('upHint').textContent = upd.status === 'downloading' ? `Lädt … ${upd.progress || 0} %` : upd.status === 'installing' ? 'Der Browser startet gleich neu – Tabs und Daten bleiben erhalten.' : 'Lädt, installiert und startet neu – ohne weitere Fragen.';
    $('upInstall').disabled = upd.status === 'installing';
    $('upInstall').textContent = upd.status === 'installing' ? 'Wird installiert …' : 'Update jetzt installieren';
  }
  if (show && pop.classList.contains('hidden')) { pop.classList.remove('hidden'); overlayOpen = true; pushLayout(); }
  if (!show && !pop.classList.contains('hidden')) { pop.classList.add('hidden'); overlayOpen = false; pushLayout(); }
  $('menuBtn').classList.toggle('on', ['available', 'ready', 'downloading'].includes(upd.status));
  if (panel === 'settings' && setTab === 'updates') setUpdates();
}
$('upInstall').onclick = () => { api.updateNow(); upd = { ...upd, status: upd.status === 'ready' ? 'installing' : 'downloading' }; renderUpdate(); };
$('upLater').onclick = () => { updDismissed = upd.version; renderUpdate(); toast('Später: Einstellungen → Updates'); };

// ---------- Schnellbefehle (Strg/⌘+K) ----------
let palItems = [], palSel = 0;
function palCommands() {
  const t = activeTab();
  return [
    ['Neuer Tab', () => api.newTab()], ['KI-Assistent', () => openPanel('ai')], ['Seite zusammenfassen (KI)', () => aiAsk('Fasse diese Seite in 5 Stichpunkten zusammen.', { usePage: true })],
    ['Kurzfassung (ohne KI)', () => openPanel('summary')], ['Seite übersetzen', () => api.translate()], ['Seite vorlesen', () => tts()],
    ['Geteilte Ansicht', () => api.split()], ['Alle Tabs', () => openPanel('tabs')], ['Verlauf', () => openPanel('history')], ['Lesezeichen', () => openPanel('bookmarks')],
    ['Downloads', () => openPanel('downloads')], ['Passwörter', () => openPanel('passwords')], ['Datenschutz-Center', () => openPanel('privacy')], ['Einstellungen', () => openPanel('settings')],
    ['Merkliste & Vergleich', () => openPanel('watch')], ['PDF öffnen & unterschreiben', () => api.openPDF()], ['Bildschirmfoto der Seite', () => takeShot()],
    ['Link ohne Tracking kopieren', async () => toast((await api.copyCleanLink()) ? 'Link kopiert' : 'Kein Link')], ['Geschlossenen Tab wieder öffnen', () => api.reopenTab()],
    ['Tabs links/oben umschalten', async () => { await setS({ tabLayout: vertical() ? 'horizontal' : 'vertical' }); renderAll(); }],
    ['Als Standardbrowser festlegen', () => api.makeDefaultBrowser()], ['Entwicklertools', () => api.devtools()], ['Drucken', () => api.print()], ['Nach Updates suchen', () => { openPanel('settings', 'updates'); api.checkUpdate(); }],
    ...(t && t.listing ? [['Immobilien-Check', () => openPanel('immo')]] : [])
  ].map(([label, run]) => ({ label, run, k: '›' }));
}
async function renderPalette() {
  const q = $('paletteInput').value.trim().toLowerCase();
  const cmds = palCommands().filter((c) => !q || c.label.toLowerCase().includes(q));
  const tabsL = state.tabs.filter((t) => q && (t.title + ' ' + t.url).toLowerCase().includes(q)).slice(0, 6).map((t) => ({ label: t.title, sub: hostOf(t.url), k: '⧉', run: () => api.selectTab(t.id) }));
  const bms = (settings.bookmarks || []).filter((b) => q && (b.title + ' ' + b.url).toLowerCase().includes(q)).slice(0, 5).map((b) => ({ label: b.title, sub: hostOf(b.url), k: '★', run: () => api.navigate(b.url) }));
  const hist = q.length > 1 ? (await api.historySearch({ q })).slice(0, 5).map((h) => ({ label: h.title || h.url, sub: hostOf(h.url), k: '🕘', run: () => api.navigate(h.url) })) : [];
  palItems = [...tabsL, ...cmds, ...bms, ...hist];
  if (q) palItems.push({ label: `Suchen: ${q}`, k: '⌕', run: () => api.navigate(q) });
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  $('paletteList').innerHTML = palItems.map((c, i) => `<div class="sg ${i === palSel ? 'sel' : ''}" data-i="${i}"><span class="k">${c.k}</span><b>${esc(c.label)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</div>`).join('');
  $('paletteList').querySelectorAll('.sg').forEach((el) => { el.onclick = () => runPalette(+el.dataset.i); });
}
function openPalette() { $('palette').classList.remove('hidden'); overlayOpen = true; pushLayout(); $('paletteInput').value = ''; palSel = 0; renderPalette(); $('paletteInput').focus(); }
function closePalette() { $('palette').classList.add('hidden'); overlayOpen = !$('updatePop').classList.contains('hidden') || !$('onboarding').classList.contains('hidden'); pushLayout(); }
function runPalette(i) { const c = palItems[i]; closePalette(); if (c) c.run(); }

async function takeShot() { const f = await api.screenshot(); toast(f ? `Bildschirmfoto in „${f}“ gespeichert` : 'Kein Bildschirmfoto möglich'); }

// ---------- Vorlesen (Sprachausgabe des Systems, offline) ----------
let ttsOn = false;
async function tts() {
  if (ttsOn) { speechSynthesis.cancel(); return; }
  const p = await api.pageText();
  if (!p || !p.text) return toast('Hier gibt es keinen Text zum Vorlesen');
  const text = (p.selection || p.text).slice(0, 30000);
  const lang = /^en/i.test(p.lang) ? 'en-US' : 'de-DE';
  const voice = speechSynthesis.getVoices().find((v) => v.lang === lang) || speechSynthesis.getVoices().find((v) => v.lang.startsWith(lang.slice(0, 2)));
  const chunks = text.match(/[^.!?\n]{1,220}[.!?\n]*/g) || [text];
  speechSynthesis.cancel();
  ttsOn = true; $('ttsBar').classList.remove('hidden'); $('ttsPause').textContent = 'Pause';
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c.trim()); u.lang = lang; if (voice) u.voice = voice; u.rate = 1.02;
    if (i === chunks.length - 1) u.onend = () => stopTts();
    speechSynthesis.speak(u);
  });
}
function stopTts() { speechSynthesis.cancel(); ttsOn = false; $('ttsBar').classList.add('hidden'); }
$('ttsPause').onclick = () => { if (speechSynthesis.paused) { speechSynthesis.resume(); $('ttsPause').textContent = 'Pause'; } else { speechSynthesis.pause(); $('ttsPause').textContent = 'Weiter'; } };
$('ttsStop').onclick = stopTts;

// ---------- Bedienelemente ----------
$('newtab').onclick = () => api.newTab();
$('sideNew').onclick = () => api.newTab();
$('sideCollapse').onclick = async () => { await setS({ sidebarCollapsed: !settings.sidebarCollapsed }); pushLayout(); };
$('back').onclick = () => api.nav('back');
$('forward').onclick = () => api.nav('forward');
$('reload').onclick = () => { const t = activeTab(); api.nav(t && t.loading ? 'stop' : 'reload'); };
$('menuBtn').onclick = () => api.menu();
$('aiBtn').onclick = () => togglePanel('ai');
$('dlBtn').onclick = () => togglePanel('downloads');
$('shield').onclick = () => togglePanel('privacy');
$('bookmarkBtn').onclick = () => bookmarkCurrent();
$('immoBtn').onclick = () => togglePanel('immo');
$('pdfSave').onclick = () => api.savePDF();
$('panelClose').onclick = closePanel;
$('keyBtn').onclick = async () => {
  const t = activeTab(); if (!t || !t.login) return;
  const id = t.login.length === 1 ? t.login[0].id : null;
  if (id) return (await api.pwFill(id)) || toast('Kein Anmeldefeld gefunden');
  openPanel('passwords'); pwQuery = hostOf(t.url).split('.').slice(-2).join('.'); renderPasswords();
};
$('pwSave').onclick = () => { const t = activeTab(); if (t) api.pwSave(t.id); };
$('pwNever').onclick = () => { const t = activeTab(); if (t) api.pwDismiss(t.id, true); };
$('pwNo').onclick = () => { const t = activeTab(); if (t) api.pwDismiss(t.id, false); };

$('addressForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('address').value.trim(); if (!v) return;
  if (!$('suggest').classList.contains('hidden') && sgItems[sgSel] && sgSel > 0) return runSuggest(sgSel);
  closeSuggest(); $('address').blur(); api.navigate(v);
};
$('address').oninput = () => { clearTimeout(sgTimer); sgTimer = setTimeout(updateSuggest, 70); };
$('address').onfocus = () => setTimeout(() => $('address').select(), 0);
$('address').onblur = () => setTimeout(() => { closeSuggest(); renderToolbar(); }, 120);
$('address').onkeydown = (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); }
  else if (e.key === 'Escape') { closeSuggest(); $('address').blur(); }
};
$('startSearch').onsubmit = (e) => { e.preventDefault(); const v = $('startInput').value.trim(); if (v) { api.navigate(v); $('startInput').value = ''; } };
$('startAI').onclick = () => { const v = $('startInput').value.trim(); if (!v) return openPanel('ai'); openPanel('ai'); setTimeout(() => aiAsk(v, { usePage: false }), 80); $('startInput').value = ''; };

$('findInput').oninput = () => { if ($('findInput').value) api.find($('findInput').value, true, false); else { $('findCount').textContent = ''; api.findStop(); } };
$('findInput').onkeydown = (e) => { if (e.key === 'Enter') api.find($('findInput').value, !e.shiftKey, true); if (e.key === 'Escape') closeFind(); };
$('findNext').onclick = () => api.find($('findInput').value, true, true);
$('findPrev').onclick = () => api.find($('findInput').value, false, true);
$('findClose').onclick = closeFind;

$('paletteInput').oninput = () => { palSel = 0; renderPalette(); };
$('paletteInput').onkeydown = (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); renderPalette(); }
  else if (e.key === 'Enter') runPalette(palSel);
  else if (e.key === 'Escape') closePalette();
};
$('palette').onclick = (e) => { if (e.target === $('palette')) closePalette(); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!$('palette').classList.contains('hidden')) closePalette(); else if (panel) closePanel(); }
});

// Ersteinrichtung
function showOnboarding(show) { $('onboarding').classList.toggle('hidden', !show); overlayOpen = show; pushLayout(); }
$('obChoose').onclick = async () => { const n = await api.chooseDownloadDir(); if (n) { settings._dlName = n; settings.downloadDir = n; showOnboarding(false); toast(`Downloads gehen nach „${n}“`); } };
$('obDefault').onclick = async () => { const n = await api.useDefaultDownloadDir(); settings._dlName = n; settings.downloadDir = n; showOnboarding(false); };

// ---------- Ereignisse vom Hauptprozess ----------
api.onTabs((s) => {
  const prevActive = state.activeId;
  state = s;
  renderWorkspaces(); renderTabs(); renderToolbar(); renderContent(); pushLayout();
  if (panel === 'immo' && prevActive !== s.activeId) { const t = activeTab(); if (!(t && t.listing)) closePanel(); }
  if (panel === 'tabs') renderTabsPanel();
});
api.onUpdate((s) => { upd = s; renderUpdate(); });
api.onVpn((s) => { vpnState = { ...vpnState, ...s }; renderShield(); renderStart(); renderContent(); if (panel === 'settings' && setTab === 'vpn') setVPN(); });
api.onBlocker((b) => { blockerInfo = b; if (b.stats) { settings.stats = b.stats; renderStart(); if (panel === 'privacy') renderPrivacy(); } });
api.onDownloads((d) => { downloads = d; $('dlBtn').classList.toggle('on', d.some((x) => x.state === 'progress' || x.state === 'scanning')); if (panel === 'downloads') renderDownloads(); });
api.onOnline((o) => { if (o !== online) { online = o; renderShield(); } });
api.onToast(toast);
api.onFavicons((m) => { favicons = m || {}; renderTabs(); renderBookmarkBar(); renderStart(); });
api.onFindOpen(openFind);
api.onFindResult((r) => { $('findCount').textContent = r.total ? `${r.active}/${r.total}` : 'Keine Treffer'; });
api.onFocusAddress(() => { $('address').focus(); $('address').select(); });
api.onOpenPanel((k) => (panel === k && k !== 'settings' ? closePanel() : openPanel(k)));
api.onPaletteOpen(openPalette);
api.onToggleBookmarkBar(async () => { await setS({ bookmarkBar: settings.bookmarkBar === false }); renderBookmarkBar(); });
api.onBookmarkCurrent(bookmarkCurrent);
api.onScreenshot(takeShot);
api.onTts(() => tts());

// ---------- Start ----------
(async () => {
  const s = await api.state();
  settings = s.settings; settings._dlName = s.downloadDirName;
  appVersion = s.version; platform = s.platform; upd = s.update || upd;
  vpnState = s.vpn; blockerInfo = s.blocker; countries = s.countries; dnsList = s.dns;
  aiInfo = s.ai; aiProviders = s.aiProviders; watchlist = s.watchlist; online = s.online;
  document.body.classList.toggle('mac', platform === 'darwin');
  favicons = s.favicons || {};
  renderStart(); renderBookmarkBar(); renderAll(); renderUpdate();
  if (!settings.downloadDir) showOnboarding(true);
  setInterval(renderStart, 60000);
})();
