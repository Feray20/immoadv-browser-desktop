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
