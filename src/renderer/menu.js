'use strict';
const box = document.getElementById('m');
let items = [], flat = [], sel = -1;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function row(it) {
  if (it.sep) return '<div class="sep"></div>';
  if (it.head) return `<div class="head">${esc(it.head)}</div>`;
  const ic = it.checked ? '✓' : '';
  if (it.sub) return `<div class="it" data-sub="${it.id}"><span class="ic"></span><span class="lb">${esc(it.label)}</span><span class="ar">›</span></div><div class="sub" id="s${it.id}" hidden>${it.sub.map(row).join('')}</div>`;
  return `<div class="it" data-id="${it.id}" role="menuitem"><span class="ic">${ic}</span><span class="lb">${esc(it.label)}</span>${it.accel ? `<span class="ac">${esc(it.accel)}</span>` : ''}</div>`;
}
// sofort messen (unsichtbare Ebenen bekommen kein requestAnimationFrame)
function measure() { const r = box.getBoundingClientRect(); window.fadeMenu.size(Math.ceil(r.width + 28), Math.ceil(box.scrollHeight + 26)); }
function render() {
  box.innerHTML = items.map(row).join('');
  box.querySelectorAll('[data-id]').forEach((el) => { el.onclick = () => window.fadeMenu.pick(el.dataset.id); });
  box.querySelectorAll('[data-sub]').forEach((el) => {
    el.onclick = () => { const s = document.getElementById('s' + el.dataset.sub); s.hidden = !s.hidden; el.classList.toggle('open', !s.hidden); measure(); refresh(); };
  });
  refresh(); measure();
}
function refresh() { flat = [...box.querySelectorAll('.it')].filter((el) => el.offsetParent !== null); }
window.fadeMenu.onShow((d) => { items = d.items || []; sel = -1; render(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return window.fadeMenu.close();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!flat.length) return;
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length;
    flat.forEach((el, i) => el.classList.toggle('sel', i === sel)); flat[sel].scrollIntoView({ block: 'nearest' });
  }
  if ((e.key === 'Enter' || e.key === ' ') && flat[sel]) flat[sel].click();
});
