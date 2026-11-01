// Liest Eckdaten aus einem Immobilien-Inserat. Wird als Text in die Seite gegeben (läuft nur lokal).
function readListing() {
  const out = { title: document.title || '' };
  const num = (v) => (v == null ? null : typeof v === 'number' ? v : String(v));
  try {
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      let j; try { j = JSON.parse(s.textContent); } catch (e) { return; }
      const list = Array.isArray(j) ? j : (j['@graph'] || [j]);
      list.forEach((o) => {
        if (!o || typeof o !== 'object') return;
        let offer = o.offers || null; if (Array.isArray(offer)) offer = offer[0];
        if (offer && offer.price && !out.price) out.price = num(offer.price);
        if (o.price && !out.price) out.price = num(o.price);
        const item = o.itemOffered || {};
        const fs = o.floorSize || item.floorSize;
        if (fs && !out.area) out.area = num(fs.value || fs);
        const r = o.numberOfRooms || item.numberOfRooms;
        if (r && !out.rooms) out.rooms = num(r.value || r);
        const a = o.address || item.address;
        if (a) { if (a.postalCode && !out.zip) out.zip = String(a.postalCode); if (a.addressLocality && !out.city) out.city = String(a.addressLocality); }
        if (o.name && out.title.length < 4) out.title = o.name;
      });
    });
  } catch (e) {}
  const text = (document.body ? document.body.innerText : '').replace(/ /g, ' ');
  const grab = (re) => { const m = text.match(re); return m ? m[1] : null; };
  const euro = '([0-9]{1,3}(?:[.\\s][0-9]{3})+(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\\s*(?:€|EUR)';
  if (!out.price) out.price = grab(new RegExp('Kaufpreis[^0-9]{0,40}' + euro, 'i'));
  if (!out.rent) out.rent = grab(new RegExp('(?:Kaltmiete|Nettokaltmiete|Mieteinnahmen?|Ist-Miete)[^0-9]{0,40}' + euro, 'i'));
  if (!out.area) out.area = grab(/Wohnfl(?:ä|ae)che[^0-9]{0,30}([0-9]{1,4}(?:,[0-9]{1,2})?)\s*m/i);
  if (!out.rooms) out.rooms = grab(/([0-9]{1,2}(?:,5)?)\s*Zimmer/i);
  if (!out.zip) out.zip = grab(/\b([0-9]{5})\s+[A-ZÄÖÜ][a-zäöüß]/);
  out.isRent = !out.price && !!out.rent && /miet|rent/.test(location.href.toLowerCase()) && !/Kaufpreis/i.test(text);
  out.source = location.hostname;
  return out;
}

module.exports = { LISTING_SCRIPT: '(' + readListing.toString() + ')()' };
