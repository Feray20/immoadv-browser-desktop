/* Immobilien-Werkzeuge: Immobilien-Check (Rechner + PDF), Kurzfassung, Merkliste. Nutzt Hilfen aus app.js. */
'use strict';
// Immobilien-Check
function renderImmo() {
  const t = activeTab(); const l = t?.listing || {};
  $('panelTitle').textContent = 'Immobilien-Check';
  const isRent = l.isRent;
  const price = isRent ? 0 : C.parseGerman(l.price) || 0;
  const rent = C.parseGerman(isRent ? (l.rent || l.price) : l.rent) || 0;
  const land = C.landFromZip(l.zip) || 'Hessen';
  const opts = Object.keys(C.LAENDER).map((k) => `<option ${k === land ? 'selected' : ''} value="${esc(k)}">${esc(k)} (${C.LAENDER[k].toLocaleString('de-DE')} %)</option>`).join('');
  const field = (id, label, val, step = 'any') => `<div class="row"><span>${label}</span><input type="number" id="${id}" value="${val}" step="${step}" min="0"></div>`;
  $('panelBody').innerHTML = `
    <p><b>${esc(l.title || t?.title || 'Inserat')}</b><br><span class="hint">${esc([l.zip, l.city, l.source].filter(Boolean).join(' · '))}</span></p>
    <div class="group"><h3>Objekt</h3>
      ${field('iPrice', 'Kaufpreis (€)', price)}
      ${field('iArea', 'Wohnfläche (m²)', C.parseGerman(l.area) || 0)}
      ${field('iRent', 'Kaltmiete / Monat (€)', rent)}
      <div class="row"><span>Bundesland</span><select id="iLand">${opts}</select></div>
    </div>
    <div class="group"><h3>Finanzierung</h3>
      ${field('iEquity', 'Eigenkapital (€)', Math.round(price * 0.2))}
      ${field('iZins', 'Zins % p. a.', 3.6)}
      ${field('iTilg', 'Tilgung % p. a.', 2.0)}
      ${field('iMakler', 'Makler %', 3.57)}
      ${field('iNotar', 'Notar + Grundbuch %', 2.0)}
      ${field('iCosts', 'Nicht umlagef. Kosten / Monat (€)', 0)}
    </div>
    <div class="group" id="iResult"></div>
    <button class="primary" id="iSave">Als PDF speichern</button>
    <button class="secondary" id="iWatch">♡ Auf die Merkliste</button>
    <p class="hint">Unverbindliche Beispielrechnung, keine Finanzierungs- oder Steuerberatung. Alles wird nur auf diesem Computer berechnet.</p>`;
  $('panelBody').querySelectorAll('input,select').forEach((el) => el.addEventListener('input', updateImmo));
  $('iSave').onclick = saveImmo;
  $('iWatch').onclick = async () => {
    const i = immoInput(); const r = C.calculate(i);
    watchlist = await api.watchAdd({ url: t?.url || '', title: l.title || t?.title || 'Inserat', city: [l.zip, l.city].filter(Boolean).join(' '), source: l.source || '',
      price: i.price, area: i.area, rent: i.coldRent, land: i.land, total: r.total, sqm: r.pricePerSqm, brutto: r.brutto, cashflow: r.cashflow, rate: r.rate });
    toast('Auf der Merkliste – Vergleich unter ⋯ → Merkliste');
  };
  updateImmo();
}

function immoInput() {
  const n = (id) => parseFloat($(id).value) || 0;
  return { price: n('iPrice'), area: n('iArea'), coldRent: n('iRent'), land: $('iLand').value, equity: n('iEquity'),
    zins: n('iZins'), tilgung: n('iTilg'), makler: n('iMakler'), notar: n('iNotar'), costs: n('iCosts') };
}

