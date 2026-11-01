'use strict';
const p = new URLSearchParams(location.search);
const kind = p.get('k'), url = p.get('u') || '';
const T = {
  malware: ['Gefährliche Seite blockiert', 'Diese Adresse verbreitet laut aktueller Malware-Liste (URLhaus) Schadsoftware.'],
  phishing: ['Betrugsseite blockiert', 'Diese Seite gibt sich laut aktueller Phishing-Liste als eine andere aus, um Passwörter oder Bankdaten abzugreifen.'],
  eigene: ['Seite gesperrt', 'Diese Seite steht auf deiner eigenen Sperrliste (Einstellungen → Datenschutz).'],
  werbung: ['Seite blockiert', 'Diese Adresse gehört zu einem Werbe- oder Tracking-Netzwerk.']
}[kind] || ['Seite blockiert', ''];
document.getElementById('title').textContent = T[0];
document.getElementById('text').textContent = T[1];
document.getElementById('url').textContent = url;
document.title = T[0];
document.getElementById('back').onclick = () => (history.length > 2 ? history.go(-2) : (location.href = 'newtab.html'));
document.getElementById('open').onclick = async () => {
  if (!/^https?:\/\//.test(url)) return;
  await browser.runtime.sendMessage({ type: 'blocked:allow', url });
  location.replace(url);
};
