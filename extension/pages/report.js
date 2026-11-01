'use strict';
browser.storage.local.get('report').then(({ report }) => {
  if (!report) return;
  document.title = report.name;
  // Inhalt stammt aus dem eigenen Immobilien-Check (alle Werte dort bereits maskiert)
  document.getElementById('r').innerHTML = report.html;
});
