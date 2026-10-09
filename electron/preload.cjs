const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('native', {
  platform: process.platform,
  onFileOpened: (cb) => ipcRenderer.on('file:opened', (_e, f) => cb(f)),
  minimize: () => ipcRenderer.send('win:min'),
  maximize: () => ipcRenderer.send('win:max'),
  close: () => ipcRenderer.send('win:close'),
  onMaximized: (cb) => ipcRenderer.on('win:maximized', (_e, v) => cb(v)),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  renderPdf: (opts) => ipcRenderer.invoke('pdf:render', opts),
  pickDir: () => ipcRenderer.invoke('dir:pick'),
  writeFiles: (opts) => ipcRenderer.invoke('files:write', opts),
})
