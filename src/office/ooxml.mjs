// Kopie aus ImmoAdv (public/src/office-ooxml.mjs) – nur die Lese-Funktionen werden im Browser genutzt.
// ImmoAdv Office – Word (.docx), Excel (.xlsx) und PowerPoint (.pptx) im Browser lesen und schreiben.
// Office-Dateien sind ZIP-Archive mit XML (Office Open XML). Entpackt wird mit JSZip (im PptxGenJS-Paket enthalten),
// gelesen mit DOMParser, geschrieben als schlichtes, gültiges OOXML. Nichts verlässt das Gerät.
import { jszip, pptxgen, dataUrlBytes, toPng, imgSize } from './libs.mjs';

const xmlEsc = (t) => String(t ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const htmlEsc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el, n) => (el ? [...el.children].filter((c) => c.localName === n) : []);
const kid = (el, n) => kids(el, n)[0] || null;
const all = (el, n) => (el ? [...el.getElementsByTagNameNS('*', n)] : []);
const attr = (el, n) => el?.getAttribute(n) ?? el?.getAttribute(n.split(':').pop()) ?? null;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', emf: 'image/emf', wmf: 'image/wmf' };
const joinPath = (base, t) => { if (t.startsWith('/')) return t.slice(1); const p = base.split('/').slice(0, -1); for (const s of t.split('/')) { if (s === '..') p.pop(); else if (s !== '.') p.push(s); } return p.join('/'); };
async function rels(zip, path) {
  const m = new Map(); const s = await zip.file(path)?.async('string'); if (!s) return m;
  for (const r of all(parse(s), 'Relationship')) m.set(r.getAttribute('Id'), { target: r.getAttribute('Target') || '', type: r.getAttribute('Type') || '', ext: r.getAttribute('TargetMode') === 'External' });
  return m;
}
async function media(zip, partPath, rel) {
  const p = joinPath(partPath, rel.target); const f = zip.file(p); if (!f) return null;
  const ext = (p.split('.').pop() || '').toLowerCase(); if (!MIME[ext] || ext === 'emf' || ext === 'wmf') return null;
  return `data:${MIME[ext]};base64,${await f.async('base64')}`;
}

