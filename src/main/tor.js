// Startet das mitgelieferte Tor (inkl. Snowflake/obfs4-Brücken) und meldet den Fortschritt.
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { app } = require('electron');

class TorService extends EventEmitter {
  constructor() {
    super();
    this.state = { status: 'off', progress: 0, message: '' };
    this.socksPort = 0;
    this.controlPort = 0;
    this.proc = null;
  }

  /** Ordner mit tor(.exe) und pluggable_transports – im Paket unter resources/tor */
  static bundleDir() {
    const sub = process.platform === 'win32' ? 'win-x64' : `mac-${process.arch}`;
    const base = app.isPackaged ? path.join(process.resourcesPath, 'tor') : path.join(__dirname, '..', '..', 'vendor', 'tor');
    return path.join(base, sub);
  }


  async start(opts) {
    const { useBridges, customBridges } = opts || {};
    this.opts = opts;
    if (this.proc) return;
    const dir = TorService.bundleDir();
    const exe = path.join(dir, 'tor', process.platform === 'win32' ? 'tor.exe' : 'tor');
    if (!fs.existsSync(exe)) return this.set('failed', 0, 'Tor fehlt im Programmpaket.');

    const dataDir = path.join(app.getPath('userData'), 'tor');
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

    const args = [
      // Ports vergibt Tor selbst (kein Wettlauf mit anderen Programmen um einen vorab gewählten Port)
      '--SocksPort', 'auto',
      '--ControlPort', 'auto',
      '--ControlPortWriteToFile', path.join(dataDir, 'controlport'),
      '__OwningControllerProcess', String(process.pid),   // Tor endet mit der App, auch nach einem Absturz
      '--CookieAuthentication', '1',
      '--DataDirectory', dataDir,
      '--ClientOnly', '1',
      '--SafeSocks', '1',
      // Liste der Tor-Knoten sofort speichern → nächster Start meist in wenigen Sekunden statt von null
      '--AvoidDiskWrites', '0',
      '--Log', 'notice stdout',
      // schneller: hängende Verbindungen früher über eine andere Route versuchen, Conflux (zwei Wege parallel) an
      '--CircuitStreamTimeout', '15',
      '--ConfluxEnabled', '1'
    ];
    const geo = path.join(dir, 'data');
    if (fs.existsSync(path.join(geo, 'geoip'))) args.push('--GeoIPFile', path.join(geo, 'geoip'), '--GeoIPv6File', path.join(geo, 'geoip6'));

    if (useBridges) args.push(...this.bridgeArgs(dir, customBridges));

    this.set('starting', 0, 'Tor startet …');
    this.proc = spawn(exe, args, {
      cwd: path.dirname(exe),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, LD_LIBRARY_PATH: path.dirname(exe) }
    });

