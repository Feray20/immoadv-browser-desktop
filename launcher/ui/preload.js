const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('immo', {
  onProgress: (cb) => ipcRenderer.on('progress', (_e, d) => cb(d)),
  retry: () => ipcRenderer.invoke('retry'),
  info: () => ipcRenderer.invoke('info')
});