// ===================================== WORD lesen =====================================
export async function readDocx(blob) {
  const Z = await jszip(); const zip = await Z.loadAsync(blob);
  const src = await zip.file('word/document.xml')?.async('string');
  if (!src) throw new Error('Das ist keine gültige Word-Datei (.docx).');
  const R = await rels(zip, 'word/_rels/document.xml.rels');
  const img = new Map();
  for (const [id, r] of R) if (/image/.test(r.type) && !r.ext) img.set(id, await media(zip, 'word/document.xml', r));
  // Formatvorlagen: Name je ID (Überschriften heißen je nach Sprache „berschrift1“, „Heading1“ …)
  const sty = new Map(); const sx = await zip.file('word/styles.xml')?.async('string');
  if (sx) for (const s of all(parse(sx), 'style')) sty.set(attr(s, 'w:styleId'), (attr(kid(s, 'name'), 'w:val') || '').toLowerCase());
  // Aufzählungen: numId → abstractNum → Ebene → Format
  const num = new Map(); const nx = await zip.file('word/numbering.xml')?.async('string');
  if (nx) { const d = parse(nx); const abs = new Map(); for (const a of all(d, 'abstractNum')) { const lv = {}; for (const l of kids(a, 'lvl')) lv[attr(l, 'w:ilvl')] = attr(kid(l, 'numFmt'), 'w:val') || 'bullet'; abs.set(attr(a, 'w:abstractNumId'), lv); } for (const n of kids(d.documentElement, 'num')) num.set(attr(n, 'w:numId'), abs.get(attr(kid(n, 'abstractNumId'), 'w:val')) || {}); }
  const doc = parse(src); const body = all(doc, 'body')[0];
  const heading = (p) => { const id = attr(kid(kid(p, 'pPr'), 'pStyle'), 'w:val') || ''; const n = (sty.get(id) || id).toLowerCase(); if (/^title$|^titel$/.test(n)) return 1; const m = /(heading|berschrift|überschrift)\s*(\d)/.exec(n) || /^(heading|berschrift)(\d)$/.exec(id.toLowerCase()); return m ? Math.min(6, +m[2] + (/title/.test(n) ? 0 : 0)) : 0; };
  const runs = (el) => {
    let h = '';
    for (const c of el.children) {
      const n = c.localName;
      if (n === 'r') h += run(c);
      else if (n === 'hyperlink') { const r = R.get(attr(c, 'r:id')); const inner = runs(c); h += r?.ext && /^https?:|^mailto:/i.test(r.target) ? `<a href="${htmlEsc(r.target)}">${inner}</a>` : inner; }
      else if (['ins', 'smartTag', 'fldSimple', 'sdtContent', 'customXml'].includes(n)) h += runs(c);
      else if (n === 'sdt') h += runs(kid(c, 'sdtContent') || c);
    }
    return h;
  };
  const run = (r) => {
    const pr = kid(r, 'rPr'); let h = '';
    for (const c of r.children) {
      const n = c.localName;
      if (n === 't') h += htmlEsc(c.textContent);
      else if (n === 'tab') h += '&emsp;';
      else if (n === 'br' || n === 'cr') h += attr(c, 'w:type') === 'page' ? '' : '<br>';
      else if (n === 'drawing' || n === 'pict') {
        const b = all(c, 'blip')[0] || all(c, 'imagedata')[0]; const id = attr(b, 'r:embed') || attr(b, 'r:id'); const u = img.get(id);
        const ex = all(c, 'extent')[0]; const w = ex ? Math.round(+attr(ex, 'cx') / 9525) : 0;
        if (u) h += `<img src="${u}" alt=""${w ? ` style="width:${Math.min(w, 680)}px"` : ''}>`;
      }
    }
    if (!h || !pr) return h;
    const on = (k) => { const e = kid(pr, k); return e && !/^(0|false|none)$/.test(attr(e, 'w:val') || 'true'); };
    const st = []; const col = attr(kid(pr, 'color'), 'w:val'); if (col && /^[0-9A-F]{6}$/i.test(col) && col !== '000000') st.push(`color:#${col}`);
    const sz = +attr(kid(pr, 'sz'), 'w:val'); if (sz && sz !== 22 && sz !== 24) st.push(`font-size:${sz / 2}pt`);
    const hl = attr(kid(pr, 'highlight'), 'w:val'); if (hl && hl !== 'none') st.push(`background-color:${hl === 'yellow' ? '#FEF08A' : hl === 'green' ? '#BBF7D0' : hl === 'cyan' ? '#A5F3FC' : hl}`);
    const sh = attr(kid(pr, 'shd'), 'w:fill'); if (!hl && sh && /^[0-9A-F]{6}$/i.test(sh) && sh !== 'FFFFFF') st.push(`background-color:#${sh}`);
    if (st.length) h = `<span style="${st.join(';')}">${h}</span>`;
    if (on('b')) h = `<b>${h}</b>`; if (on('i')) h = `<i>${h}</i>`; if (on('strike')) h = `<s>${h}</s>`;
    const u = attr(kid(pr, 'u'), 'w:val'); if (u && u !== 'none') h = `<u>${h}</u>`;
    const va = attr(kid(pr, 'vertAlign'), 'w:val'); if (va === 'superscript') h = `<sup>${h}</sup>`; else if (va === 'subscript') h = `<sub>${h}</sub>`;
    return h;
  };
  const para = (p) => {
    const pPr = kid(p, 'pPr'); const jc = attr(kid(pPr, 'jc'), 'w:val');
    const al = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : '';
    const pb = all(p, 'br').some((b) => attr(b, 'w:type') === 'page') || !!kid(pPr, 'pageBreakBefore');
    const inner = runs(p) || '<br>';
    const hv = heading(p); const tag = hv ? `h${Math.min(3, hv)}` : 'p';
    return `${pb ? '<hr class="ofx-pb">' : ''}<${tag}${al ? ` style="text-align:${al}"` : ''}>${inner}</${tag}>`;
  };
  const table = (t) => `<table>${kids(t, 'tr').map((tr) => `<tr>${kids(tr, 'tc').map((tc) => { const sp = +attr(kid(kid(tc, 'tcPr'), 'gridSpan'), 'w:val') || 1; const vm = kid(kid(tc, 'tcPr'), 'vMerge'); if (vm && attr(vm, 'w:val') !== 'restart') return ''; return `<td${sp > 1 ? ` colspan="${sp}"` : ''}>${blocks(tc) || '<br>'}</td>`; }).join('')}</tr>`).join('')}</table>`;
  function blocks(el) {
    let h = ''; let stack = []; // offene Listen [{tag, lvl}]
    const closeTo = (lvl) => { while (stack.length && stack[stack.length - 1].lvl >= lvl) h += `</li></${stack.pop().tag}>`; };
    for (const c of el.children) {
      const n = c.localName;
      if (n === 'p') {
        const np = kid(kid(c, 'pPr'), 'numPr');
        if (np && !heading(c)) {
          const lvl = +attr(kid(np, 'ilvl'), 'w:val') || 0; const id = attr(kid(np, 'numId'), 'w:val'); if (id === '0') { closeTo(0); h += para(c); continue; }
          const fmt = (num.get(id) || {})[lvl] || 'bullet'; const tag = fmt === 'bullet' || fmt === 'none' ? 'ul' : 'ol';
          while (stack.length && stack[stack.length - 1].lvl > lvl) h += `</li></${stack.pop().tag}>`;
          const top = stack[stack.length - 1];
          if (top && top.lvl === lvl) { if (top.tag === tag) h += '</li><li>'; else { h += `</li></${stack.pop().tag}><${tag}><li>`; stack.push({ tag, lvl }); } }
          else { h += `<${tag}><li>`; stack.push({ tag, lvl }); }
          h += runs(c) || '<br>';
          continue;
        }
        closeTo(0); h += para(c);
      } else if (n === 'tbl') { closeTo(0); h += table(c); }
      else if (n === 'sdt') { closeTo(0); h += blocks(kid(c, 'sdtContent') || c); }
      else if (n === 'customXml') { closeTo(0); h += blocks(c); }
    }
    closeTo(0); return h;
  }
  return blocks(body) || '<p><br></p>';
}

