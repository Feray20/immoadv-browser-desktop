// Kurzfassung einer Seite – läuft komplett lokal in einer isolierten Skript-Welt, nichts verlässt den Computer.
// Verfahren: Haupttext finden, Sätze nach Schlüsselwort-Dichte und Position bewerten, die besten in Originalreihenfolge.
function summarizePage() {
  const STOP = new Set(('der die das und oder aber ein eine einer eines einem einen ist sind war waren wird werden wurde ' +
    'mit von zu zur zum im in am an auf für bei aus nach über unter vor durch als auch nicht noch nur so wie wenn dass ' +
    'es er sie wir ihr ich du man sich sein seine ihre ihr hat haben hatte kann können mehr sehr bis um des den dem ' +
    'the a an and or but is are was were be been to of in on at for with from by as it this that these those not ' +
    'you we they he she i our your their its can will would should has have had more most also than then there here ' +
    'bir ve ile bu da de için çok gibi daha olan olarak').split(' '));

  // 1) Haupttext: <article>/<main> oder der Block mit dem meisten Absatztext
  const pick = () => {
    const cands = [...document.querySelectorAll('article, main, [role=main]')];
    let best = null, bestLen = 0;
    const consider = (el) => {
      const len = [...el.querySelectorAll('p, li')].reduce((n, p) => n + (p.innerText || '').length, 0);
      if (len > bestLen) { best = el; bestLen = len; }
    };
    cands.forEach(consider);
    if (bestLen < 600) document.querySelectorAll('div, section').forEach((el) => { if (el.querySelectorAll('p').length >= 3) consider(el); });
    return best || document.body;
  };
  const root = pick();
  const blocks = [...root.querySelectorAll('p, li, h2, h3, dd, td')]
    .filter((el) => !el.closest('nav, footer, header, aside, form, [aria-hidden=true]'))
    .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 40);
  const text = blocks.join(' ');
  const words = text.split(/\s+/).filter(Boolean).length;

  // 2) Sätze
  const sentences = [];
  blocks.forEach((b) => (b.match(/[^.!?…]+[.!?…]+["“”»)]?|[^.!?…]+$/g) || []).forEach((s) => {
    s = s.trim();
    if (s.length > 50 && s.length < 400 && !sentences.includes(s)) sentences.push(s);
  }));
  if (!sentences.length) return { title: document.title, words, minutes: 0, points: [] };

  // 3) Bewertung
  const tok = (s) => s.toLowerCase().match(/[a-zäöüßçğıöşü0-9]{3,}/g) || [];
  const freq = {};
  sentences.forEach((s) => tok(s).forEach((w) => { if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1; }));
  const titleWords = new Set(tok(document.title).filter((w) => !STOP.has(w)));
  const scored = sentences.map((s, i) => {
    const t = tok(s).filter((w) => !STOP.has(w));
    if (!t.length) return { s, i, score: 0 };
    let score = t.reduce((n, w) => n + (freq[w] || 0), 0) / Math.sqrt(t.length);
    score += t.filter((w) => titleWords.has(w)).length * 1.5;
    if (/\d/.test(s)) score *= 1.15;                  // Zahlen/Fakten sind meist wichtig
    score *= 1 + Math.max(0, 0.4 - i / sentences.length);   // Anfang leicht bevorzugt
    return { s, i, score };
  });
  const n = Math.min(sentences.length, words > 1500 ? 7 : words > 600 ? 5 : 3);
  const points = scored.sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
  return { title: document.title, words, minutes: Math.max(1, Math.round(words / 220)), points, lang: document.documentElement.lang || '' };
}

module.exports = { SUMMARY_SCRIPT: '(' + summarizePage.toString() + ')()' };
