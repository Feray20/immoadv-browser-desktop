// Fenster des ImmoAdv-Programms: Einrichtung, Update und Einstellungen
const $ = (id) => document.getElementById(id);
const api = window.immo;
let S = null;
let view = (location.hash || '#setup').slice(1);
let poll = null;

const TITLES = { setup: 'Einrichtung', update: 'Updates', settings: 'Einstellungen' };
const STATUS = {
  idle: 'Wird geprüft …', checking: 'Suche nach Updates …', current: 'Du hast die neueste Version', available: 'Neue Version verfügbar',
  downloading: 'Wird geladen …', ready: 'Bereit zur Installation', retry: 'Update-Server nicht erreichbar – neuer Versuch folgt',
  error: 'Update-Server nicht erreichbar', unsupported: 'Updates nur in der installierten Version'
};

function show(v) {
  view = TITLES[v] ? v : 'setup';
  for (const id of Object.keys(TITLES)) $(id).classList.toggle('hidden', id !== view);
  $('topSub').textContent = TITLES[view];
  clearInterval(poll);
  if (view === 'setup') poll = setInterval(refresh, 2000);
  refresh();
}

async function refresh() {
  S = await api.state();
  document.body.classList.toggle('mac', S.platform === 'darwin');
  if (view === 'setup') renderSetup();
  if (view === 'update') renderUpdate(S.update);
  if (view === 'settings') renderSettings();
}

function renderSetup() {
  $('pasteKey').textContent = S.platform === 'darwin' ? '⌘ + V' : 'Strg + V';
  $('bioName').textContent = S.platform === 'darwin' ? 'Touch ID' : 'Windows Hello';
  $('chromeCheck').className = 'check' + (S.chromeFound ? ' ok' : '');
  if (S.chromeFound) {
    $('chromeText').textContent = `Installiert${S.chromeVersion ? ' – Version ' + S.chromeVersion : ''}. Updates kommen automatisch von Google.`;
    $('installChrome').classList.add('hidden');
  } else if (!$('installChrome').disabled) {
    $('chromeText').textContent = 'Noch nicht installiert. Wird direkt und geprüft von Google geladen.';
    $('installChrome').classList.remove('hidden');
  }
  $('extPath').textContent = S.extPath; $('extPath').title = S.extPath;
  $('themePath').textContent = S.themePath; $('themePath').title = S.themePath;
  $('extCheck').className = 'check' + (S.extLoaded ? ' ok' : '');
  $('extStatus').textContent = S.extLoaded ? 'ImmoAdv ist aktiv' : '';
  $('themeStatus').textContent = S.themeLoaded ? 'Design ist aktiv' : '';
  $('openExt').disabled = !S.chromeFound;
  $('openTheme').disabled = !S.chromeFound;
  $('finish').disabled = !(S.chromeFound && S.extLoaded);
}

$('installChrome').addEventListener('click', async () => {
  const b = $('installChrome'); b.disabled = true; b.textContent = 'Wird installiert …';
  $('chromeBar').classList.remove('hidden');
  const r = await api.installChrome();
  $('chromeBar').classList.add('hidden');
  b.disabled = false; b.textContent = 'Chrome von Google installieren';
  if (!r.ok) $('chromeText').textContent = r.error;
  refresh();
});
api.on('install-progress', (p) => {
  const t = { download: 'Lädt Chrome von Google …', verify: 'Prüft die Signatur von Google …', install: 'Installiert …' }[p.step];
  $('chromeText').textContent = t + (p.p ? ` ${p.p} %` : '');
  $('chromeBar').firstElementChild.style.width = (p.step === 'download' ? p.p || 0 : 100) + '%';
});
$('openExt').addEventListener('click', async () => { await api.openExtensions('extension'); $('extStatus').textContent = 'Ordner kopiert – jetzt in Chrome einfügen'; });
$('openTheme').addEventListener('click', async () => { await api.openExtensions('theme'); $('themeStatus').textContent = 'Ordner kopiert – jetzt in Chrome einfügen'; });
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
  await api.copy($(b.dataset.copy).textContent); const t = b.textContent; b.textContent = 'Kopiert'; setTimeout(() => { b.textContent = t; }, 1200);
}));
$('finish').addEventListener('click', () => api.finishSetup());

function renderUpdate(u) {
  if (!u) return;
  $('uCurrent').textContent = u.current || (S && S.appVersion) || '–';
  $('uStatus').textContent = (u.status === 'available' || u.status === 'ready' || u.status === 'downloading') && u.version
    ? `${STATUS[u.status]} – Version ${u.version}` : STATUS[u.status] || u.message || '–';
  $('uBar').classList.toggle('hidden', u.status !== 'downloading');
  $('uBar').firstElementChild.style.width = (u.progress || 0) + '%';
  $('uNotes').classList.toggle('hidden', !u.notes);
  $('uNotes').textContent = u.notes ? 'Neu:\n' + u.notes : '';
  $('uInstall').classList.toggle('hidden', u.status !== 'ready');
  $('uInstall').textContent = u.macManual ? 'Update öffnen und installieren' : 'Update jetzt installieren';
  $('uDownload').classList.toggle('hidden', u.status !== 'available');
  if (S) $('autoUpdate').checked = S.autoUpdate;
}
api.on('update', (u) => { if (view === 'update') renderUpdate(u); });
$('uCheck').addEventListener('click', async () => renderUpdate(await api.updateCheck()));
$('uDownload').addEventListener('click', () => api.updateDownload());
$('uInstall').addEventListener('click', () => api.updateInstall());
$('autoUpdate').addEventListener('change', (e) => api.setAutoUpdate(e.target.checked));

function renderSettings() {
  const box = $('dnsList');
  if (!box.childElementCount) {
    for (const d of S.dnsList) {
      const l = document.createElement('label');
      const i = document.createElement('input'); i.type = 'radio'; i.name = 'dns'; i.value = d.id;
      i.addEventListener('change', async () => {
        const r = await api.setDns(d.id);
        $('dnsNote').textContent = r.applied ? 'Übernommen.' : 'Wird beim nächsten Öffnen des Browsers übernommen (Chrome ist gerade offen).';
      });
      const t = document.createElement('span'); t.textContent = d.name;
      l.append(i, t); box.append(l);
    }
  }
  box.querySelectorAll('input').forEach((i) => { i.checked = i.value === S.dns; });
  $('sApp').textContent = S.appVersion;
  $('sChrome').textContent = S.chromeVersion || (S.chromeFound ? 'Installiert' : 'Nicht installiert');
}
$('sUpdate').addEventListener('click', () => show('update'));
$('sOpen').addEventListener('click', () => api.openBrowser());

api.on('view', show);
show(view);