// ===================================== WORD schreiben =====================================
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const cssColor = (c) => { if (!c) return null; const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c); if (m) { if (m[4] !== undefined && +m[4] === 0) return null; return [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('').toUpperCase(); } const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim()); if (h) return (h[1].length === 3 ? h[1].split('').map((x) => x + x).join('') : h[1]).toUpperCase(); return null; };
const FONT_PT = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };
export async function writeDocx(html, { title = 'Dokument' } = {}) {
  const Z = await jszip(); const zip = new Z();
  const root = document.createElement('div'); root.innerHTML = html;
  const relsX = []; let rid = 10, pid = 1; const nums = []; // [{id, ordered}]
  const imgs = [];
  const addImg = async (src, wPx, hPx) => {
    let u = src; if (!/^data:image\/(png|jpe?g|gif)/i.test(u)) { try { u = (await toPng(u)).url; } catch { return ''; } }
    const { mime, bytes } = dataUrlBytes(u); const ext = /png/.test(mime) ? 'png' : /gif/.test(mime) ? 'gif' : 'jpeg';
    const id = `rId${rid++}`; const fn = `image${imgs.length + 1}.${ext}`; imgs.push({ fn, bytes }); relsX.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fn}"/>`);
    let { w, h } = wPx && hPx ? { w: wPx, h: hPx } : await imgSize(u); if (w > 640) { h = h * 640 / w; w = 640; }
    const cx = Math.round(w * 9525), cy = Math.round(h * 9525), n = pid++;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Bild ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${fn}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  // Inline-Inhalt → Runs (Formatierung aus den Vorfahren)
  const inline = async (node, f = {}) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { const t = c.textContent.replace(/\s+/g, ' '); if (!t) continue; out += rRun(t, f); continue; }
      if (c.nodeType !== 1) continue;
      const tg = c.tagName.toLowerCase();
      if (tg === 'br') { out += '<w:r><w:br/></w:r>'; continue; }
      if (tg === 'img') { out += await addImg(c.getAttribute('src') || '', parseFloat(c.style.width) || +c.getAttribute('width') || 0, 0); continue; }
      if (['ul', 'ol', 'table', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'blockquote'].includes(tg)) { out += await inline(c, f); continue; }
      const g = { ...f }; const s = c.style || {};
      if (tg === 'b' || tg === 'strong' || /^(bold|[6-9]00)$/.test(s.fontWeight || '')) g.b = true;
      if (tg === 'i' || tg === 'em' || s.fontStyle === 'italic') g.i = true;
      if (tg === 'u' || /underline/.test(s.textDecoration || s.textDecorationLine || '')) g.u = true;
      if (tg === 's' || tg === 'strike' || tg === 'del' || /line-through/.test(s.textDecoration || s.textDecorationLine || '')) g.s = true;
      if (tg === 'sup') g.sup = true; if (tg === 'sub') g.sub = true;
      const col = cssColor(s.color || c.getAttribute('color')); if (col) g.color = col;
      const bg = cssColor(s.backgroundColor); if (bg && bg !== 'FFFFFF') g.bg = bg;
      const fs = s.fontSize ? (/pt$/.test(s.fontSize) ? parseFloat(s.fontSize) : /px$/.test(s.fontSize) ? parseFloat(s.fontSize) * 0.75 : 0) : FONT_PT[c.getAttribute('size')] || 0; if (fs) g.sz = Math.round(fs * 2);
      const ff = (s.fontFamily || c.getAttribute('face') || '').split(',')[0].replace(/["']/g, '').trim(); if (ff) g.font = ff;
      if (tg === 'a' && /^https?:|^mailto:/i.test(c.getAttribute('href') || '')) { const id = `rId${rid++}`; relsX.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(c.getAttribute('href'))}" TargetMode="External"/>`); out += `<w:hyperlink r:id="${id}">${await inline(c, { ...g, color: g.color || '0563C1', u: true })}</w:hyperlink>`; continue; }
      out += await inline(c, g);
    }
    return out;
  };
  const rRun = (t, f) => {
    const pr = [f.font ? `<w:rFonts w:ascii="${xmlEsc(f.font)}" w:hAnsi="${xmlEsc(f.font)}" w:cs="${xmlEsc(f.font)}"/>` : '', f.b ? '<w:b/>' : '', f.i ? '<w:i/>' : '', f.s ? '<w:strike/>' : '', f.color ? `<w:color w:val="${f.color}"/>` : '', f.sz ? `<w:sz w:val="${f.sz}"/><w:szCs w:val="${f.sz}"/>` : '', f.u ? '<w:u w:val="single"/>' : '', f.bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${f.bg}"/>` : '', f.sup ? '<w:vertAlign w:val="superscript"/>' : f.sub ? '<w:vertAlign w:val="subscript"/>' : ''].join('');
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(t.replace(/ /g, '\t'))}</w:t></w:r>`;
  };
  const jc = (el) => { const a = el.style?.textAlign || el.getAttribute?.('align') || ''; return a === 'center' ? 'center' : a === 'right' ? 'right' : a === 'justify' ? 'both' : ''; };
  const pXml = (inner, o = {}) => `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}${o.num ? `<w:numPr><w:ilvl w:val="${o.lvl || 0}"/><w:numId w:val="${o.num}"/></w:numPr>` : ''}${o.ind ? `<w:ind w:left="${o.ind}"/>` : ''}${o.jc ? `<w:jc w:val="${o.jc}"/>` : ''}</w:pPr>${inner}</w:p>`;
  const list = async (el, lvl = 0) => {
    const ordered = el.tagName.toLowerCase() === 'ol'; const id = nums.length + 1; nums.push({ id, ordered }); let out = '';
    for (const li of el.children) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const sub = [...li.children].filter((x) => /^(ul|ol)$/i.test(x.tagName));
      const clone = li.cloneNode(true); clone.querySelectorAll(':scope > ul, :scope > ol').forEach((x) => x.remove());
      out += pXml(await inline(clone), { num: id, lvl: Math.min(8, lvl), jc: jc(li) });
      for (const s of sub) out += await list(s, lvl + 1);
    }
    return out;
  };
  const tbl = async (t) => {
    const rows = [...t.querySelectorAll(':scope > tr, :scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr')];
    const cols = Math.max(1, ...rows.map((r) => [...r.children].reduce((n, c) => n + (+c.getAttribute('colspan') || 1), 0)));
    const gw = Math.floor(9000 / cols); let out = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${gw}"/>`).join('')}</w:tblGrid>`;
    for (const r of rows) {
      out += '<w:tr>';
      for (const c of r.children) { const sp = +c.getAttribute('colspan') || 1; const th = c.tagName.toLowerCase() === 'th'; const bg = cssColor(c.style?.backgroundColor); out += `<w:tc><w:tcPr><w:tcW w:w="${gw * sp}" w:type="dxa"/>${sp > 1 ? `<w:gridSpan w:val="${sp}"/>` : ''}${bg || th ? `<w:shd w:val="clear" w:color="auto" w:fill="${bg || 'EEF3FA'}"/>` : ''}</w:tcPr>${(await blocks(c, th)) || '<w:p/>'}</w:tc>`; }
      out += '</w:tr>';
    }
    return `${out}</w:tbl><w:p/>`;
  };
  async function blocks(el, bold = false) {
    let out = '', buf = document.createElement('span');
    const flush = async () => { if (buf.childNodes.length && (buf.textContent.trim() || buf.querySelector('img,br'))) out += pXml(await inline(buf, bold ? { b: true } : {})); buf = document.createElement('span'); };
    for (const c of [...el.childNodes]) {
      const tg = c.nodeType === 1 ? c.tagName.toLowerCase() : '';
      if (/^h[1-6]$/.test(tg)) { await flush(); out += pXml(await inline(c), { style: `Heading${Math.min(3, +tg[1])}`, jc: jc(c) }); }
      else if ((tg === 'p' || tg === 'div') && !c.textContent.trim() && !c.querySelector('img,table,ul,ol')) { await flush(); out += '<w:p/>'; }
      else if (tg === 'p' || tg === 'div' || tg === 'blockquote' || tg === 'pre') { await flush(); if (c.querySelector(':scope > p, :scope > div, :scope > table, :scope > ul, :scope > ol, :scope > h1, :scope > h2, :scope > h3')) out += await blocks(c, bold); else out += pXml(await inline(c, bold ? { b: true } : {}), { jc: jc(c), ind: tg === 'blockquote' ? 720 : 0 }); }
      else if (tg === 'ul' || tg === 'ol') { await flush(); out += await list(c); }
      else if (tg === 'table') { await flush(); out += await tbl(c); }
      else if (tg === 'hr') { await flush(); out += c.classList.contains('ofx-pb') ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>'; }
      else buf.append(c.cloneNode(true));
    }
    await flush(); return out;
  }
  const bodyX = await blocks(root);
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${bodyX || '<w:p/>'}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const lvl = (ordered) => Array.from({ length: 9 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? (i % 3 === 1 ? 'lowerLetter' : i % 3 === 2 ? 'lowerRoman' : 'decimal') : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${i + 1}.` : ['•', 'o', '▪'][i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr>${ordered ? '' : `<w:rPr><w:rFonts w:ascii="${i % 3 === 1 ? 'Courier New' : 'Symbol'}" w:hAnsi="${i % 3 === 1 ? 'Courier New' : 'Symbol'}" w:hint="default"/></w:rPr>`}</w:lvl>`).join('');
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(false).replace(/w:ascii="Symbol" w:hAnsi="Symbol"/g, 'w:ascii="Arial" w:hAnsi="Arial"')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(true)}</w:abstractNum>${nums.map((n) => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.ordered ? 1 : 0}"/>${n.ordered ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ''}</w:num>`).join('')}</w:numbering>`;
  const hs = (id, name, sz) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${+id.slice(-1) - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="0F2C59"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${hs('Heading1', 'heading 1', 36)}${hs('Heading2', 'heading 2', 30)}${hs('Heading3', 'heading 3', 26)}<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>ImmoAdv Office</dc:creator><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:modified></cp:coreProperties>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${relsX.join('')}</Relationships>`);
  zip.file('word/document.xml', doc); zip.file('word/styles.xml', styles); zip.file('word/numbering.xml', numbering);
  for (const i of imgs) zip.file(`word/media/${i.fn}`, i.bytes);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

