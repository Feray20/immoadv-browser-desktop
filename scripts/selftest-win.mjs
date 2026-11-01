// Prüf-Build Windows: 1) Native-Messaging-Gegenstelle antwortet (ping, Einstellungen)  2) Motor-Selbsttest (Download, Signatur, Einrichten, Start)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const exe = path.resolve('dist/win-unpacked/ImmoAdv Browser.exe');
const out = [];
const note = (m) => { out.push(m); console.log(m); };
const frame = (o) => { const b = Buffer.from(JSON.stringify(o)); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); return Buffer.concat([h, b]); };

note('--- Selbsttest Motor');
const r = spawnSync(exe, ['--selbsttest'], { timeout: 15 * 60 * 1000, encoding: 'utf8' });
note('Exit ' + r.status);
const ud = path.join(process.env.APPDATA, 'ImmoAdv Browser');
try { note(fs.readFileSync(path.join(ud, 'selbsttest.txt'), 'utf8')); } catch (e) { note('kein selbsttest.txt: ' + e.message); }
try { note(fs.readFileSync(path.join(ud, 'motor.log'), 'utf8').slice(-2000)); } catch {}
note('--- Gegenstelle');
await new Promise((resolve) => {
  // wie Firefox: das angemeldete Startskript (Weiterleitung → Hintergrund-Dienst)
  const bat = path.join(process.env.APPDATA, 'ImmoAdv Browser', 'native-host.bat');
  note('Startskript: ' + (fs.existsSync(bat) ? fs.readFileSync(bat, 'utf8') : 'fehlt'));
  const p = spawn('cmd.exe', ['/d', '/c', bat, path.join(os.tmpdir(), 'native-host.json'), 'browser@immoadv.de'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = Buffer.alloc(0); const got = [];
  const t = setTimeout(() => { note('Host: Zeitüberschreitung, Antworten: ' + got.length); p.kill(); resolve(); }, 45000);
  p.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4) { const n = buf.readUInt32LE(0); if (buf.length < 4 + n) break; const m = JSON.parse(buf.subarray(4, 4 + n)); buf = buf.subarray(4 + n); if (m.id) { got.push(m); note('Host-Antwort ' + JSON.stringify(m).slice(0, 300)); } }
    if (got.length >= 3) { clearTimeout(t); p.stdin.end(); setTimeout(() => { p.kill(); resolve(); }, 3000); }
  });
  p.stderr.on('data', (d) => note('Host-stderr ' + String(d).slice(0, 300)));
  p.on('exit', (c) => note('Host beendet ' + c));
  p.stdin.write(frame({ id: '1', cmd: 'ping' }));
  p.stdin.write(frame({ id: '2', cmd: 'settings.get' }));
  p.stdin.write(frame({ id: '3', cmd: 'vpn.creds' }));
});

fs.mkdirSync('vorschau-win', { recursive: true });
fs.writeFileSync('vorschau-win/win-log.txt', out.join('\n'));
try { fs.copyFileSync(path.join(ud, 'selbsttest.png'), 'vorschau-win/win-selbsttest.png'); } catch {}
