// Upload-Verlauf (Wunsch Feray 02.11.2026): je hochgeladener Datei ein Eintrag mit SHA-256, Portal, Zeit und Gerät.
// Liegt im selben Speicher wie Lesezeichen (einstellungen.json) und geht über den bestehenden ImmoAdv-Sync Ende-zu-Ende
// verschlüsselt auf alle Geräte (Datensatz-Art „up“). Die Dateien selbst werden nie gespeichert oder übertragen.
// Nichts läuft automatisch ab; gelöscht wird nur, was Feray selbst löscht (und dann auf allen Geräten).
const store = require('./store');

const DOC_TYPES = ['Lebenslauf', 'Anschreiben', 'Arbeitszeugnis', 'Ausbildungszeugnis', 'Zertifikat', 'Bewerbung', 'Vertrag', 'Rechnung', 'Sonstiges'];
const STATUS = ['SELECTED', 'TRANSFER_STARTED', 'TRANSFER_COMPLETED', 'SERVER_ACKNOWLEDGED', 'FAILED', 'UNKNOWN'];
const RANK = { UNKNOWN: 0, SELECTED: 1, TRANSFER_STARTED: 2, FAILED: 3, TRANSFER_COMPLETED: 4, SERVER_ACKNOWLEDGED: 5 };
const FIELDS = ['id', 'name', 'size', 'mime', 'sha256', 'pages', 'docType', 'at', 'tz', 'domain', 'url', 'title', 'portal', 'employer', 'frame', 'via',
  'platform', 'device', 'deviceName', 'status', 'transport'];

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
// Zeitpunkt in Millisekunden UTC – auch aus Sekunden oder ISO-Text (anderes Gerät); nie stillschweigend „jetzt“ einsetzen,
// außer der Wert fehlt ganz (dann wäre der Eintrag sonst nicht einzuordnen).
function toMs(v) {
  if (typeof v === 'string' && !/^\d+(\.\d+)?$/.test(v)) { const t = Date.parse(v); return Number.isFinite(t) && t > 0 ? t : Date.now(); }
  const n = Number(v);
  if (!(n > 0)) return Date.now();
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}
/** Nur bekannte Felder mit festen Längen – egal, woher der Datensatz kommt (Erweiterung oder anderes Gerät). */
function clean(r) {
  if (!r || typeof r !== 'object' || !/^[\w-]{8,64}$/.test(String(r.id || ''))) return null;
  return {
    id: String(r.id),
    name: str(r.name, 260) || 'Datei',
    size: Math.max(0, Math.min(Number(r.size) || 0, 1e13)),
    mime: str(r.mime, 120),
    sha256: /^[0-9a-f]{64}$/.test(String(r.sha256 || '')) ? String(r.sha256) : '',
    pages: Number.isInteger(r.pages) && r.pages > 0 && r.pages < 100000 ? r.pages : null,
    docType: DOC_TYPES.includes(r.docType) ? r.docType : 'Sonstiges',
    at: toMs(r.at),
    tz: str(r.tz, 64),
    domain: str(r.domain, 253),
    url: /^https?:\/\//i.test(String(r.url || '')) ? str(r.url, 1000) : '',
    title: str(r.title, 300),
    portal: str(r.portal, 120),
    employer: str(r.employer, 120),
    frame: str(r.frame, 253),
    via: r.via === 'drop' ? 'drop' : r.via === 'input' ? 'input' : str(r.via, 20),
    platform: str(r.platform, 20),
    device: str(r.device, 64),
    deviceName: str(r.deviceName, 80),
    status: STATUS.includes(r.status) ? r.status : 'UNKNOWN',
    transport: str(r.transport, 64)
  };
}

