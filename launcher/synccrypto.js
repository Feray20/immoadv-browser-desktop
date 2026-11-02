// Verschlüsselung für den Geräte-Abgleich – identisches Format auf Windows, Mac und iPhone (Swift: CryptoKit/CommonCrypto).
//  Schlüssel aus Sync-Passwort: PBKDF2-HMAC-SHA256, 600 000 Runden, 16 Byte Salz → 32 Byte
//  Verschlüsselung: AES-256-GCM, Ausgabe base64(Nonce 12 | Chiffretext | Tag 16) – entspricht CryptoKit „combined“
//  Datensatz-Kennung: kind + ":" + erste 32 Hex-Zeichen von HMAC-SHA256(syncKey, kind + "\0" + natürlicher Schlüssel)
const crypto = require('node:crypto');

const ITERATIONS = 600000;

function deriveKey(passphrase, saltB64, iterations = ITERATIONS) {
  return crypto.pbkdf2Sync(Buffer.from(String(passphrase).normalize('NFC'), 'utf8'), Buffer.from(saltB64, 'base64'), iterations, 32, 'sha256');
}

function seal(key, plain) {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([c.update(Buffer.isBuffer(plain) ? plain : Buffer.from(String(plain), 'utf8')), c.final()]);
  return Buffer.concat([nonce, ct, c.getAuthTag()]).toString('base64');
}

function open(key, b64) {
  const buf = Buffer.from(String(b64), 'base64');
  if (buf.length < 29) throw new Error('zu kurz');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
}

const rid = (key, kind, natural) => `${kind}:${crypto.createHmac('sha256', key).update(`${kind}\0${natural}`).digest('hex').slice(0, 32)}`;
const mac = (key, text) => crypto.createHmac('sha256', key).update(String(text)).digest('base64').slice(0, 22);

function newWrappedKey(passphrase) {
  const syncKey = crypto.randomBytes(32);
  const salt = crypto.randomBytes(16).toString('base64');
  return { syncKey, salt, iterations: ITERATIONS, wrapped: seal(deriveKey(passphrase, salt), syncKey) };
}
function unwrapKey(passphrase, { salt, iterations, wrapped_key }) {
  // Unplausible Werte vom Server nie übernehmen (sonst friert die Schlüsselableitung das Programm ein).
  if (iterations != null && !(Number(iterations) >= 100000 && Number(iterations) <= 5000000)) throw new Error('iterations');
  return open(deriveKey(passphrase, salt, iterations), wrapped_key);   // falsches Passwort → Fehler (GCM-Prüfung)
}

module.exports = { ITERATIONS, deriveKey, seal, open, rid, mac, newWrappedKey, unwrapKey };
