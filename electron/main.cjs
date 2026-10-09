const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs/promises')

let win
const isMac = process.platform === 'darwin'
// Project file passed on the command line (Windows/Linux double-click) or via macOS open-file.
let pendingFile = process.argv.slice(1).find((a) => a.endsWith('.platemap'))

async function sendFile(file) {
  try { win.webContents.send('file:opened', { path: file, text: await fs.readFile(file, 'utf8') }) } catch { /* unreadable: ignore */ }
}

app.on('open-file', (e, file) => {
  e.preventDefault()
  if (win && !win.webContents.isLoading()) sendFile(file)
  else pendingFile = file
})

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    // macOS keeps its native traffic-light buttons; elsewhere the app draws its own.
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 11 } } : { frame: false }),
    backgroundColor: '#1b1c1f',
    title: 'PlateMap Studio',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  })
  if (process.env.VITE_DEV) win.loadURL('http://localhost:5173')
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  win.webContents.on('did-finish-load', () => { if (pendingFile) { sendFile(pendingFile); pendingFile = null } })
  win.on('maximize', () => win.webContents.send('win:maximized', true))
  win.on('unmaximize', () => win.webContents.send('win:maximized', false))
}

ipcMain.on('win:min', () => win.minimize())
ipcMain.on('win:max', () => (win.isMaximized() ? win.unmaximize() : win.maximize()))
ipcMain.on('win:close', () => win.close())

// data: string (utf8) or {base64}
ipcMain.handle('file:save', async (_e, { defaultPath, filters, data }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath, filters })
  if (r.canceled || !r.filePath) return null
  await fs.writeFile(r.filePath, typeof data === 'string' ? data : Buffer.from(data.base64, 'base64'))
  return r.filePath
})

ipcMain.handle('file:open', async (_e, { filters }) => {
  const r = await dialog.showOpenDialog(win, { filters, properties: ['openFile'] })
  if (r.canceled || !r.filePaths[0]) return null
  return { path: r.filePaths[0], text: await fs.readFile(r.filePaths[0], 'utf8') }
})

ipcMain.handle('dir:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose folder for platemap files' })
  return r.canceled ? null : r.filePaths[0]
})

// Write several files into one folder; without overwrite, report existing names instead of clobbering them.
ipcMain.handle('files:write', async (_e, { dir, files, overwrite }) => {
  const names = files.map((f) => path.basename(f.name))
  if (!overwrite) {
    const exists = []
    for (const n of names) if (await fs.access(path.join(dir, n)).then(() => true, () => false)) exists.push(n)
    if (exists.length) return { written: [], exists }
  }
  for (let i = 0; i < files.length; i++) await fs.writeFile(path.join(dir, names[i]), files[i].data)
  return { written: names, exists: [] }
})

// Vector PDF: render SVG pages in a hidden window and use Chromium's PDF printer.
ipcMain.handle('pdf:render', async (_e, { pages, widthIn, heightIn }) => {
  const html = `<!doctype html><html><head><style>
    @page { size: ${widthIn}in ${heightIn}in; margin: 0 }
    html,body { margin:0; padding:0 }
    .p { width:${widthIn}in; height:${heightIn}in; page-break-after:always; display:flex; align-items:center; justify-content:center; overflow:hidden }
    .p:last-child { page-break-after:auto }
    .p svg { width:100%; height:100% }
  </style></head><body>${pages.map((s) => `<div class="p">${s}</div>`).join('')}</body></html>`
  const pdfWin = new BrowserWindow({ show: false })
  await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const buf = await pdfWin.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    margins: { marginType: 'none' },
  })
  pdfWin.destroy()
  return buf.toString('base64')
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
