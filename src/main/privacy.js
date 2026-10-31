// Schutzschicht für alle Webseiten: Tor-Proxy, flüchtige Daten, Tracker-Blocker,
// HTTPS-Zwang, keine Berechtigungen, einheitlicher User-Agent.
const { session } = require('electron');
const crypto = require('node:crypto');
const store = require('./store');

const TRACKERS = [
  'doubleclick.net', 'google-analytics.com', 'googletagmanager.com', 'googlesyndication.com',
  'googleadservices.com', 'adservice.google.com', 'facebook.net', 'analytics.tiktok.com', 'ads-twitter.com',
  'bat.bing.com', 'clarity.ms', 'hotjar.com', 'hotjar.io', 'scorecardresearch.com', 'quantserve.com',
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'adnxs.com', 'rubiconproject.com', 'pubmatic.com',
  'openx.net', 'amazon-adsystem.com', 'adsrvr.org', 'moatads.com', 'yieldlab.net', 'ioam.de', 'xiti.com',
  'chartbeat.com', 'nr-data.net', 'segment.io', 'segment.com', 'mixpanel.com', 'amplitude.com', 'fullstory.com',
  'mouseflow.com', 'smartlook.com', 'snap.licdn.com', 'px.ads.linkedin.com', 'ct.pinterest.com', 'tealiumiq.com',
  'adform.net', 'smartadserver.com', 'teads.tv', 'media.net', 'zemanta.com', 'adition.com', 'emetriq.de',
  'theadex.com', 'permutive.com', 'id5-sync.com', 'liveramp.com', 'crwdcntrl.net', 'app-measurement.com',
  'appsflyer.com', 'adjust.com', 'kochava.com'
];

const isTracker = (host) => TRACKERS.some((d) => host === d || host.endsWith('.' + d));
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const site = (h) => h.split('.').slice(-2).join('.');

function userAgent() {
  const major = process.versions.chrome.split('.')[0];
  const os = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'Windows NT 10.0; Win64; x64';
  // reduzierter Standard-Chrome-UA – verrät weder Electron noch ImmoAdv
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** Neue, rein flüchtige Sitzung (nichts wird auf die Festplatte geschrieben). */
/** Proxy-Regel: solange Tor noch keinen Port hat, zeigt sie auf einen toten Port – nichts geht direkt raus. */
// Ausnahme nur für die Google-Anmeldeseite, wenn in den Einstellungen erlaubt (gilt ab Programmstart)
const GOOGLE_DIRECT = !!store.get('googleDirect');
const GOOGLE_LOGIN_HOSTS = ['accounts.google.com', 'accounts.youtube.com'];
const proxyFor = (port) => ({
  proxyRules: `socks5://127.0.0.1:${port || 1}`,
  proxyBypassRules: ['<-loopback>', ...(GOOGLE_DIRECT ? GOOGLE_LOGIN_HOSTS : [])].join(';')
});

async function createBrowsingSession(torOn, socksPort) {
  const ses = session.fromPartition('immoadv-' + crypto.randomUUID(), { cache: false });
  if (torOn) await ses.setProxy(proxyFor(socksPort));
  ses.setUserAgent(userAgent(), 'de-DE,de;q=0.9');
  ses.setSpellCheckerEnabled(false);                       // würde Wörterbücher von Google laden
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['fullscreen', 'clipboard-sanitized-write'].includes(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => ['fullscreen', 'clipboard-sanitized-write'].includes(perm));
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_req, cb) => cb({}));

  const upgraded = new Set();
  ses.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url;
    if (!/^https?:/.test(url)) return cb({});
    const host = hostOf(url);
    const opts = store.all();

    // HTTPS-Zwang (außer .onion). Leitet ein Server trotzdem auf http zurück, wird abgebrochen statt endlos umzuleiten.
    if (opts.httpsOnly && url.startsWith('http:') && !host.endsWith('.onion') && details.resourceType === 'mainFrame') {
      const secure = 'https:' + url.slice(5);
      if (upgraded.has(secure)) return cb({ cancel: true });
      upgraded.add(secure);
      return cb({ redirectURL: secure });
    }
    // Tracker nur blockieren, wenn sie von einer fremden Seite geladen werden
    if (opts.blockTrackers && details.resourceType !== 'mainFrame' && isTracker(host)) {
      const page = hostOf(details.webContents?.getURL() || details.referrer || '');
      if (!page || site(page) !== site(host)) return cb({ cancel: true });
    }
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    delete h['X-Client-Data'];
    cb({ requestHeaders: h });
  });

  return ses;
}

/** Sicherheits-Einstellungen für jede Webansicht (Tab) */
function tabPreferences(ses) {
  return {
    session: ses,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    javascript: store.get('javaScript'),
    webviewTag: false,
    safeDialogs: true,
    navigateOnDragDrop: false,
    spellcheck: false,
    enableWebSQL: false,
    autoplayPolicy: 'document-user-activation-required',
    preload: require('node:path').join(__dirname, '..', 'preload', 'tab-preload.js'),
    nodeIntegrationInSubFrames: true      // Schutz-Skript auch in eingebetteten Frames (ohne Node-Zugriff)
  };
}

module.exports = { createBrowsingSession, tabPreferences, userAgent, hostOf, proxyFor, GOOGLE_DIRECT, GOOGLE_LOGIN_HOSTS };
