/* Rechenkern Immobilien-Check – identisch zur iPhone-App. Läuft im Fenster und in Node (Tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmoCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Grunderwerbsteuer in % (Stand 2026)
  const LAENDER = {
    'Baden-Württemberg': 5.0, 'Bayern': 3.5, 'Berlin': 6.0, 'Brandenburg': 6.5,
    'Bremen': 5.5, 'Hamburg': 5.5, 'Hessen': 6.0, 'Mecklenburg-Vorpommern': 6.0,
    'Niedersachsen': 5.0, 'Nordrhein-Westfalen': 6.5, 'Rheinland-Pfalz': 5.0, 'Saarland': 6.5,
    'Sachsen': 5.5, 'Sachsen-Anhalt': 5.0, 'Schleswig-Holstein': 6.5, 'Thüringen': 5.0
  };

  /** Grobe Zuordnung PLZ → Bundesland (Grenzgebiete bitte prüfen) */
  function landFromZip(zip) {
    if (!zip || !/^\d{5}$/.test(zip)) return null;
    const p = parseInt(zip.slice(0, 2), 10);
    const r = (a, b) => p >= a && p <= b;
    if ([1, 2, 4, 8, 9].includes(p)) return 'Sachsen';
    if (p === 3 || r(14, 16)) return p === 14 ? 'Brandenburg' : 'Brandenburg';
    if (p === 6 || p === 39) return 'Sachsen-Anhalt';
    if (p === 7 || r(98, 99)) return 'Thüringen';
    if (r(10, 13)) return 'Berlin';
    if (r(17, 19)) return 'Mecklenburg-Vorpommern';
    if (r(20, 22)) return 'Hamburg';
    if (r(23, 25)) return 'Schleswig-Holstein';
    if (p === 28) return 'Bremen';
    if ([26, 27, 29, 30, 31, 37, 38, 49].includes(p)) return 'Niedersachsen';
    if ([32, 33, 57, 58, 59].includes(p) || r(40, 48) || r(50, 53)) return 'Nordrhein-Westfalen';
    if ([34, 35, 36].includes(p) || r(60, 65)) return 'Hessen';
    if ([54, 55, 56, 67].includes(p)) return 'Rheinland-Pfalz';
    if (p === 66) return 'Saarland';
    if (r(68, 79) || p === 88) return 'Baden-Württemberg';
    if (r(80, 87) || r(89, 97)) return 'Bayern';
    return null;
  }

  function calculate(i) {
    const price = +i.price || 0, area = +i.area || 0, rent = +i.coldRent || 0;
    const grestRate = LAENDER[i.land] ?? 6.0;
    const grest = price * grestRate / 100;
    const makler = price * (+i.makler || 0) / 100;
    const notar = price * (+i.notar || 0) / 100;
    const total = price + grest + makler + notar;
    const equity = +i.equity || 0;
    const loan = Math.max(0, total - equity);
    const zins = +i.zins || 0, tilgung = +i.tilgung || 0;
    const rate = loan * (zins + tilgung) / 100 / 12;
    const costs = +i.costs || 0;
    const yearRent = rent * 12;
    const hasRent = yearRent > 0 && price > 0;

    let rest = loan;
    const mz = zins / 100 / 12;
    for (let m = 0; m < 120 && rest > 0; m++) rest = Math.max(0, rest - (rate - rest * mz));

    return {
      grestRate, grest, makler, notar,
      nebenkosten: grest + makler + notar,
      total, loan, rate,
      restschuld10: rest,
      pricePerSqm: area > 0 && price > 0 ? price / area : null,
      brutto: hasRent ? yearRent / price * 100 : null,
      netto: hasRent ? (yearRent - costs * 12) / total * 100 : null,
      faktor: hasRent ? price / yearRent : null,
      cashflow: rent > 0 ? rent - rate - costs : null,
      ekQuote: total > 0 ? Math.min(100, equity / total * 100) : 0
    };
  }

  /** „349.000 €“, „85,5 m²“ → Zahl */
  function parseGerman(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v > 0 ? v : null;
    let t = String(v).replace(/[^\d.,]/g, '');
    if (!t) return null;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
    const n = parseFloat(t);
    return n > 0 ? n : null;
  }

  return { LAENDER, landFromZip, calculate, parseGerman };
});