    let buf = '';
    this.proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const line of lines) {
        const sp = line.match(/(?:Opened Socks listener[^\n]* on 127\.0\.0\.1:|Socks listener listening on port )(\d+)/);
        if (sp && !this.socksPort) { this.socksPort = parseInt(sp[1], 10); this.emit('socks', this.socksPort); }
        const m = line.match(/Bootstrapped (\d+)%/);
        if (m) {
          const p = parseInt(m[1], 10);
          if (p >= 100) this.retries = 0;
          this.set(p >= 100 ? 'connected' : 'starting', p, p >= 100 ? 'Sicher über Tor verbunden' : `Tor verbindet … ${p} %`);
        }
      }
    });
    this.proc.on('error', (e) => {
      this.proc = null;
      this.set('failed', 0, `Tor konnte nicht starten (${e.code || e.message}).`);
    });
    this.proc.on('exit', (code) => {
      this.proc = null;
      if (this.state.status === 'stopped') return;
      // z. B. altes Tor hält noch den Datenordner (nach Update/Absturz) → kurz warten und neu starten
      this.retries = (this.retries || 0) + 1;
      if (this.retries <= 3) {
        this.socksPort = 0;
        this.set('starting', 0, 'Tor startet neu …');
        setTimeout(() => this.start(this.opts), 3000 * this.retries);
        return;
      }
      this.set('failed', 0, `Tor wurde beendet (${code}). Bitte Programm neu starten.`);
    });
  }

  /** Brücken aus der offiziellen pt_config.json des Tor-Projekts (oder eigene Zeilen) */
  bridgeArgs(dir, custom) {
    const ptDir = path.join(dir, 'tor', 'pluggable_transports');
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(path.join(ptDir, 'pt_config.json'), 'utf8')); } catch { /* ohne Datei: keine Brücken */ }
    // relativer Pfad (Tor läuft im Ordner „tor“): der Programmpfad enthält Leerzeichen, die Tor nicht verträgt
    const ptPath = 'pluggable_transports' + path.sep;
    const ext = process.platform === 'win32' ? '.exe' : '';
    const plugins = Object.values(cfg.pluggableTransports || {})
      .map((l) => l.replaceAll('${pt_path}', ptPath).replaceAll('${pt_extension}', ext));

    const own = String(custom || '').split(/\r?\n/).map((l) => l.trim().replace(/^Bridge\s+/i, '')).filter(Boolean);
    // obfs4 ist deutlich schneller als Snowflake; Snowflake bleibt als Ausweich dabei
    const lines = own.length ? own : [...(cfg.bridges?.obfs4 || []), ...(cfg.bridges?.snowflake || [])];
    if (!lines.length || !plugins.length) return [];

    const needed = new Set(lines.map((l) => l.split(/\s+/)[0]));
    const args = ['--UseBridges', '1'];
    for (const p of plugins) {
      // „ClientTransportPlugin snowflake exec …“ → nur Plugins, die gebraucht werden
      const names = p.split(/\s+/)[1].split(',');
      if (names.some((n) => needed.has(n))) args.push('--ClientTransportPlugin', p.replace(/^ClientTransportPlugin\s+/, ''));
    }
    for (const l of lines) args.push('--Bridge', l);
    return args;
  }

  /** Neue Tor-Route (NEWNYM) über den Steuer-Port */
  newIdentity() { return this.control('SIGNAL NEWNYM'); }

  /** Befehl an Tors Steuer-Port (mit Cookie-Anmeldung) */
  async control(command) {
    try {
      const f = fs.readFileSync(path.join(app.getPath('userData'), 'tor', 'controlport'), 'utf8');
      this.controlPort = parseInt(f.split(':').pop(), 10) || 0;
    } catch { /* noch nicht gestartet */ }
    if (!this.controlPort) return false;
    const cookieFile = path.join(app.getPath('userData'), 'tor', 'control_auth_cookie');
    let cookie;
    try { cookie = fs.readFileSync(cookieFile).toString('hex'); } catch { return false; }
    return new Promise((resolve) => {
      const sock = net.connect(this.controlPort, '127.0.0.1');
      let out = '';
      sock.setTimeout(5000, () => { sock.destroy(); resolve(false); });
      sock.on('data', (d) => {
        out += d.toString();
        if ((out.match(/^250/gm) || []).length >= 2) { sock.end('QUIT\r\n'); resolve(true); }
        if (/^5\d\d/m.test(out)) { sock.destroy(); resolve(false); }
      });
      sock.on('error', () => resolve(false));
      sock.write(`AUTHENTICATE ${cookie}\r\n${command}\r\n`);
    });
  }

  stop() {
    this.state.status = 'stopped';
    if (this.proc) { this.proc.kill(); this.proc = null; }
  }

  /** Sauber beenden: Tor speichert dabei seinen Stand – der nächste Start geht dadurch viel schneller */
  async stopGracefully() {
    if (!this.proc) return;
    const proc = this.proc;
    this.state.status = 'stopped';
    const exited = new Promise((r) => proc.once('exit', r));
    await Promise.race([this.control('SIGNAL HALT'), new Promise((r) => setTimeout(r, 800))]);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 1500))]);
    if (this.proc) { try { this.proc.kill(); } catch {} this.proc = null; }
  }

  set(status, progress, message) {
    this.state = { status, progress, message };
    this.emit('state', this.state);
  }
}

module.exports = new TorService();
