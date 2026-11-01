// Lesezeichen importieren/exportieren im HTML-Format, das Chrome, Safari, Edge und Firefox verwenden.
function parseBookmarksHTML(html) {
  const out = []; const folders = [];
  const re = /<(\/?)(DL|H3|A)\b([^>]*)>([^<]*)/gi;
  let m, pendingFolder = null;
  const attr = (s, n) => { const r = new RegExp(n + '="([^"]*)"', 'i').exec(s); return r ? r[1] : ''; };
  const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  while ((m = re.exec(html))) {
    const [, close, tag, attrs, text] = m;
    const T = tag.toUpperCase();
    if (T === 'H3' && !close) pendingFolder = unesc(text);
    else if (T === 'DL' && !close) { folders.push(pendingFolder); pendingFolder = null; }
    else if (T === 'DL' && close) folders.pop();
    else if (T === 'A' && !close) {
      const url = attr(attrs, 'HREF');
      if (!/^https?:/i.test(url)) continue;
      const tags = attr(attrs, 'TAGS');
      out.push({ title: unesc(text) || (() => { try { return new URL(url).hostname; } catch { return url; } })(), url, folder: folders.filter(Boolean).filter((f) => !/^(lesezeichenleiste|bookmarks bar|favoriten|favorites bar|lesezeichen-symbolleiste)$/i.test(f)).join(' / '), tags: tags ? tags.split(',').map((x) => x.trim()).filter(Boolean) : [] });
    }
  }
  return out;
}
function bookmarksHTML(list) {
  const e = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const groups = new Map();
  for (const b of list) { const f = b.folder || ''; if (!groups.has(f)) groups.set(f, []); groups.get(f).push(b); }
  const line = (b) => `    <DT><A HREF="${e(b.url)}"${b.tags && b.tags.length ? ` TAGS="${e(b.tags.join(','))}"` : ''}>${e(b.title)}</A>`;
  let body = '';
  for (const [f, items] of groups) {
    if (!f) body += items.map(line).join('\n') + '\n';
    else body += `    <DT><H3>${e(f)}</H3>\n    <DL><p>\n${items.map((b) => '  ' + line(b)).join('\n')}\n    </DL><p>\n`;
  }
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Lesezeichen</TITLE>\n<H1>ImmoAdv Browser – Lesezeichen</H1>\n<DL><p>\n${body}</DL><p>\n`;
}

module.exports = { parseBookmarksHTML, bookmarksHTML };
