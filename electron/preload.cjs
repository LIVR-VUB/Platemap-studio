const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('native', {
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