function resultRows(r) {
  const rows = [
    ['Grunderwerbsteuer', eur(r.grest)], ['Makler', eur(r.makler)], ['Notar + Grundbuch', eur(r.notar)],
    ['Kaufnebenkosten gesamt', eur(r.nebenkosten), true], ['Gesamtkosten', eur(r.total), true],
    ['Darlehen', eur(r.loan)], ['Monatsrate', eur(r.rate, 2), true], ['Restschuld nach 10 Jahren', eur(r.restschuld10)],
    ['Eigenkapitalquote', pct(r.ekQuote)]
  ];
  if (r.pricePerSqm) rows.push(['Preis pro m²', eur(r.pricePerSqm)]);
  if (r.brutto != null) rows.push(['Bruttomietrendite', pct(r.brutto)]);
  if (r.netto != null) rows.push(['Nettomietrendite', pct(r.netto)]);
  if (r.faktor != null) rows.push(['Kaufpreisfaktor', r.faktor.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + '-fach']);
  if (r.cashflow != null) rows.push(['Cashflow / Monat', eur(r.cashflow, 2), true, r.cashflow >= 0 ? 'pos' : 'neg']);
  return rows;
}

function updateImmo() {
  const r = C.calculate(immoInput());
  $('iResult').innerHTML = '<h3>Ergebnis</h3>' + resultRows(r).map(([k, v, bold, cls]) =>
    `<div class="row"><span>${k}</span>${bold ? `<b class="${cls || ''}">${v}</b>` : `<span>${v}</span>`}</div>`).join('');
}

async function saveImmo() {
  const t = activeTab(); const l = t?.listing || {};
  const i = immoInput(); const r = C.calculate(i);
  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const rows = resultRows(r).map(([k, v, b]) => `<tr><td>${k}</td><td style="text-align:right;${b ? 'font-weight:700' : ''}">${v}</td></tr>`).join('');
  const html = `<!doctype html><html lang="de"><meta charset="utf-8"><style>
    body{font-family:-apple-system,Segoe UI,Arial,sans-serif;margin:0;color:#0f1b2d}
    header{background:linear-gradient(120deg,#0B1F3A,#2A5BD7 58%,#19C2B0);color:#fff;padding:28px 40px}
    h1{margin:0;font-size:24px} main{padding:24px 40px} table{width:100%;border-collapse:collapse;font-size:13px}
    td{padding:7px 0;border-bottom:1px solid #e4e8ef} h2{color:#2A5BD7;font-size:15px;margin:22px 0 6px}
    footer{position:fixed;bottom:18px;left:40px;right:40px;font-size:9px;color:#888}</style>
    <header><h1>ImmoAdv · Immobilien-Check</h1><div>${esc(today)}</div></header><main>
    <p><b>${esc(l.title || t?.title || 'Inserat')}</b><br><small>${esc([l.zip, l.city, l.source].filter(Boolean).join(' · '))}</small></p>
    <h2>Eingaben</h2><table>
      <tr><td>Kaufpreis</td><td style="text-align:right">${eur(i.price)}</td></tr>
      <tr><td>Wohnfläche</td><td style="text-align:right">${i.area.toLocaleString('de-DE')} m²</td></tr>
      <tr><td>Kaltmiete / Monat</td><td style="text-align:right">${eur(i.coldRent, 2)}</td></tr>
      <tr><td>Bundesland</td><td style="text-align:right">${esc(i.land)} (${r.grestRate.toLocaleString('de-DE')} % GrESt)</td></tr>
      <tr><td>Eigenkapital</td><td style="text-align:right">${eur(i.equity)}</td></tr>
      <tr><td>Zins / Tilgung</td><td style="text-align:right">${pct(i.zins)} / ${pct(i.tilgung)}</td></tr>
    </table><h2>Ergebnis</h2><table>${rows}</table></main>
    <footer>Unverbindliche Beispielrechnung, keine Finanzierungs- oder Steuerberatung. immoadv.de</footer></html>`;
  const name = `Immobilien-Check ${new Date().toISOString().slice(0, 10)}.pdf`;
  try { const folder = await api.saveReport(html, name); toast(`In „${folder}“ gespeichert`); }
  catch { toast('Speichern fehlgeschlagen'); }
}

