const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,

  /** Tell main we're ready; resolves with a file to open at launch (or null). */
  ready: () => ipcRenderer.invoke('renderer-ready'),

  /** Subscribe to files opened after launch (double-click / menu / dialog). */
  onOpenFile: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('open-file', handler)
    return () => ipcRenderer.removeListener('open-file', handler)
  },

  /** Subscribe to native-menu commands (new / save / save-as / sample). */
  onMenu: (cb) => {
    const handler = (_e, action) => cb(action)
    ipcRenderer.on('menu', handler)
    return () => ipcRenderer.removeListener('menu', handler)
  },

  /** Subscribe to window maximize/unmaximize state changes. */
  onWindowState: (cb) => {
    const handler = (_e, state) => cb(state)
    ipcRenderer.on('window-state', handler)
    return () => ipcRenderer.removeListener('window-state', handler)
  },

  /** Subscribe to external (on-disk) changes of the currently open file. */
  onFileChanged: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('file-changed', handler)
    return () => ipcRenderer.removeListener('file-changed', handler)
  },

  setDirty: (dirty, path) => ipcRenderer.send('document-state', { dirty, path }),
  confirmClose: () => ipcRenderer.send('confirm-close'),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  saveFile: (path, content, expected) => ipcRenderer.invoke('save-file', { path, content, expected }),
  saveFileAs: (content, suggestedName) =>
    ipcRenderer.invoke('save-file-as', { content, suggestedName }),

  /** Best-effort: register YAML Studio as the default handler for .yaml/.yml. */
  setDefaultYaml: () => ipcRenderer.invoke('set-default-yaml'),

  windowControl: (action) => ipcRenderer.send('window-control', action),
})
