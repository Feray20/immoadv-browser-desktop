// SHA-256 über die unveränderten Dateibytes (Upload-Verlauf, 02.11.2026).
// Gleiche Spezifikation auf Windows, Mac und iPhone: SHA-256 der kompletten Datei, Ausgabe 64 Hex-Zeichen klein.
// Kleine/mittlere Dateien über die eingebaute Web-Krypto (schnell); große Dateien in Stücken (begrenzter Speicher).
// Läuft nur lokal – die Datei verlässt dafür nie das Gerät.
'use strict';
(function (root) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

  /** Fortlaufende Berechnung: update() mit beliebig großen Stücken, digestHex() am Ende. */
  function Sha256() {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const buf = new Uint8Array(64);
    let bufLen = 0, total = 0, done = false;

    function block(b, off) {
      for (let i = 0; i < 16; i++) W[i] = (b[off + i * 4] << 24) | (b[off + i * 4 + 1] << 16) | (b[off + i * 4 + 2] << 8) | b[off + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const x = W[i - 15], y = W[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    function update(data) {
      if (done) throw new Error('bereits abgeschlossen');
      const b = data instanceof Uint8Array ? data : new Uint8Array(data);
      total += b.length;
      let i = 0;
      if (bufLen) {
        const n = Math.min(64 - bufLen, b.length);
        buf.set(b.subarray(0, n), bufLen); bufLen += n; i = n;
        if (bufLen === 64) { block(buf, 0); bufLen = 0; }
      }
      for (; i + 64 <= b.length; i += 64) block(b, i);
      if (i < b.length) { buf.set(b.subarray(i), 0); bufLen = b.length - i; }
    }
    function digestHex() {
      if (done) throw new Error('bereits abgeschlossen');
      done = true;
      const bits = total * 8;
      const tail = new Uint8Array(bufLen < 56 ? 64 : 128);
      tail.set(buf.subarray(0, bufLen)); tail[bufLen] = 0x80;
      const dv = new DataView(tail.buffer);
      dv.setUint32(tail.length - 8, Math.floor(bits / 0x100000000));
      dv.setUint32(tail.length - 4, bits >>> 0);
      for (let o = 0; o < tail.length; o += 64) block(tail, o);
      let hex = '';
      for (let i = 0; i < 8; i++) hex += (H[i] >>> 0).toString(16).padStart(8, '0');
      return hex;
    }
    return { update, digestHex };
  }

  const toHex = (ab) => Array.from(new Uint8Array(ab), (x) => x.toString(16).padStart(2, '0')).join('');
  const SUBTLE_MAX = 256 * 1024 * 1024;   // bis 256 MB in einem Stück über die Web-Krypto
  const CHUNK = 4 * 1024 * 1024;

  /** SHA-256 einer Datei/eines Blobs. Wirft bei Lesefehlern – dann wird kein Hash gespeichert (nie erfunden). */
  async function hashBlob(blob, onProgress) {
    const subtle = root.crypto && root.crypto.subtle;
    if (subtle && blob.size <= SUBTLE_MAX) return toHex(await subtle.digest('SHA-256', await blob.arrayBuffer()));
    const h = Sha256();
    for (let off = 0; off < blob.size; off += CHUNK) {
      h.update(new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer()));
      if (onProgress) onProgress(Math.min(1, (off + CHUNK) / blob.size));
    }
    return h.digestHex();
  }

  const api = { Sha256, hashBlob };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ImmoSha256 = api;
})(typeof self !== 'undefined' ? self : globalThis);
