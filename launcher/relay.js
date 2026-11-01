// Native-Messaging-Weiterleitung (läuft als reines Node, ohne Fenster): Firefox ⇄ ImmoAdv-Programm.
// Grund: Ein Windows-Fensterprogramm (Electron) bekommt keine Standard-Eingabe. Firefox startet darum dieses kleine Skript;
// es reicht die Nachrichten 1:1 an das ImmoAdv-Programm weiter, das im Hintergrund läuft (wird bei Bedarf gestartet).
'use strict';
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const user = String(process.env.USERNAME || process.env.USER || os.userInfo().username || 'nutzer').replace(/[^\w.-]/g, '_');
const PIPE = process.platform === 'win32' ? `\\\\.\\pipe\\immoadv-browser-${user}` : path.join(os.tmpdir(), `immoadv-browser-${user}.sock`);

let started = false;
function startServer() {
  if (started) return; started = true;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const args = process.env.IMMOADV_APP_DIR ? [process.env.IMMOADV_APP_DIR, '--host-server'] : ['--host-server'];
  spawn(process.execPath, args, { detached: true, stdio: 'ignore', env, windowsHide: true }).unref();
}

function connect(tries = 0) {
  const sock = net.connect(PIPE);
  sock.once('connect', () => {
    process.stdin.pipe(sock);
    sock.pipe(process.stdout);
    process.stdin.on('end', () => sock.end());
    sock.on('close', () => process.exit(0));
  });
  sock.once('error', () => {
    sock.destroy();
    if (tries === 0) startServer();
    if (tries > 150) process.exit(1);                 // 30 Sekunden ohne Programm → aufgeben (Firefox verbindet später neu)
    setTimeout(() => connect(tries + 1), 200);
  });
}
process.stdin.pause();
connect();
