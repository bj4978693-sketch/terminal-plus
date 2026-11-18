const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, ...a) => cb(...a));

contextBridge.exposeInMainWorld('tp', {
  win: {
    min: () => ipcRenderer.send('win:min'), max: () => ipcRenderer.send('win:max'), close: () => ipcRenderer.send('win:close'),
    forceClose: () => ipcRenderer.send('win:force-close'), fullscreen: () => ipcRenderer.send('win:fullscreen'),
    admin: () => ipcRenderer.send('open-admin'),
    onMax: on('win:max'), onCloseRequest: on('win:close-request'), onOpenTab: on('open-tab'),
  },
  openUrl: (u) => ipcRenderer.send('open-url', u),
  openFolder: (p) => ipcRenderer.send('open-folder', p),
  reveal: (p) => ipcRenderer.send('reveal', p),
  gitBranch: (d) => ipcRenderer.invoke('git-branch', d),
  saveText: (name, text) => ipcRenderer.invoke('save-text', name, text),
  desktopShortcut: (id) => ipcRenderer.invoke('desktop-shortcut', id),
  pathForFile: (f) => webUtils.getPathForFile(f),
  notify: (t, b) => ipcRenderer.send('notify', t, b),
  clip: { read: () => ipcRenderer.invoke('clip:read'), write: (t) => ipcRenderer.send('clip:write', t) },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'), set: (p) => ipcRenderer.invoke('settings:set', p),
    export: () => ipcRenderer.invoke('settings:export'), import: () => ipcRenderer.invoke('settings:import'),
  },
  session: { load: () => ipcRenderer.invoke('session:load'), save: (d) => ipcRenderer.sendSync('session:save', d) },
  workspaces: { get: () => ipcRenderer.invoke('ws:get'), set: (n, d) => ipcRenderer.invoke('ws:set', n, d) },
  history: {
    get: () => ipcRenderer.invoke('history:get'), add: (i) => ipcRenderer.send('history:add', i),
    clear: () => ipcRenderer.send('history:clear'), remove: (c) => ipcRenderer.send('history:remove', c),
  },
  pty: {
    create: (o) => ipcRenderer.invoke('pty:create', o),
    write: (id, d) => ipcRenderer.send('pty:write', id, d),
    resize: (id, c, r) => ipcRenderer.send('pty:resize', id, c, r),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: on('pty:data'), onExit: on('pty:exit'),
  },
});
