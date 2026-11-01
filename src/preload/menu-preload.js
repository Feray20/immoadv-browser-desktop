// Schnittstelle für das ImmoAdv-Menü (eigene Ebene über Fenster und Webseite)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fadeMenu', {
  onShow: (cb) => ipcRenderer.on('menu:show', (_e, d) => cb(d)),
  size: (w, h) => ipcRenderer.send('menu:size', { w, h }),
  pick: (id) => ipcRenderer.send('menu:pick', id),
  close: () => ipcRenderer.send('menu:close')
});