// Kein automatisches Kürzen (Prüfung 02.11.2026): früher fielen ab 50 000 Einträgen die ältesten weg – der Abgleich hielt das
// für „gelöscht“ und löschte sie auf allen Geräten. Gelöscht wird nur noch, was Feray selbst löscht (removed-Liste unten).
const all = () => store.get('uploads') || [];
let batch = null;   // während eines Abgleichs: Änderungen sammeln, am Ende einmal speichern
function save(list) {
  list.sort((a, b) => b.at - a.at);
  if (batch) { batch.list = list; return; }
  store.set('uploads', list);
}
const current = () => (batch && batch.list) || all();
function beginBatch() { if (!batch) batch = { list: null }; }
function endBatch() { const b = batch; batch = null; if (b && b.list) store.set('uploads', b.list); return !!(b && b.list); }

/** Neue Einträge dieses Geräts (von der Erweiterung). device/platform setzt das Programm selbst. */
function add(recs, dev) {
  const list = [...current()];
  const ids = new Set(list.map((x) => x.id));
  const added = [];
  for (const r0 of (Array.isArray(recs) ? recs : []).slice(0, 50)) {
    const r = clean({ ...r0, status: 'SELECTED', device: dev.id, deviceName: dev.name, platform: dev.platform });
    if (!r || ids.has(r.id)) continue;
    list.push(r); ids.add(r.id); added.push(r.id);
  }
  if (added.length) save(list);
  return added;
}

/** Übertragungsstand – nur vorwärts (eine gemeldete Übertragung wird nie wieder „ausgewählt“). */
function setStatus(ids, status, transport) {
  if (!STATUS.includes(status)) return 0;
  const want = new Set((Array.isArray(ids) ? ids : []).map(String));
  let n = 0;
  const list = current().map((r) => {
    if (!want.has(r.id) || (RANK[status] || 0) <= (RANK[r.status] || 0)) return r;
    n++;
    return { ...r, status, transport: transport ? str(transport, 64) : r.transport };
  });
  if (n) save(list);
  return n;
}

/** Von Feray gelöscht: entfernen und merken – nur diese Löschungen gehen an die anderen Geräte. */
function remove(ids) {
  const want = new Set((Array.isArray(ids) ? ids : []).map(String));
  const list = current();
  const next = list.filter((r) => !want.has(r.id));
  const gone = list.filter((r) => want.has(r.id)).map((r) => r.id);
  if (gone.length) {
    store.set('uploadsRemoved', [...new Set([...(store.get('uploadsRemoved') || []), ...gone])].slice(-20000));
    save(next);
  }
  return gone.length;
}
const removedIds = () => store.get('uploadsRemoved') || [];
function clearRemoved(ids) {
  const done = new Set(ids);
  const rest = removedIds().filter((x) => !done.has(x));
  store.set('uploadsRemoved', rest);
}

/** Vom anderen Gerät: übernehmen bzw. aktualisieren (Status nur vorwärts), Löschung entfernt. false = Datensatz unbrauchbar. */
function applyRemote(body, deleted) {
  const r = clean(body);
  if (!r) return false;
  const list = [...current()];
  const i = list.findIndex((x) => x.id === r.id);
  if (deleted) { if (i >= 0) { list.splice(i, 1); save(list); } return true; }
  if (i < 0) list.push(r);
  else list[i] = { ...list[i], ...r, status: (RANK[r.status] || 0) >= (RANK[list[i].status] || 0) ? r.status : list[i].status };
  save(list);
  return true;
}

/** Seitenweise an die Erweiterung: höchstens ~700 KB je Antwort (Nachrichten sind auf 1 MB begrenzt). */
function page(offset = 0, maxBytes = 700 * 1024) {
  const list = all();
  const o = Math.max(0, Number(offset) || 0);
  const items = [];
  let bytes = 0;
  for (let i = o; i < list.length; i++) {
    const n = Buffer.byteLength(JSON.stringify(list[i])) + 1;
    if (items.length && bytes + n > maxBytes) break;
    items.push(list[i]); bytes += n;
  }
  return { total: list.length, offset: o, items };
}

module.exports = { FIELDS, STATUS, RANK, clean, toMs, all, add, setStatus, remove, removedIds, clearRemoved, applyRemote, page, beginBatch, endBatch };
