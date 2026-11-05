'use strict';
// Immobilien-Check (wie Version 3): Eckdaten aus dem Inserat, Rechner, PDF – alles lokal berechnet (Merkliste entfernt 05.11.2026).
const C = window.ImmoCalc;
const $ = (id) => document.getElementById(id);
const send = (m) => browser.runtime.sendMessage(m);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (v, d = 0) => (v || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => (v || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %';
const params = new URLSearchParams(location.search);
if (params.get('full')) document.body.classList.add('full');
let tab = null, l = {};

function input() {
  const n = (id) => parseFloat($(id).value) || 0;
  return { price: n('iPrice'), area: n('iArea'), coldRent: n('iRent'), land: $('iLand').value, equity: n('iEquity'), zins: n('iZins'), tilgung: n('iTilg'), makler: n('iMakler'), notar: n('iNotar'), costs: n('iCosts') };
}
function resultRows(r) {
  const rows = [['Grunderwerbsteuer', eur(r.grest)], ['Makler', eur(r.makler)], ['Notar + Grundbuch', eur(r.notar)], ['Kaufnebenkosten gesamt', eur(r.nebenkosten), true], ['Gesamtkosten', eur(r.total), true],
    ['Darlehen', eur(r.loan)], ['Monatsrate', eur(r.rate, 2), true], ['Restschuld nach 10 Jahren', eur(r.restschuld10)], ['Eigenkapitalquote', pct(r.ekQuote)]];
  if (r.pricePerSqm) rows.push(['Preis pro m²', eur(r.pricePerSqm)]);
  if (r.brutto != null) rows.push(['Bruttomietrendite', pct(r.brutto)]);
  if (r.netto != null) rows.push(['Nettomietrendite', pct(r.netto)]);
  if (r.faktor != null) rows.push(['Kaufpreisfaktor', r.faktor.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + '-fach']);
  if (r.cashflow != null) rows.push(['Cashflow / Monat', eur(r.cashflow, 2), true, r.cashflow >= 0 ? 'pos' : 'neg']);
  return rows;
}
function update() {
  const r = C.calculate(input());
  $('iResult').innerHTML = '<h3>Ergebnis</h3>' + resultRows(r).map(([k, v, b, cls]) => `<div class="row"><span>${k}</span>${b ? `<b class="${cls || ''}">${v}</b>` : `<span>${v}</span>`}</div>`).join('');
}
function render() {
  const isRent = l.isRent;
  const price = isRent ? 0 : C.parseGerman(l.price) || 0;
  const rent = C.parseGerman(isRent ? (l.rent || l.price) : l.rent) || 0;
  const land = C.landFromZip(l.zip) || 'Hessen';
  const opts = Object.keys(C.LAENDER).map((k) => `<option ${k === land ? 'selected' : ''} value="${esc(k)}">${esc(k)} (${C.LAENDER[k].toLocaleString('de-DE')} %)</option>`).join('');
  const field = (id, label, val) => `<div class="row"><span>${label}</span><input type="number" id="${id}" value="${val}" step="any" min="0"></div>`;
  $('body').innerHTML = `<p class="title"><b>${esc(l.title || (tab && tab.title) || 'Inserat')}</b><br><span class="hint">${esc([l.zip, l.city, l.source].filter(Boolean).join(' · '))}</span></p>
    <div class="group"><h3>Objekt</h3>${field('iPrice', 'Kaufpreis (€)', price)}${field('iArea', 'Wohnfläche (m²)', C.parseGerman(l.area) || 0)}${field('iRent', 'Kaltmiete / Monat (€)', rent)}
      <div class="row"><span>Bundesland</span><select id="iLand">${opts}</select></div></div>
    <div class="group"><h3>Finanzierung</h3>${field('iEquity', 'Eigenkapital (€)', Math.round(price * 0.2))}${field('iZins', 'Zins % p. a.', 3.6)}${field('iTilg', 'Tilgung % p. a.', 2.0)}${field('iMakler', 'Makler %', 3.57)}${field('iNotar', 'Notar + Grundbuch %', 2.0)}${field('iCosts', 'Nicht umlagef. Kosten / Monat (€)', 0)}</div>
    <div class="group" id="iResult"></div>
    <button class="primary" id="iSave">Als PDF speichern</button>
    <p class="hint">Unverbindliche Beispielrechnung, keine Finanzierungs- oder Steuerberatung. Alles wird nur auf diesem Computer berechnet.</p>`;
  $('body').querySelectorAll('input,select').forEach((el) => el.addEventListener('input', update));
  $('iSave').onclick = save;
  update();
}
async function save() {
  const i = input(), r = C.calculate(i);
  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const rows = resultRows(r).map(([k, v, b]) => `<tr><td>${k}</td><td style="text-align:right;${b ? 'font-weight:700' : ''}">${v}</td></tr>`).join('');
  const html = `<header><h1>ImmoAdv · Immobilien-Check</h1><div>${esc(today)}</div></header><main>
    <p><b>${esc(l.title || (tab && tab.title) || 'Inserat')}</b><br><small>${esc([l.zip, l.city, l.source].filter(Boolean).join(' · '))}</small></p>
    <h2>Eingaben</h2><table><tr><td>Kaufpreis</td><td style="text-align:right">${eur(i.price)}</td></tr><tr><td>Wohnfläche</td><td style="text-align:right">${i.area.toLocaleString('de-DE')} m²</td></tr>
      <tr><td>Kaltmiete / Monat</td><td style="text-align:right">${eur(i.coldRent, 2)}</td></tr><tr><td>Bundesland</td><td style="text-align:right">${esc(i.land)} (${r.grestRate.toLocaleString('de-DE')} % GrESt)</td></tr>
      <tr><td>Eigenkapital</td><td style="text-align:right">${eur(i.equity)}</td></tr><tr><td>Zins / Tilgung</td><td style="text-align:right">${pct(i.zins)} / ${pct(i.tilgung)}</td></tr></table>
    <h2>Ergebnis</h2><table>${rows}</table></main><footer>Unverbindliche Beispielrechnung, keine Finanzierungs- oder Steuerberatung. immoadv.de</footer>`;
  await browser.storage.local.set({ report: { html, name: `Immobilien-Check ${new Date().toISOString().slice(0, 10)}` } });
  const t = await browser.tabs.create({ url: browser.runtime.getURL('pages/report.html'), active: true });
  setTimeout(() => browser.tabs.saveAsPDF({ toFileName: `Immobilien-Check ${new Date().toISOString().slice(0, 10)}.pdf`, shrinkToFit: true, headerLeft: '', headerRight: '', footerLeft: '', footerRight: '', showBackgroundColors: true }).catch(() => {}), 600);
  if (!params.get('full')) window.close();
}
(async () => {
  const id = Number(params.get('tab'));
  tab = id ? await browser.tabs.get(id).catch(() => null) : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab && /^https?:/.test(tab.url)) l = (await send({ type: 'page:listing', tabId: tab.id })) || {};
  render();
})();
