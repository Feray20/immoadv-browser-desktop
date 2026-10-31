// Schmale, feste Schnittstelle zwischen Fenster-Oberfläche und Hauptprozess.
const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(ch, h); return () => ipcRenderer.off(ch, h); };

contextBridge.exposeInMainWorld('immo', {
  state: () => ipcRenderer.invoke('state'),
  layout: (l) => ipcRenderer.send('layout', l),
  navigate: (input) => ipcRenderer.send('navigate', input),
  newTab: (url) => ipcRenderer.send('tab:new', url),
  selectTab: (id) => ipcRenderer.send('tab:select', id),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  nav: (cmd) => ipcRenderer.send('nav', cmd),
  newIdentity: () => ipcRenderer.send('identity'),
  openPDF: () => ipcRenderer.send('pdf:open'),
  savePDF: () => ipcRenderer.send('pdf:save'),
  openExternal: () => ipcRenderer.send('open-external'),
  menu: () => ipcRenderer.send('menu'),
  clearAll: () => ipcRenderer.send('clear-all'),
  chooseDownloadDir: () => ipcRenderer.invoke('downloadDir:choose'),
  useDefaultDownloadDir: () => ipcRenderer.invoke('downloadDir:default'),
  openDownloadDir: () => ipcRenderer.invoke('downloadDir:open'),
  setSettings: (obj) => ipcRenderer.invoke('settings:set', obj),
  saveReport: (html, fileName) => ipcRenderer.invoke('report:save', { html, fileName }),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  setAutoUpdate: (on) => ipcRenderer.invoke('update:auto', on),
  onUpdate: on('update'),
  find: (text, forward, next) => ipcRenderer.send('find', { text, forward, next }),
  findStop: () => ipcRenderer.send('find-stop'),
  zoom: (step) => ipcRenderer.send('zoom', step),
  reopenTab: () => ipcRenderer.send('reopen-tab'),
  clearFrequent: () => ipcRenderer.invoke('frequent:clear'),
  onFrequent: on('frequent'),
  onFindOpen: on('find-open'),
  onFindResult: on('find-result'),
  onToggleBookmarkBar: on('toggle-bookmarkbar'),
  onTabs: on('tabs'),
  onTor: on('tor'),
  onToast: on('toast'),
  onFocusAddress: on('focus-address'),
  onOpenPanel: on('open-panel')
});