// ===================================== EXCEL =====================================
export const colName = (c) => { let s = ''; c += 1; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
export const colIndex = (s) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const serialDate = (n) => { const d = new Date(Math.round((n - 25569) * 864e5)); return isNaN(d) ? String(n) : d.toISOString().slice(0, 10).split('-').reverse().join('.'); };
export async function readXlsx(blob) {
  const Z = await jszip(); const zip = await Z.loadAsync(blob);
  const wb = await zip.file('xl/workbook.xml')?.async('string'); if (!wb) throw new Error('Das ist keine gültige Excel-Datei (.xlsx).');
  const R = await rels(zip, 'xl/_rels/workbook.xml.rels');
  const ss = []; const sx = await zip.file('xl/sharedStrings.xml')?.async('string');
  if (sx) for (const si of kids(parse(sx).documentElement, 'si')) ss.push(all(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''));
  // Datumsformate erkennen (Zahl → TT.MM.JJJJ), Fett übernehmen
  const dateXf = new Set(), boldXf = new Set(), euroXf = new Set(); const st = await zip.file('xl/styles.xml')?.async('string');
  if (st) { const d = parse(st); const custom = new Map(kids(kid(d.documentElement, 'numFmts'), 'numFmt').map((n) => [attr(n, 'numFmtId'), attr(n, 'formatCode') || ''])); const fonts = kids(kid(d.documentElement, 'fonts'), 'font'); kids(kid(d.documentElement, 'cellXfs'), 'xf').forEach((x, i) => { const id = +attr(x, 'numFmtId'); const code = custom.get(String(id)) || ''; if ((id >= 14 && id <= 22) || (/[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/0|#/.test(code))) dateXf.add(i); if (/€|EUR/.test(code)) euroXf.add(i); const f = fonts[+attr(x, 'fontId') || 0]; if (f && kid(f, 'b')) boldXf.add(i); }); }
  const sheets = [];
  for (const s of all(parse(wb), 'sheet')) {
    const r = R.get(attr(s, 'r:id')); if (!r) continue;
    const path = joinPath('xl/workbook.xml', r.target); const x = await zip.file(path)?.async('string'); if (!x) continue;
    const d = parse(x); const cells = {}; const widths = {};
    for (const c of all(d, 'col')) { const w = +attr(c, 'width'); for (let i = +attr(c, 'min'); i <= Math.min(+attr(c, 'max'), 200); i++) widths[i - 1] = Math.round(w * 7 + 10); }
    for (const c of all(d, 'c')) {
      const ref = attr(c, 'r'); if (!ref) continue; const t = attr(c, 't'); const sIdx = +attr(c, 's') || 0;
      const fEl = kid(c, 'f'); const vEl = kid(c, 'v'); let v = vEl?.textContent ?? '';
      if (t === 's') v = ss[+v] ?? ''; else if (t === 'inlineStr') v = all(c, 't').map((e) => e.textContent).join(''); else if (t === 'b') v = v === '1' ? 'WAHR' : 'FALSCH';
      else if (t !== 'str' && t !== 'e' && v !== '' && dateXf.has(sIdx)) v = serialDate(+v);
      else if ((!t || t === 'n') && v !== '' && Number.isFinite(+v)) v = +v; // Zahl bleibt Zahl (kein Punkt/Komma-Raten)
      const cell = {};
      if (fEl && fEl.textContent) { cell.v = `=${fEl.textContent}`; cell.c = v; }
      else if (fEl && attr(fEl, 't') === 'shared') { cell.v = v; } // geteilte Formel: zuletzt berechneten Wert übernehmen
      else cell.v = v;
      if (cell.v === '' && !cell.c) continue;
      if (boldXf.has(sIdx)) cell.s = { b: 1 }; if (euroXf.has(sIdx)) cell.s = { ...(cell.s || {}), fmt: 'eur' };
      cells[ref] = cell;
    }
    sheets.push({ name: attr(s, 'name') || `Tabelle${sheets.length + 1}`, cells, widths });
  }
  if (!sheets.length) sheets.push({ name: 'Tabelle1', cells: {}, widths: {} });
  return sheets;
}
// sheets: [{name, cells:{A1:{v,s}}, widths}], calc(sheetIdx, ref) → berechneter Wert, toExcel(formula) → englische Formel
export async function writeXlsx(sheets, { calc, toExcel } = {}) {
  const Z = await jszip(); const zip = new Z();
  const sheetXml = (sh, si) => {
    const rows = new Map(); let maxR = 0, maxC = 0;
    for (const [ref, cell] of Object.entries(sh.cells)) { const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m || cell?.v == null || cell.v === '' || (typeof cell.v === 'number' && !Number.isFinite(cell.v))) continue; const r = +m[2], c = colIndex(m[1]); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); if (!rows.has(r)) rows.set(r, []); rows.get(r).push([c, ref, cell]); }
    const sIdx = (s) => (s?.b ? 1 : 0) + (s?.fmt === 'eur' ? 2 : s?.fmt === 'pct' ? 4 : 0);
    let data = '';
    for (const r of [...rows.keys()].sort((a, b) => a - b)) {
      data += `<row r="${r}">`;
      for (const [, ref, cell] of rows.get(r).sort((a, b) => a[0] - b[0])) {
        const raw = String(cell.v); const s = sIdx(cell.s); const sa = s ? ` s="${s}"` : '';
        if (raw[0] === '=' && raw.length > 1) { const val = calc ? calc(si, ref) : null; const f = toExcel ? toExcel(raw.slice(1)) : raw.slice(1); data += typeof val === 'number' && isFinite(val) ? `<c r="${ref}"${sa}><f>${xmlEsc(f)}</f><v>${val}</v></c>` : `<c r="${ref}" t="str"${sa}><f>${xmlEsc(f)}</f><v>${xmlEsc(val == null ? '' : String(val))}</v></c>`; continue; }
        const n = typeof cell.v === 'number' ? cell.v : numOf(raw);
        if (n != null && Number.isFinite(n)) data += `<c r="${ref}"${sa}><v>${n}</v></c>`;
        else data += `<c r="${ref}" t="inlineStr"${sa}><is><t xml:space="preserve">${xmlEsc(raw)}</t></is></c>`;
      }
      data += '</row>';
    }
    const cols = Object.entries(sh.widths || {}).filter(([, w]) => w && w !== 100).map(([c, w]) => `<col min="${+c + 1}" max="${+c + 1}" width="${Math.max(4, (w - 10) / 7).toFixed(1)}" customWidth="1"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${colName(Math.max(0, maxC))}${Math.max(1, maxR)}"/><sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData></worksheet>`;
  };
  const names = []; sheets.forEach((s) => { let n = String(s.name || 'Tabelle').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Tabelle'; while (names.includes(n)) n = `${n.slice(0, 28)} ${names.length + 1}`; names.push(n); });
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  // Formate: 0 normal, 1 fett, 2 €, 3 fett+€, 4 %, 5 fett+%
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, i)));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}
// Zahl aus deutscher oder englischer Schreibweise („1.234,56“, „12,5“, „12.5“, „19 %“, „9,99 €“)
export function numOf(raw) {
  let s = String(raw ?? '').trim(); if (!s) return null;
  let pct = false; if (/%$/.test(s)) { pct = true; s = s.slice(0, -1).trim(); }
  s = s.replace(/\s*(€|EUR)$/i, '').replace(/^(€)\s*/, '').replace(/\s/g, '');
  if (!/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  // Deutsch zuerst: „1.234“ / „1.234,56“ = Tausenderpunkt, „12,5“ = Dezimalkomma. Englisch nur eindeutig („1,234.5“, „1,234,567“).
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^[-+]?\d{1,3}(,\d{3})+\.\d+$/.test(s) || /^[-+]?\d{1,3}(,\d{3}){2,}$/.test(s)) s = s.replace(/,/g, '');
  else if (/^[-+]?\d*,\d+$/.test(s)) s = s.replace(',', '.');
  else if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) ? (pct ? n / 100 : n) : null;
}
export function readCsv(text) {
  const t = String(text).replace(/^﻿/, ''); const first = t.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length && first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const cells = {}; rows.forEach((r, ri) => r.forEach((v, ci) => { if (v !== '') cells[`${colName(ci)}${ri + 1}`] = { v }; }));
  return [{ name: 'Tabelle1', cells, widths: {} }];
}

// ===================================== POWERPOINT =====================================
// Folienmodell: { w: 960, h: 540, slides: [{ bg, items: [{ t:'text'|'img'|'rect', x, y, w, h, html, size, color, bold, align, fill, src }] }] }
export async function readPptx(blob) {
  const Z = await jszip(); const zip = await Z.loadAsync(blob);
  const px = await zip.file('ppt/presentation.xml')?.async('string'); if (!px) throw new Error('Das ist keine gültige PowerPoint-Datei (.pptx).');
  const pd = parse(px); const sz = all(pd, 'sldSz')[0]; const cx = +attr(sz, 'cx') || 12192000, cy = +attr(sz, 'cy') || 6858000;
  const W = 960, Hh = Math.round(960 * cy / cx), k = W / cx;
  const R = await rels(zip, 'ppt/_rels/presentation.xml.rels');
  const slides = [];
  for (const s of all(pd, 'sldId')) {
    const r = R.get(attr(s, 'r:id')); if (!r) continue;
    const path = joinPath('ppt/presentation.xml', r.target); const x = await zip.file(path)?.async('string'); if (!x) continue;
    const SR = await rels(zip, `${path.replace(/[^/]+$/, '')}_rels/${path.split('/').pop()}.rels`);
    const d = parse(x); const items = []; let bg = '#FFFFFF';
    const bgc = all(kid(all(d, 'bg')[0], 'bgPr'), 'srgbClr')[0]; if (bgc) bg = `#${attr(bgc, 'val')}`;
    const pos = (el, ph) => { const xf = all(el, 'xfrm')[0]; const off = kid(xf, 'off'), ext = kid(xf, 'ext'); if (off && ext) return { x: Math.round(+attr(off, 'x') * k), y: Math.round(+attr(off, 'y') * k), w: Math.round(+attr(ext, 'cx') * k), h: Math.round(+attr(ext, 'cy') * k) }; return ph === 'title' || ph === 'ctrTitle' ? { x: 60, y: 40, w: W - 120, h: 90 } : ph === 'subTitle' ? { x: 120, y: Hh / 2, w: W - 240, h: 80 } : { x: 60, y: 150, w: W - 120, h: Hh - 200 }; };
    const walk = async (tree) => {
      for (const el of tree.children) {
        const n = el.localName;
        if (n === 'grpSp') { await walk(el); continue; }
        if (n === 'sp') {
          const ph = attr(all(el, 'ph')[0], 'type') || (all(el, 'ph')[0] ? 'body' : null);
          const p = pos(kid(el, 'spPr') || el, ph); const tx = kid(el, 'txBody'); let fill = null;
          const sf = kid(kid(el, 'spPr'), 'solidFill'); const fc = sf && all(sf, 'srgbClr')[0]; if (fc) fill = `#${attr(fc, 'val')}`;
          let size = ph === 'title' || ph === 'ctrTitle' ? 40 : 20, color = '#111827', bold = ph === 'title' || ph === 'ctrTitle', align = 'left';
          const paras = tx ? kids(tx, 'p') : [];
          const html = paras.map((pp) => { const pr = kid(pp, 'pPr'); const al = attr(pr, 'algn'); if (al === 'ctr') align = 'center'; else if (al === 'r') align = 'right'; const bul = !!all(pr, 'buChar')[0] || (ph === 'body' && !all(pr, 'buNone')[0]); const t = all(pp, 'r').map((r) => { const rp = kid(r, 'rPr'); if (rp && attr(rp, 'sz')) size = Math.round(+attr(rp, 'sz') / 100); if (rp && attr(rp, 'b') === '1') bold = true; const c = all(rp, 'srgbClr')[0]; if (c) color = `#${attr(c, 'val')}`; return htmlEsc(all(r, 't').map((e) => e.textContent).join('')); }).join(''); return t ? `<div>${bul && ph === 'body' ? '• ' : ''}${t}</div>` : '<div><br></div>'; }).join('');
          if (html.replace(/<[^>]+>/g, '').trim()) items.push({ t: 'text', ...p, html, size, color, bold, align, fill });
          else if (fill) items.push({ t: 'rect', ...p, fill });
          continue;
        }
        if (n === 'pic') { const b = all(el, 'blip')[0]; const rr = SR.get(attr(b, 'r:embed')); const u = rr ? await media(zip, path, rr) : null; if (u) items.push({ t: 'img', ...pos(kid(el, 'spPr') || el), src: u }); continue; }
        if (n === 'graphicFrame') { const rowsT = all(el, 'tr').map((tr) => all(tr, 'tc').map((tc) => all(tc, 't').map((t) => t.textContent).join(' ')).join(' | ')); if (rowsT.length) items.push({ t: 'text', ...pos(el), html: rowsT.map((r) => `<div>${htmlEsc(r)}</div>`).join(''), size: 14, color: '#111827', bold: false, align: 'left' }); }
      }
    };
    const tree = all(d, 'spTree')[0]; if (tree) await walk(tree);
    slides.push({ bg, items });
  }
  return { w: W, h: Hh, slides: slides.length ? slides : [{ bg: '#FFFFFF', items: [] }] };
}
const plain = (html) => { const d = document.createElement('div'); d.innerHTML = String(html || '').replace(/<\/(div|p|li)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n'); return d.textContent.replace(/\n{3,}/g, '\n\n').replace(/\n$/, ''); };
export async function writePptx(model, { title = 'Präsentation' } = {}) {
  const P = await pptxgen(); const pres = new P();
  const wIn = 13.333, hIn = wIn * model.h / model.w, k = wIn / model.w;
  pres.defineLayout({ name: 'IA', width: wIn, height: hIn }); pres.layout = 'IA'; pres.title = title; pres.author = 'ImmoAdv Office';
  const hex = (c, d) => (/^#?[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).replace('#', '').toUpperCase() : d);
  for (const s of model.slides) {
    const sl = pres.addSlide(); sl.background = { color: hex(s.bg, 'FFFFFF') };
    for (const it of s.items) {
      const box = { x: it.x * k, y: it.y * k, w: Math.max(0.1, it.w * k), h: Math.max(0.1, it.h * k) };
      if (it.t === 'rect') sl.addShape(pres.ShapeType.rect, { ...box, fill: { color: hex(it.fill, 'E2E8F0') }, line: { color: hex(it.fill, 'E2E8F0') } });
      else if (it.t === 'img') { let u = it.src; if (!/^data:image\/(png|jpe?g|gif)/i.test(u)) { try { u = (await toPng(u)).url; } catch { continue; } } sl.addImage({ data: u, ...box }); }
      else sl.addText(plain(it.html), { ...box, fontSize: Math.max(6, Math.round(it.size || 20)), color: hex(it.color, '111827'), bold: !!it.bold, align: it.align || 'left', valign: 'top', fontFace: 'Calibri', fill: it.fill ? { color: hex(it.fill, 'FFFFFF') } : undefined, margin: 4 });
    }
  }
  return pres.write({ outputType: 'blob' });
}
export { plain as htmlToPlain };
