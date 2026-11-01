const bar = document.getElementById('bar'), step = document.getElementById('step'), retry = document.getElementById('retry');
document.getElementById('logo').onerror = function () { this.style.display = 'none'; };
window.immo.onProgress((d) => {
  retry.classList.add('hidden');
  if (d.step === 'download') { bar.style.width = Math.max(3, Math.round((d.p || 0) * 0.8)) + '%'; step.textContent = `Lädt von Mozilla … ${d.p || 0} %`; }
  else if (d.step === 'verify') { bar.style.width = '82%'; step.textContent = 'Prüft die Signatur von Mozilla …'; }
  else if (d.step === 'install') { bar.style.width = '90%'; step.textContent = 'Richtet ein …'; }
  else if (d.step === 'done') { bar.style.width = '100%'; step.textContent = 'Fertig – der Browser öffnet sich.'; }
  else if (d.step === 'error') { step.textContent = 'Hat nicht geklappt: ' + (d.message || 'unbekannter Fehler') + ' – bitte Internetverbindung prüfen.'; retry.classList.remove('hidden'); }
});
retry.onclick = () => { retry.classList.add('hidden'); step.textContent = 'Startet …'; bar.style.width = '3%'; window.immo.retry(); };