// ---------- Kurzfassung (lokal) ----------
async function renderSummary() {
  const t = activeTab();
  $('panelTitle').textContent = 'Kurzfassung';
  if (!t || t.kind !== 'web' || !t.url) { $('panelBody').innerHTML = '<p class="hint">Öffne zuerst eine Webseite.</p>'; return; }
  $('panelBody').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton short"></div>';
  const s = await api.summary();
  if (panel !== 'summary') return;
  if (!s || !s.points.length) { $('panelBody').innerHTML = '<p class="hint">Auf dieser Seite gibt es nicht genug Fließtext für eine Kurzfassung.</p>'; return; }
  const l = t.listing;
  const facts = l ? `<div class="group"><h3>Eckdaten</h3>${[
    ['Kaufpreis', l.isRent ? null : l.price], ['Miete', l.rent || (l.isRent ? l.price : null)], ['Wohnfläche', l.area ? l.area + ' m²' : null],
    ['Zimmer', l.rooms], ['Ort', [l.zip, l.city].filter(Boolean).join(' ')]].filter(([, v]) => v)
    .map(([k, v]) => `<div class="row"><span>${k}</span><b>${esc(String(v))}</b></div>`).join('')}</div>` : '';
  $('panelBody').innerHTML = `
    <p><b>${esc(s.title || t.title)}</b><br><span class="hint">${s.words.toLocaleString('de-DE')} Wörter · ca. ${s.minutes} Min. Lesezeit → hier in 30 Sekunden</span></p>
    ${facts}
    <div class="group"><h3>Das Wichtigste</h3><ul class="points">${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
    <button class="secondary" id="sumCopy">Kurzfassung kopieren</button>
    <p class="hint">Wird nur auf diesem Computer erstellt – kein Text verlässt den Browser.</p>`;
  $('sumCopy').onclick = () => { navigator.clipboard.writeText(s.points.map((p) => '• ' + p).join('\n')).then(() => toast('Kopiert')); };
}

// ---------- Merkliste & Vergleich ----------
function renderWatch() {
  $('panelTitle').textContent = 'Merkliste';
  if (!watchlist.length) {
    $('panelBody').innerHTML = '<p class="hint">Noch leer. Öffne ein Inserat → „Immobilien-Check“ → „♡ Auf die Merkliste“. Hier kannst du dann bis zu 50 Objekte nebeneinander vergleichen.</p>';
    return;
  }
  const best = (key, low) => { const v = watchlist.map((w) => w[key]).filter((x) => x != null && x !== 0); return v.length > 1 ? (low ? Math.min(...v) : Math.max(...v)) : null; };
  const bSqm = best('sqm', true), bBrutto = best('brutto'), bCash = best('cashflow');
  $('panelBody').innerHTML = watchlist.map((w) => `
    <div class="watch">
      <div class="watch-head"><a href="#" data-url="${esc(w.url)}">${esc(w.title)}</a><button class="icon" data-del="${esc(w.id)}" title="Entfernen">✕</button></div>
      <div class="hint">${esc([w.city, w.source].filter(Boolean).join(' · '))}</div>
      <div class="kpis">
        <div><span>Preis</span><b>${w.price ? eur(w.price) : '–'}</b></div>
        <div class="${w.sqm && w.sqm === bSqm ? 'best' : ''}"><span>€/m²</span><b>${w.sqm ? eur(w.sqm) : '–'}</b></div>
        <div class="${w.brutto && w.brutto === bBrutto ? 'best' : ''}"><span>Rendite</span><b>${w.brutto != null ? pct(w.brutto) : '–'}</b></div>
        <div class="${w.cashflow != null && w.cashflow === bCash ? 'best' : ''}"><span>Cashflow</span><b class="${w.cashflow == null ? '' : w.cashflow >= 0 ? 'pos' : 'neg'}">${w.cashflow != null ? eur(w.cashflow) : '–'}</b></div>
      </div>
    </div>`).join('') + '<p class="hint">Grün = bester Wert der Liste. Gespeichert nur auf diesem Computer.</p>';
  $('panelBody').querySelectorAll('[data-url]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); if (a.dataset.url) api.newTab(a.dataset.url); }; });
  $('panelBody').querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { watchlist = await api.watchRemove(b.dataset.del); renderWatch(); }; });
}
