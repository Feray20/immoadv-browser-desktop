// Läuft vor jedem Seiten-Skript (auch in Frames). Kein Zugriff auf Node oder die App.
const { contextBridge } = require('electron');

contextBridge.executeInMainWorld({
  func: () => {
    try {
      // WebRTC aus – verhindert IP-Lecks an Tor vorbei
      ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'].forEach((k) => {
        try { Object.defineProperty(window, k, { value: undefined, configurable: false }); } catch (e) {}
      });
      try { delete Navigator.prototype.getBattery; } catch (e) {}
      // einheitliche Werte gegen Fingerabdrücke
      const fixed = { hardwareConcurrency: 4, deviceMemory: 8, doNotTrack: '1' };
      Object.keys(fixed).forEach((k) => {
        try { Object.defineProperty(Navigator.prototype, k, { get: () => fixed[k] }); } catch (e) {}
      });
      // Zeitzone neutral (UTC) wie im Tor Browser
      Date.prototype.getTimezoneOffset = function () { return 0; };
      const R = Intl.DateTimeFormat;
      const F = function (l, o) { o = Object.assign({}, o || {}); if (!o.timeZone) o.timeZone = 'UTC'; return new R(l, o); };
      F.prototype = R.prototype; F.supportedLocalesOf = R.supportedLocalesOf;
      Intl.DateTimeFormat = F;
    } catch (e) {}
  }
});

// Schneller laden: beim Zeigen auf einen Link zu einer anderen Seite wird die Verbindung schon vorbereitet
// (nur Verbindungsaufbau über Tor, die Seite selbst wird erst beim Klick geladen)
if (window.top === window) {
  const { ipcRenderer } = require('electron');
  const seen = new Set();
  const hover = (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    let u; try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (!/^https?:$/.test(u.protocol) || u.origin === location.origin || seen.has(u.origin) || seen.size > 40) return;
    seen.add(u.origin);
    ipcRenderer.send('preconnect', u.origin);
  };
  window.addEventListener('mouseover', hover, { capture: true, passive: true });
}
