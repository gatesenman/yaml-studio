const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { allowedExternal, validContent, validSenderURL } = require('./security.cjs')
const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
const devURL = process.env.VITE_DEV_SERVER_URL
if (devURL && !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(devURL)) throw new Error('Invalid local development URL')
const trustedURL = devURL || pathToFileURL(indexPath).href
let mainWindow, rendererReady = false, pendingOpenPath = null, dirty = false, closingApproved = false
let currentPath = null, baseline = null, watcher = null, authorityVersion = 0, saveInProgress = false
const grants = new Set()
const recentPath = () => path.join(app.getPath('userData'), 'recent-files.json')
function recent() {
  try { const a = JSON.parse(fs.readFileSync(recentPath(), 'utf8')); return Array.isArray(a) ? a.filter(r => typeof r.path === 'string' && typeof r.name === 'string').slice(0,10) : [] }
  catch { return [] }
}
function addRecent(p) {
  try { fs.writeFileSync(recentPath(), JSON.stringify([{ path: p, name: path.basename(p) }, ...recent().filter(r => r.path !== p)].slice(0,10))) } catch { /* non-fatal */ }
  buildMenu()
}
function read(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('无效路径')
  const stat = fs.statSync(p)
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('文件超过 2 MB 或不是普通文件')
  return fs.readFileSync(p, 'utf8')
}
function setCurrent(p) {
  authorityVersion++
  if (watcher) clearInterval(watcher)
  currentPath = p && grants.has(p) ? p : null
  baseline = currentPath ? read(currentPath) : null
  if (!currentPath) return
  watcher = setInterval(() => {
    try {
      const content = read(currentPath)
      if (content !== baseline) { baseline = content; mainWindow?.webContents.send('file-changed', { path: currentPath, content }) }
    } catch { /* Saving will report a removed/unreadable file without losing the editor. */ }
  }, 1000)
}
function sendOpen(p) {
  try { const content = read(p); grants.add(p); mainWindow.webContents.send('open-file', { path: p, content }); addRecent(p) }
  catch { mainWindow?.webContents.send('menu', 'file-error') }
}
function fileArg(argv) { return argv.slice(1).find(a => typeof a === 'string' && /\.ya?ml$/i.test(a) && path.isAbsolute(a) && fs.existsSync(a)) || null }
function menu(action) { mainWindow?.webContents.send('menu', action) }
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => menu('new') },
      { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => menu('open') },
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => menu('save') },
      { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => menu('save-as') },
      { label: '最近打开', submenu: recent().length ? recent().map(r => ({ label: r.name, sublabel: r.path, click: () => sendOpen(r.path) })) : [{ label: '（暂无）', enabled: false }] },
      { type: 'separator' }, { label: '退出', click: () => mainWindow?.close() },
    ] },
    { label: '编辑', submenu: [ { label: '撤销', click: () => menu('undo') }, { label: '重做', click: () => menu('redo') }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' } ] },
    { label: '视图', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }, ...(devURL ? [{ role: 'toggleDevTools', label: '开发者工具' }] : [])] },
  ]))
}
// All privileged IPC requires the main frame of this exact application page.
function trusted(e) {
  if (!mainWindow || e.sender !== mainWindow.webContents || e.senderFrame !== mainWindow.webContents.mainFrame || !validSenderURL(e.senderFrame.url, trustedURL)) throw new Error('拒绝不可信 IPC 来源')
}
function handle(channel, fn) { ipcMain.handle(channel, (e, payload) => { trusted(e); return fn(payload) }) }
handle('renderer-ready', () => {
  rendererReady = true
  if (!pendingOpenPath) return null
  const p = pendingOpenPath; pendingOpenPath = null
  try { const content = read(p); grants.add(p); addRecent(p); return { path: p, content } } catch { menu('file-error'); return null }
})
handle('open-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: '打开 YAML 文件', properties: ['openFile'], filters: [{ name: 'YAML', extensions: ['yaml','yml'] }] })
  if (!result.canceled && result.filePaths[0]) sendOpen(result.filePaths[0])
})
function write(p, content) {
  if (!validContent(content)) throw new Error('无效内容或超过 2 MB')
  // Keep existing file permissions; never replace a symlink or remove an unowned temp.
  let mode = 0o600
  try {
    const stat = fs.lstatSync(p)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('不支持覆盖符号链接或非普通文件，请另存为普通文件。')
    mode = stat.mode & 0o777
  } catch (e) { if (e.code !== 'ENOENT') throw e }
  const temp = `${p}.${process.pid}.${randomUUID()}.yamlstudio-tmp`
  let fd = null, created = false
  try {
    fd = fs.openSync(temp, 'wx', mode); created = true
    fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = null
    fs.renameSync(temp, p)
  } finally {
    if (fd !== null) fs.closeSync(fd)
    if (created && fs.existsSync(temp)) fs.unlinkSync(temp)
  }
  grants.add(p); setCurrent(p); addRecent(p)
  return { ok: true, path: p }
}
function handleSave(channel, fn) {
  handle(channel, async payload => {
    if (saveInProgress) return { ok: false, error: '已有保存正在进行，请稍后重试。' }
    saveInProgress = true
    try { return await fn(payload) } finally { saveInProgress = false }
  })
}
handleSave('save-file', async (payload) => {
  try {
    if (!payload || payload.path !== currentPath || !grants.has(payload.path)) throw new Error('路径未授权，请另存为')
    const version = authorityVersion
    const observed = read(payload.path)
    if (observed !== payload.expected) {
      const res = await dialog.showMessageBox(mainWindow, { type: 'warning', message: '磁盘文件已变化。是否使用当前编辑内容覆盖？', buttons: ['取消', '覆盖'], defaultId: 0, cancelId: 0 })
      if (res.response !== 1) return { ok: false, canceled: true }
      if (version !== authorityVersion || payload.path !== currentPath) throw new Error('工作区已变化，旧保存已取消。')
      if (read(payload.path) !== observed) throw new Error('确认期间磁盘文件再次变化，未覆盖。请重新保存并检查冲突。')
    }
    return write(payload.path, payload.content)
  } catch (e) { return { ok: false, error: String(e) } }
})
handleSave('save-file-as', async (payload) => {
  try {
    if (!payload || !validContent(payload.content)) throw new Error('无效内容或超过 2 MB')
    const version = authorityVersion
    const result = await dialog.showSaveDialog(mainWindow, { title: '另存为', defaultPath: path.basename(payload.suggestedName || 'untitled.yaml'), filters: [{ name: 'YAML', extensions: ['yaml','yml'] }] })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    if (version !== authorityVersion) throw new Error('工作区已变化，旧另存为已取消。')
    return write(result.filePath, payload.content)
  } catch (e) { return { ok: false, error: String(e) } }
})
handle('set-default-yaml', async () => {
  if (process.platform !== 'win32') return { ok: false, error: '仅支持 Windows。' }
  await shell.openExternal('ms-settings:defaultapps')
  return { ok: true }
})
function authorized(e) { try { trusted(e); return true } catch { return false } }
ipcMain.on('document-state', (e, payload) => { if (!authorized(e)) return; dirty = payload?.dirty === true; if (payload?.path !== currentPath) { try { setCurrent(payload?.path) } catch { setCurrent(null) } } })
ipcMain.on('confirm-close', (e) => { if (!authorized(e)) return; closingApproved = true; mainWindow.close() })
ipcMain.on('window-control', (e, action) => {
  if (!authorized(e)) return
  if (action === 'close') mainWindow.close()
  else if (action === 'minimize') mainWindow.minimize()
  else if (action === 'maximize') { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize() }
})
function createWindow() {
  rendererReady = false; closingApproved = false
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 1000, minHeight: 640, show: false, frame: false, backgroundColor: '#111722', webPreferences: { preload: path.join(__dirname,'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  for (const event of ['maximize','unmaximize']) mainWindow.on(event, () => mainWindow.webContents.send('window-state', { maximized: mainWindow.isMaximized() }))
  mainWindow.on('close', e => { if (dirty && !closingApproved) { e.preventDefault(); menu('close-request') } })
  mainWindow.webContents.on('will-prevent-unload', e => { if (closingApproved) e.preventDefault() })
  mainWindow.webContents.on('will-navigate', (e, url) => { if (!validSenderURL(url,trustedURL)) e.preventDefault() })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (allowedExternal(url)) void shell.openExternal(url); return { action: 'deny' } })
  mainWindow.webContents.session.setPermissionRequestHandler((_wc,_permission,callback) => callback(false))
  if (devURL) mainWindow.loadURL(devURL); else mainWindow.loadFile(indexPath)
  buildMenu()
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  pendingOpenPath = fileArg(process.argv)
  app.on('second-instance', (_e, argv) => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); const p = fileArg(argv); if (p) { if (rendererReady) sendOpen(p); else pendingOpenPath = p } } })
  app.on('open-file', (e,p) => { e.preventDefault(); if (rendererReady && mainWindow) sendOpen(p); else pendingOpenPath = p })
  app.whenReady().then(createWindow)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}
app.on('window-all-closed', () => { if (watcher) clearInterval(watcher); if (process.platform !== 'darwin') app.quit() })
