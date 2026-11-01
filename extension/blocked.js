// Warnseite für Malware-, Phishing- und selbst gesperrte Seiten
const kind = location.hash.slice(1);
const TEXT = {
  malware: ['Gefährliche Seite blockiert', 'Diese Adresse steht auf einer Liste bekannter Schadsoftware-Seiten (URLhaus). Sie könnte versuchen, Viren oder Erpressungssoftware auf deinen Computer zu laden.'],
  phishing: ['Betrugsverdacht – Seite blockiert', 'Diese Adresse ist als Phishing-Seite bekannt. Solche Seiten imitieren Banken, Shops oder Logins, um Passwörter und Zahlungsdaten zu stehlen.'],
  eigene: ['Seite gesperrt', 'Du hast diese Seite im ImmoAdv Datenschutz-Center auf die Sperrliste gesetzt.']
};
const [h, why] = TEXT[kind] || TEXT.malware;
document.getElementById('h').textContent = h;
document.getElementById('why').textContent = why;
if (kind === 'eigene') document.getElementById('proceed').textContent = 'Nur dieses Mal öffnen';

let target = null;
chrome.runtime.sendMessage({ type: 'blocked-info' }, (r) => {
  target = r && r.url;
  document.getElementById('url').textContent = target || 'Adresse unbekannt';
  if (!target) document.getElementById('proceed').classList.add('hidden');
});

document.getElementById('back').addEventListener('click', () => {
  if (history.length > 2) history.go(-2); else location.href = 'chrome://newtab';
});
document.getElementById('proceed').addEventListener('click', () => {
  if (!target) return;
  if (!confirm('Wirklich öffnen? Die Seite bleibt bis zum Schließen von Chrome erlaubt.')) return;
  chrome.runtime.sendMessage({ type: 'allow-once', url: target }, (r) => { if (r && r.ok) location.replace(target); });
});
