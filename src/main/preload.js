// Schmale, sichere Brücke zwischen Fenster und Programm (keine Node-Funktionen im Fenster)
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('immo', {
  state: call('state'),
  installChrome: call('install-chrome'),
  openExtensions: call('open-extensions'),
  copy: call('copy'),
  openBrowser: call('open-browser'),
  finishSetup: call('finish-setup'),
  setDns: call('set-dns'),
  setAutoUpdate: call('set-auto-update'),
  updateCheck: call('update-check'),
  updateDownload: call('update-download'),
  updateInstall: call('update-install'),
  close: call('close'),
  on: (ch, fn) => {
    if (!['view', 'update', 'install-progress'].includes(ch)) return;
    ipcRenderer.on(ch, (_e, d) => fn(d));
  }
});
