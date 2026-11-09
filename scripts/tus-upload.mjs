// Große Dateien stückweise zu Supabase Storage hochladen (TUS, „resumable upload“) – 09.11.2026:
// Seit dem Umzug auf den eigenen Server läuft der Speicher hinter Cloudflare, das jede einzelne Anfrage auf 100 MB
// begrenzt. Der Mac-Bau 4.1.50 scheiterte deshalb mit „413 Payload Too Large“ (zip > 100 MB). TUS schickt die Datei
// in Teilen zu 6 MB (von Supabase vorgegeben). Angemeldet wird mit dem Token aus dem signierten Upload-Link
// (Kopfzeile x-signature, Endpunkt /storage/v1/upload/resumable/sign) – kein Geheimnis im Build.
export const TUS_AB = 50 * 1024 * 1024;   // ab dieser Größe stückweise
export const TEIL = 6 * 1024 * 1024;      // Supabase verlangt genau 6 MB je Teil (außer dem letzten)

// Aus dem signierten Link (…/storage/v1/object/upload/sign/<bucket>/<pfad>?token=…) Basis, Bucket, Pfad und Token lesen.
export function signedParts(signedUrl) {
  const u = new URL(signedUrl);
  const m = /^(.*\/storage\/v1)\/object\/upload\/sign\/([^/]+)\/(.+)$/.exec(u.pathname);
  const token = u.searchParams.get('token');
  if (!m || !token) throw new Error('Upload-Link hat ein unbekanntes Format');
  return { base: `${u.origin}${m[1]}`, bucket: decodeURIComponent(m[2]), objectName: decodeURIComponent(m[3]), token };
}

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

export async function tusUpload(signedUrl, body, { contentType = 'application/octet-stream', upsert = false, f = fetch, log = console.log, versuche = 4 } = {}) {
  const { base, bucket, objectName, token } = signedParts(signedUrl);
  const start = await f(`${base}/upload/resumable/sign`, {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0', 'Upload-Length': String(body.length), 'x-signature': token, 'x-upsert': upsert ? 'true' : 'false',
      'Upload-Metadata': `bucketName ${b64(bucket)},objectName ${b64(objectName)},contentType ${b64(contentType)},cacheControl ${b64('3600')}`,
    },
  });
  if (start.status !== 201) throw new Error(`${objectName}: Hochladen (TUS) nicht gestartet (${start.status}) ${(await start.text().catch(() => '')).slice(0, 300)}`);
  const loc = start.headers.get('location');
  if (!loc) throw new Error(`${objectName}: TUS ohne Location`);
  // Hinter Proxy kann der Speicher eine interne Adresse melden (z. B. http://storage:5000/upload/resumable/…) –
  // deshalb nur den Teil ab /upload/resumable übernehmen und an die öffentliche Basis hängen.
  const abs = new URL(loc, `${base}/`);
  const i = abs.pathname.indexOf('/upload/resumable');
  const ziel = i >= 0 ? `${base}${abs.pathname.slice(i)}${abs.search}` : abs.toString();
  let off = 0;
  while (off < body.length) {
    const teil = body.subarray(off, Math.min(off + TEIL, body.length));
    let ok = false, letzter = '';
    for (let v = 1; v <= versuche && !ok; v++) {
      try {
        const r = await f(ziel, { method: 'PATCH', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(off), 'Content-Type': 'application/offset+octet-stream', 'x-signature': token }, body: teil });
        if (r.status === 204) { off = Number(r.headers.get('upload-offset') ?? off + teil.length); ok = true; break; }
        letzter = `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`;
        if (r.status === 409) { // Versatz passt nicht – Stand beim Server erfragen und dort weitermachen
          const h = await f(ziel, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0', 'x-signature': token } });
          const o = Number(h.headers.get('upload-offset')); if (Number.isFinite(o)) { off = o; ok = true; break; }
        }
      } catch (e) { letzter = e.message; }
      if (!ok && v < versuche) await new Promise((res) => setTimeout(res, 1000 * v));
    }
    if (!ok) throw new Error(`${objectName}: Teil ab ${(off / 1048576).toFixed(0)} MB nicht hochgeladen (${letzter})`);
  }
  log(`  stückweise hochgeladen: ${Math.ceil(body.length / TEIL)} Teile`);
}
