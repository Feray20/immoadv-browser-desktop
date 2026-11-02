// Upload-Verlauf – gemeinsame Regeln (Hintergrund, Verlaufsseite, Tests): Adresse bereinigen, Portal und Arbeitgeber
// erkennen, Datensatz bauen. Gleiche Regeln wie im iPhone-Browser (UploadHistory.swift).
'use strict';
(function (root) {
  // Abfrage-Teile, die nie gespeichert werden (Anmeldung, Sitzungen, Tracking, persönliche Daten)
  const SENSITIVE = /(token|auth|session|sid$|^sid|key|code|sig|signature|secret|pass|pwd|jwt|state|nonce|mail|phone|tel|ticket|otp|access|refresh|hash|login|user|cookie|^utm_|fbclid|gclid|msclkid|_ga|mc_eid)/i;
  const RANDOMISH = /^[A-Za-z0-9_\-+/=.%]{32,}$/;

  /** Adresse ohne Anmelde-/Sitzungs-/Tracking-Teile und ohne #-Teil. Bei Zweifel nur Origin + Pfad. */
  function cleanUrl(raw) {
    let u;
    try { u = new URL(String(raw || '')); } catch (e) { return ''; }
    if (!/^https?:$/.test(u.protocol)) return '';
    u.username = ''; u.password = ''; u.hash = '';
    const keep = new URLSearchParams();
    let doubt = false;
    for (const [k, v] of u.searchParams) {
      if (SENSITIVE.test(k)) continue;
      if (RANDOMISH.test(v) || /@/.test(v)) { doubt = true; continue; }
      keep.append(k, v.slice(0, 200));
    }
    u.search = doubt && keep.toString().length > 300 ? '' : keep.toString();
    // Pfad-Teile, die wie Zugangsschlüssel aussehen (lange Zufallsketten), weglassen
    const path = u.pathname.split('/').map((p) => (p.length >= 40 && RANDOMISH.test(p) ? '…' : p)).join('/');
    return (u.origin + path + (u.search ? u.search : '')).slice(0, 1000);
  }

  const host = (raw) => { try { return new URL(String(raw)).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; } };
  const nice = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 80);
  const SKIP_SUB = /^(www|jobs|karriere|career|careers|apply|bewerbung|portal|app|m|de|en|wd\d*)$/i;

  // Portale: [Name, Domain-Muster, Arbeitgeber aus der Adresse (nur wenn eindeutig)]
  const PORTALS = [
    ['StepStone', /(^|\.)stepstone\.(de|at|ch|com|nl|be|fr)$/],
    ['Indeed', /(^|\.)indeed\.(com|de|at|ch)$/],
    ['LinkedIn', /(^|\.)linkedin\.com$/],
    ['XING', /(^|\.)xing\.com$/],
    ['Bundesagentur für Arbeit', /(^|\.)arbeitsagentur\.de$/],
    ['Personio', /\.jobs\.personio\.(de|com)$/, (h) => h.split('.')[0]],
    ['Workday', /\.myworkday(jobs|site)\.com$/, (h) => h.split('.')[0]],
    ['softgarden', /\.softgarden\.(io|de)$/, (h) => h.split('.')[0]],
    ['SuccessFactors', /(^|\.)successfactors\.(com|eu)$|(^|\.)sapsf\.(com|eu)$/],
    ['SmartRecruiters', /(^|\.)smartrecruiters\.com$/, (h, p) => (p[0] && h.startsWith('jobs.') ? p[0] : '')],
    ['Greenhouse', /(^|\.)greenhouse\.io$/, (h, p) => (p[0] && /^(boards|job-boards)\./.test(h) ? p[0] : '')],
    ['Lever', /(^|\.)lever\.co$/, (h, p) => (p[0] && h.startsWith('jobs.') ? p[0] : '')],
    ['JOIN', /(^|\.)join\.com$/, (h, p) => (p[0] === 'companies' && p[1] ? p[1] : '')],
    ['d.vinci', /\.dvinci-hr\.com$|\.dvinci\.de$/, (h) => h.split('.')[0]],
    ['rexx', /\.rexx-systems\.com$/, (h) => h.split('.')[0]],
    ['Recruitee', /\.recruitee\.com$/, (h) => h.split('.')[0]],
    ['Teamtailor', /\.teamtailor\.com$/, (h) => h.split('.')[0]],
    ['BITE', /\.b-ite\.(de|net)$/],
    ['Kleinanzeigen', /(^|\.)kleinanzeigen\.de$/],
    ['ImmoScout24', /(^|\.)immobilienscout24\.de$/],
    ['ImmoAdv', /(^|\.)immoadv\.de$/]
  ];

  /** { portal, employer } – Arbeitgeber nur, wenn die Adresse ihn eindeutig nennt (nie geraten). */
  function detect(rawUrl) {
    const h = host(rawUrl);
    let parts = [];
    try { parts = new URL(String(rawUrl)).pathname.split('/').filter(Boolean); } catch (e) { /* leer */ }
    for (const [name, re, emp] of PORTALS) {
      if (!re.test(h)) continue;
      const e = emp ? emp(h, parts) : '';
      return { portal: name, employer: e && !SKIP_SUB.test(e) ? nice(decodeURIComponentSafe(e)) : '' };
    }
    // Eigene Karriereseite einer Firma (karriere.firma.de, firma.de/karriere): Portal = Domain, Arbeitgeber bleibt offen
    return { portal: h, employer: '' };
  }
  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  // Dokumenttyp (lokal, nur aus dem Dateinamen) – immer als Vermutung gekennzeichnet, nie aus dem Inhalt
  const DOC_TYPES = [
    ['Lebenslauf', /(lebenslauf|curriculum|\bcv\b|(^|[_\-\s.])cv([_\-\s.]|$)|resume|résumé|vita\b)/i],
    ['Anschreiben', /(anschreiben|motivationsschreiben|cover[_\-\s]?letter|bewerbungsschreiben)/i],
    ['Arbeitszeugnis', /(arbeitszeugnis|zwischenzeugnis|dienstzeugnis|referenz)/i],
    ['Ausbildungszeugnis', /(ausbildungszeugnis|abschlusszeugnis|schulzeugnis|abitur|gesellenbrief|ihk[_\-\s]?zeugnis|zeugnis)/i],
    ['Zertifikat', /(zertifikat|certificate|nachweis|bescheinigung|führerschein|fuehrerschein|schein\b|diplom|urkunde)/i],
    ['Bewerbung', /(bewerbung|application|unterlagen)/i],
    ['Vertrag', /(vertrag|contract|vereinbarung)/i],
    ['Rechnung', /(rechnung|invoice|quittung|beleg)/i]
  ];
  function docType(name) {
    const n = String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '');
    for (const [t, re] of DOC_TYPES) if (re.test(n)) return t;
    return 'Sonstiges';
  }
  const DOC_TYPE_NAMES = DOC_TYPES.map((x) => x[0]).concat('Sonstiges');

  const STATUS = ['SELECTED', 'TRANSFER_STARTED', 'TRANSFER_COMPLETED', 'SERVER_ACKNOWLEDGED', 'FAILED', 'UNKNOWN'];
  const STATUS_DE = {
    SELECTED: 'Ausgewählt', TRANSFER_STARTED: 'Übertragung gestartet', TRANSFER_COMPLETED: 'Übertragen',
    SERVER_ACKNOWLEDGED: 'Vom Portal bestätigt', FAILED: 'Fehlgeschlagen', UNKNOWN: 'Unbekannt'
  };
  // Status darf nur „vorwärts“ gehen (FAILED kann TRANSFER_STARTED ablösen, nie einen bestätigten Stand)
  const RANK = { UNKNOWN: 0, SELECTED: 1, TRANSFER_STARTED: 2, FAILED: 3, TRANSFER_COMPLETED: 4, SERVER_ACKNOWLEDGED: 5 };
  const better = (a, b) => ((RANK[b] || 0) > (RANK[a] || 0) ? b : a);

  /** Datensatz (gleiche Felder auf allen Geräten). */
  function record({ id, file, pageUrl, pageTitle, at, device, deviceName, platform }) {
    const d = detect(pageUrl);
    return {
      id: String(id),
      name: String(file.name || 'Datei').slice(0, 260),
      size: Math.max(0, Number(file.size) || 0),
      mime: String(file.mime || '').slice(0, 120),
      sha256: /^[0-9a-f]{64}$/.test(file.sha256) ? file.sha256 : '',
      pages: Number.isInteger(file.pages) && file.pages > 0 ? file.pages : null,
      docType: docType(file.name),
      at: Number(at) || Date.now(),
      tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })(),
      domain: host(pageUrl),
      url: cleanUrl(pageUrl),
      title: String(pageTitle || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      portal: d.portal,
      employer: d.employer,
      platform: String(platform || ''),
      device: String(device || ''),
      deviceName: String(deviceName || '').slice(0, 80),
      status: 'SELECTED',
      transport: ''
    };
  }

  const api = { cleanUrl, detect, record, host, docType, DOC_TYPE_NAMES, STATUS, STATUS_DE, RANK, better };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ImmoUploads = api;
})(typeof self !== 'undefined' ? self : globalThis);
