// Schmale, feste Schnittstelle zwischen Fenster-Oberfläche und Hauptprozess.
const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(ch, h); return () => ipcRenderer.off(ch, h); };
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const snd = (ch) => (...a) => ipcRenderer.send(ch, ...a);

contextBridge.exposeInMainWorld('immo', {
  state: inv('state'),
  layout: snd('layout'),
  menu: snd('menu'),
  // Navigation & Tabs
  navigate: snd('navigate'), newTab: snd('tab:new'), selectTab: snd('tab:select'), closeTab: snd('tab:close'),
  pinTab: snd('tab:pin'), duplicateTab: snd('tab:duplicate'), moveTab: snd('tab:move'), tabToWorkspace: snd('tab:toWorkspace'),
  closeOthers: snd('tab:closeOthers'), tabMenu: snd('tab:menu'), split: snd('tab:split'), tabPreview: inv('tab:preview'),
  nav: snd('nav'), reopenTab: snd('reopen-tab'), find: (text, forward, next) => ipcRenderer.send('find', { text, forward, next }), findStop: snd('find-stop'),
  zoom: snd('zoom'), translate: snd('translate'), devtools: snd('devtools'), print: snd('print'), pageText: inv('page:text'),
  // Arbeitsbereiche, Verlauf, Lesezeichen
  selectWorkspace: snd('ws:select'), saveWorkspaces: inv('ws:save'),
  historySearch: inv('history:search'), suggest: inv('history:suggest'), historyRemove: inv('history:remove'), historyClear: inv('history:clear'),
  importBookmarks: inv('bookmarks:import'), exportBookmarks: inv('bookmarks:export'),
  // Passwörter
  pwSave: inv('pw:save'), pwDismiss: inv('pw:dismiss'), pwFill: inv('pw:fill'), pwList: inv('pw:list'), pwReveal: inv('pw:reveal'),
  pwDelete: inv('pw:delete'), pwImport: inv('pw:import'), pwTestUnlock: inv('pw:test-unlock'),
  // NordVPN & Schutz
  vpnLogin: inv('vpn:login'), vpnLogout: inv('vpn:logout'), vpnCountry: inv('vpn:country'),
  allowBlocked: snd('blocked:allow'), refreshLists: inv('lists:refresh'), clearSiteData: inv('site-data:clear'),
  permissions: inv('permissions:list'), resetPermissions: inv('permissions:reset'),
  // KI
  aiConfig: inv('ai:config'), aiSetKey: inv('ai:setKey'), aiAsk: inv('ai:ask'), aiStop: snd('ai:stop'),
  aiConversations: inv('ai:conversations'), aiConversation: inv('ai:conversation'), aiDelete: inv('ai:delete'), aiDeleteAll: inv('ai:deleteAll'), aiExport: inv('ai:export'),
  // Immobilien-Werkzeuge
  summary: inv('summary'), watchAdd: inv('watch:add'), watchRemove: inv('watch:remove'), copyCleanLink: inv('link:copy'), screenshot: inv('screenshot'),
  saveReport: (html, fileName) => ipcRenderer.invoke('report:save', { html, fileName }),
  // Downloads & PDF
  downloads: inv('downloads:list'), showDownload: snd('downloads:show'), openDownload: snd('downloads:open'), cancelDownload: snd('downloads:cancel'), clearDownloads: snd('downloads:clear'),
  chooseDownloadDir: inv('downloadDir:choose'), useDefaultDownloadDir: inv('downloadDir:default'), openDownloadDir: inv('downloadDir:open'),
  openPDF: snd('pdf:open'), savePDF: snd('pdf:save'),
  // Einstellungen & Updates
  setSettings: inv('settings:set'),
  checkUpdate: inv('update:check'), updateNow: inv('update:now'), setAutoUpdate: inv('update:auto'), showUpdateLog: inv('update:log'),
  // Ereignisse
  onTabs: on('tabs'), onUpdate: on('update'), onVpn: on('vpn'), onBlocker: on('blocker'), onDownloads: on('downloads'), onOnline: on('online'),
  onToast: on('toast'), onFindOpen: on('find-open'), onFindResult: on('find-result'), onFocusAddress: on('focus-address'),
  onOpenPanel: on('open-panel'), onPaletteOpen: on('palette-open'), onToggleBookmarkBar: on('toggle-bookmarkbar'), onBookmarkCurrent: on('bookmark-current'),
  onScreenshot: on('screenshot'), onTts: on('tts'), onAiPrompt: on('ai-prompt'),
  onAiChunk: on('ai:chunk'), onAiDone: on('ai:done'), onAiError: on('ai:error')
});
