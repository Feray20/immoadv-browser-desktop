// Datei für PDF-Werkzeug und Office-Betrachter laden – im ImmoAdv Browser 4 (Firefox-Motor) über die Erweiterung:
// ?src=https://… (Webseite) oder ?file=<Kennung> (vom Programm freigegebene Datei vom Computer, in Stücken über Native Messaging).
export async function loadBytes(params) {
  const src = params.get('src');
  if (src && /^https?:\/\//i.test(src)) {
    const r = await fetch(src, { credentials: 'include' });
    if (!r.ok) throw new Error(`Datei nicht erreichbar (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  }
  const token = params.get('file') || '';
  if (typeof browser !== 'undefined' && browser.runtime && location.protocol === 'moz-extension:') {
    const parts = []; let offset = 0, size = Infinity;
    while (offset < size) {
      const r = await browser.runtime.sendMessage({ type: 'file:read', token, offset });
      if (!r || r.error) throw new Error((r && r.error) || 'Datei nicht freigegeben');
      size = r.size;
      const bin = atob(r.data); const b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      parts.push(b); offset += b.length;
      if (!b.length) break;
    }
    const all = new Uint8Array(offset); let p = 0; for (const b of parts) { all.set(b, p); p += b.length; }
    return all;
  }
  const r = await fetch(`/__file/${encodeURIComponent(token)}`);       // Version 3 (eigener Motor)
  if (!r.ok) throw new Error('Datei nicht gefunden');
  return new Uint8Array(await r.arrayBuffer());
}
