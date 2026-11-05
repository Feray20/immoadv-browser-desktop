// Verbindung zum ImmoAdv-Programm auf dem Computer (Native Messaging).
// Darüber laufen alles, was eine Erweiterung allein nicht darf: Systemverschlüsselung (Windows Hello / Schlüsselbund),
// Updates installieren, Einstellungen des Motors schreiben, Daten aus Version 3 übernehmen.
'use strict';
const Native = (() => {
  const HOST = 'de.immoadv.browser';
  let port = null, seq = 0, ready = false;
  const waiting = new Map();
  const listeners = new Set();
  let retry = 0;

  function connect() {
    try { port = browser.runtime.connectNative(HOST); } catch (e) { port = null; schedule(); return; }
    port.onMessage.addListener((msg) => {
      ready = true; retry = 0;
      if (msg && msg.id && waiting.has(msg.id)) {
        const w = waiting.get(msg.id); waiting.delete(msg.id); clearTimeout(w.t);
        msg.ok ? w.resolve(msg.data) : w.reject(new Error(msg.error || 'Fehler'));
      } else if (msg && msg.event) listeners.forEach((fn) => { try { fn(msg.event, msg.data); } catch (e) { console.error(e); } });
    });
    port.onDisconnect.addListener(() => {
      const err = (port && port.error && port.error.message) || 'Programm nicht erreichbar';
      port = null; ready = false;
      for (const [, w] of waiting) { clearTimeout(w.t); w.reject(new Error(err)); }
      waiting.clear();
      schedule();
    });
  }
  function schedule() { setTimeout(connect, Math.min(30000, 1000 * Math.pow(2, retry++))); }

  /** Befehl an das Programm. timeout in ms (Windows Hello wartet auf die Person – darum großzügig). */
  function call(cmd, args = {}, timeout = 20000) {
    return new Promise((resolve, reject) => {
      if (!port) return reject(new Error('Das ImmoAdv-Programm ist nicht erreichbar – bitte den ImmoAdv Browser über sein Symbol starten.'));
      const id = String(++seq);
      const t = setTimeout(() => { waiting.delete(id); reject(new Error('Zeitüberschreitung')); }, timeout);
      waiting.set(id, { resolve, reject, t });
      port.postMessage({ id, cmd, ...args });
    });
  }
  // Verbindung neu aufbauen (05.11.2026): Hing das Programm (z. B. nach einem Update im Hintergrund), blieb die alte
  // Verbindung offen, aber nichts kam zurück – jeder Befehl lief erst nach 20 s in die Zeitüberschreitung.
  function reset() {
    const old = port; port = null; ready = false;
    for (const [, w] of waiting) { clearTimeout(w.t); w.reject(new Error('Neu verbunden')); }
    waiting.clear();
    try { if (old) old.disconnect(); } catch (e) { /* schon weg */ }
    retry = 0; connect();
    return call('ping', {}, 4000).then(() => true, () => false);
  }
  connect();
  return { call, reset, on: (fn) => listeners.add(fn), get connected() { return !!port && ready; } };
})();
