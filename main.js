// Terminal Plus - main process: window, shells (node-pty), shell integration, settings, session, OS integration.
const { app, BrowserWindow, ipcMain, globalShortcut, Notification, shell, clipboard, dialog, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const pty = require('@lydell/node-pty');

const USER = (f) => path.join(app.getPath('userData'), f);
const DEFAULTS = {
  theme: 'carbon',
  customThemes: {},
  opacity: 100,
  fontSize: 14,
  fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
  fontWeight: 'normal',
  lineHeight: 1.1,
  letterSpacing: 0,
  cursorStyle: 'bar',
  cursorBlink: true,
  gpu: true,
  scrollback: 10000,
  defaultProfile: null,
  startDir: '',
  newTabSameDir: true,
  restoreSession: true,
  copyOnSelect: false,
  rightClick: 'menu',
  pasteWarning: true,
  confirmClose: true,
  bell: 'notify',
  notifyLong: true,
  notifySeconds: 10,
  quakeHotkey: 'Alt+`',
  launchAtLogin: false,
  explorerMenu: false,
  alwaysOnTop: false,
  shellIntegration: true,
  // v3
  themeMode: 'fixed', themeLight: 'daylight', themeDark: 'carbon',
  accent: '',
  tabsPosition: 'top',
  mruTabs: false,
  smoothScroll: true,
  cursorTrail: false,
  cmdTimestamps: false,
  middlePaste: true,
  confirmRunning: true,
  highlight: true,
  highlightRules: [
    { re: '\\b(error|errors|fatal|failed|failure|exception|denied|refused)\\b', color: '#ff6b6b', on: true },
    { re: '\\b(warn|warning|warnings|deprecated)\\b', color: '#f2cc60', on: true },
    { re: '\\b(success|succeeded|successfully|passed|completed)\\b', color: '#3fb950', on: true },
    { re: '\\b\\d{1,3}(\\.\\d{1,3}){3}(:\\d+)?\\b', color: '#5fd7e6', on: true },
  ],
  keybindings: {},
  customProfiles: [],
  showTray: true,
  closeToTray: false,
  startHidden: false,
  quakeDropdown: false,
  quakeHeight: 50,
  quakeHideOnBlur: true,
  sshHosts: [],
  snippets: [
    { name: 'List big files', cmd: 'Get-ChildItem -Recurse -File | Sort-Object Length -Descending | Select-Object -First {{count}} FullName, Length' },
    { name: 'Git status (short)', cmd: 'git status -sb' },
    { name: 'Who is using a port', cmd: 'netstat -ano | findstr :{{port}}' },
    { name: 'Kill process by PID', cmd: 'Stop-Process -Id {{pid}}' },
  ],
  bounds: null,
};

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };

let settings;
let win;
let forceClose = false;
const ptys = new Map();
let nextPty = 1;
let profiles = [];

// ---------- shell integration ----------
// PowerShell: prompt wrapper emits OSC 133 (prompt/command/exit marks), OSC 9;9 (cwd) and the exact command line.
const PS_INTEGRATION = String.raw`
if (-not $global:__tpOn) {
  $global:__tpOn = $true
  $global:__tpPrompt = $function:prompt
  $global:__tpFirst = $true
  function global:prompt {
    $ok = $?; $code = if ($ok) { 0 } elseif ($global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 }
    $e = [char]27; $b = [char]7; $o = ''
    if (-not $global:__tpFirst) { $o += "$e]133;D;$code$b" }
    $global:__tpFirst = $false
    $loc = $executionContext.SessionState.Path.CurrentLocation
    if ($loc.Provider.Name -eq 'FileSystem') { $o += "$e]9;9;""$($loc.ProviderPath)""$b" }
    $o + "$e]133;A$b" + (& $global:__tpPrompt) + "$e]133;B$b"
  }
  if (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue) {
    $global:__tpRead = $function:PSConsoleHostReadLine
    function global:PSConsoleHostReadLine {
      $line = & $global:__tpRead
      [Console]::Write("$([char]27)]133;C;$([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($line)))$([char]7)")
      $line
    }
  }
}`;
const psEncoded = Buffer.from(PS_INTEGRATION, 'utf16le').toString('base64');
// Bash: PROMPT_COMMAND reports the exit code and the folder (as a Windows path) before each prompt.
const BASH_PC = [
  '__tp_s=$?; __tp_p=$PWD;',
  'if [[ $__tp_p =~ ^/([a-zA-Z])(/.*)?$ ]]; then __tp_p="${BASH_REMATCH[1]^^}:${BASH_REMATCH[2]:-/}"; __tp_b=\'\\\'; __tp_p=${__tp_p//\\//$__tp_b}; fi;',
  "printf '\\e]133;D;%s\\a\\e]9;9;\"%s\"\\a\\e]133;A\\a' \"$__tp_s\" \"$__tp_p\"",
].join(' ');

// PATH as Windows has it now (registry), so tools installed after Terminal Plus started work in new tabs.
function freshPath() {
  if (process.platform !== 'win32') return process.env.PATH;
  const read = (key) => {
    try {
      const out = execFileSync('reg.exe', ['query', key, '/v', 'Path'], { encoding: 'utf8', timeout: 2000, windowsHide: true });
      const m = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
      return m ? m[1].trim().replace(/%([^%]+)%/g, (s, v) => process.env[v] ?? s) : '';
    } catch { return ''; }
  };
  const merged = [read('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'), read('HKCU\\Environment'), process.env.PATH || '']
    .join(';').split(';').filter(Boolean);
  return [...new Set(merged.map((p) => p.replace(/\\$/, '')))].join(';');
}
function shellLaunch(prof) {
  const env = { ...process.env, PATH: freshPath(), TERM_PROGRAM: 'TerminalPlus', COLORTERM: 'truecolor' };
  delete env.Path; // Windows env names are case-insensitive; keep one
  let args = [...prof.args];
  if (settings.shellIntegration) {
    if (prof.kind === 'powershell') args = [...args, '-NoExit', '-EncodedCommand', psEncoded];
    if (prof.kind === 'bash') env.PROMPT_COMMAND = BASH_PC + (process.env.PROMPT_COMMAND ? '; ' + process.env.PROMPT_COMMAND : '');
    if (prof.kind === 'cmd') env.PROMPT = '$e]9;9;"$P"$e\\$e]133;A$e\\' + (process.env.PROMPT || '$P$G');
  }
  return { args, env };
}

// ---------- shell profiles ----------
// wsl.exe ships with Windows even when WSL is not installed; only list it if a distro exists.
function wslHasDistro(exe) {
  if (!fs.existsSync(exe)) return false;
  try {
    const out = execFileSync(exe, ['-l', '-q'], { timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString('utf16le').replace(/[\0\s]/g, '').length > 0;
  } catch { return false; }
}
const SAFE_DEST = /^[A-Za-z0-9_.@:\-\[\]%]+$/;
function sshConfigHosts() {
  const txt = (() => { try { return fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8'); } catch { return ''; } })();
  const hosts = [];
  for (const m of txt.matchAll(/^\s*Host\s+(.+)$/gim)) {
    for (const h of m[1].split(/\s+/)) if (h && !/[*?!]/.test(h) && SAFE_DEST.test(h) && !h.startsWith('-')) hosts.push(h);
  }
  return [...new Set(hosts)];
}
let baseProfiles = null;
function detectProfiles() {
  if (!baseProfiles) {
    baseProfiles = [];
    const add = (id, name, file, args, icon, kind) => { if (file && (!path.isAbsolute(file) || fs.existsSync(file))) baseProfiles.push({ id, name, file, args, icon, kind }); };
    if (process.platform === 'win32') {
      const sys = process.env.SystemRoot || 'C:\\Windows';
      const pf = process.env.ProgramFiles || 'C:\\Program Files';
      add('pwsh', 'PowerShell 7', path.join(pf, 'PowerShell', '7', 'pwsh.exe'), ['-NoLogo'], 'pwsh', 'powershell');
      add('powershell', 'Windows PowerShell', path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo'], 'powershell', 'powershell');
      add('cmd', 'Command Prompt', path.join(sys, 'System32', 'cmd.exe'), [], 'cmd', 'cmd');
      add('gitbash', 'Git Bash', path.join(pf, 'Git', 'bin', 'bash.exe'), ['--login', '-i'], 'bash', 'bash');
      if (wslHasDistro(path.join(sys, 'System32', 'wsl.exe'))) add('wsl', 'WSL', path.join(sys, 'System32', 'wsl.exe'), [], 'linux', 'wsl');
    } else {
      add('shell', path.basename(process.env.SHELL || 'bash'), process.env.SHELL || '/bin/bash', ['-l'], 'bash', 'bash');
    }
  }
  const sshExe = process.platform === 'win32' && fs.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe'))
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe') : 'ssh';
  const ssh = [];
  for (const h of settings.sshHosts || []) {
    if (!SAFE_DEST.test(h.dest || '') || h.dest.startsWith('-')) continue;
    const args = [];
    if (+h.port) args.push('-p', String(+h.port));
    if (h.key && fs.existsSync(h.key)) args.push('-i', h.key);
    ssh.push({ id: 'ssh:' + h.name, name: h.name, file: sshExe, args: [...args, '--', h.dest], icon: 'server', kind: 'ssh', dest: h.dest, saved: true });
  }
  for (const h of sshConfigHosts()) if (!ssh.some((s) => s.dest === h)) ssh.push({ id: 'ssh:' + h, name: h, file: sshExe, args: ['--', h], icon: 'server', kind: 'ssh', dest: h, fromConfig: true });
  const custom = [];
  for (const c of settings.customProfiles || []) {
    if (!c?.name || !c?.command) continue;
    const base = path.basename(c.command).toLowerCase().replace(/\.exe$/, '');
    const kind = ['pwsh', 'powershell'].includes(base) ? 'powershell' : base === 'cmd' ? 'cmd' : base === 'bash' ? 'bash' : base === 'wsl' ? 'wsl' : 'other';
    custom.push({ id: 'custom:' + c.name, name: c.name, file: c.command, args: splitArgs(c.args || ''), icon: c.icon || 'cmd', kind, cwd: c.cwd || '', custom: true });
  }
  profiles = [...baseProfiles, ...custom, ...ssh];
  return profiles;
}
// Split a command-line string into args, honoring double quotes.
function splitArgs(s) { return [...String(s).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]); }
// Resolve a bare command name (e.g. "python") to a full path through PATH.
function resolveCmd(file) {
  if (path.isAbsolute(file) && fs.existsSync(file)) return file;
  try { return execFileSync('where.exe', [file], { timeout: 3000, windowsHide: true, encoding: 'utf8' }).split(/\r?\n/)[0].trim() || file; } catch { return file; }
}

// ---------- window ----------
function exeLaunch() {
  // Portable builds run from a temp folder; PORTABLE_EXECUTABLE_FILE is the real .exe.
  if (app.isPackaged) return { exe: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, pre: [] };
  return { exe: process.execPath, pre: [app.getAppPath()] };
}
function argDir(argv) {
  const rest = argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'));
  for (let i = rest.length - 1; i >= 0; i--) { try { if (fs.statSync(rest[i]).isDirectory()) return path.resolve(rest[i]); } catch { /* not a dir */ } }
  return null;
}
const argVal = (argv, flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] || null : null; };
const startCwd = argDir(process.argv);
const startProfile = argVal(process.argv, '--profile');
const elevatedRun = process.argv.includes('--elevated');
const isAdmin = (() => { if (process.platform !== 'win32' || !elevatedRun) return false; try { execFileSync('net.exe', ['session'], { stdio: 'ignore', windowsHide: true, timeout: 3000 }); return true; } catch { return false; } })();
let tray = null, quitting = false;

function createWindow() {
  const b = settings.bounds || {};
  const hidden = settings.startHidden && process.argv.includes('--hidden');
  win = new BrowserWindow({
    show: !hidden,
    width: b.width || 1200, height: b.height || 760, x: b.x, y: b.y, minWidth: 560, minHeight: 360,
    frame: false,
    backgroundColor: '#00000000',
    backgroundMaterial: 'mica', // Windows 11 Mica; ignored elsewhere
    alwaysOnTop: !!settings.alwaysOnTop,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'Terminal Plus',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  if (b.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('maximize', () => win.webContents.send('win:max', true));
  win.on('unmaximize', () => win.webContents.send('win:max', false));
  win.webContents.setWindowOpenHandler(({ url }) => { openUrl(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (!dropdownMode) { settings.bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() }; saveSettings(); }
    if (settings.closeToTray && tray && !quitting && !forceClose) { e.preventDefault(); win.hide(); return; }
    if (!forceClose && !win.webContents.isDestroyed()) { e.preventDefault(); win.webContents.send('win:close-request'); }
  });
  win.on('blur', () => { if (dropdownMode && settings.quakeHideOnBlur && !win.webContents.isDevToolsOpened()) win.hide(); });
  // Self-check: TP_SHOT=out.png [TP_SHOT_JS=code] [TP_WAIT=ms] npm start -> runs code, saves a screenshot, quits.
  if (process.env.TP_SHOT) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 3500));
      if (process.env.TP_SHOT_JS) await win.webContents.executeJavaScript(process.env.TP_SHOT_JS).catch((e) => console.error('JS', e));
      await new Promise((r) => setTimeout(r, +process.env.TP_WAIT || 3500));
      fs.writeFileSync(process.env.TP_SHOT, (await win.capturePage()).toPNG());
      if (process.env.TP_LOG) fs.writeFileSync(process.env.TP_LOG, String(await win.webContents.executeJavaScript('window.__tpLog||""').catch((e) => 'ERR ' + e)));
      forceClose = true; app.quit();
    });
    win.webContents.on('console-message', (e) => { if (e.level === 'error') console.error('renderer:', e.message); });
  }
  win.on('closed', () => { for (const p of ptys.values()) p.kill(); ptys.clear(); win = null; });
}

function openUrl(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url); // only web links, never file:// or custom schemes
}

let dropdownMode = false;
function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
// Show/hide from anywhere. Drop-down mode slides the window in at the top of the screen under the mouse.
function toggleQuake() {
  if (!win) return createWindow();
  if (win.isVisible() && win.isFocused()) { win.hide(); return; }
  if (settings.quakeDropdown) {
    if (!dropdownMode && !win.isMaximized()) { settings.bounds = { ...win.getNormalBounds(), maximized: false }; saveSettings(); }
    dropdownMode = true;
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    if (win.isMaximized()) win.unmaximize();
    win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: Math.round(wa.height * Math.min(100, Math.max(20, settings.quakeHeight)) / 100) });
    win.setAlwaysOnTop(true);
  } else if (dropdownMode) {
    dropdownMode = false;
    win.setAlwaysOnTop(!!settings.alwaysOnTop);
    if (settings.bounds) win.setBounds(settings.bounds);
  }
  showWindow();
}
function registerQuake() {
  globalShortcut.unregisterAll();
  if (!settings.quakeHotkey) return;
  try { globalShortcut.register(settings.quakeHotkey, toggleQuake); } catch { /* invalid accelerator: ignore */ }
}
function setupTray() {
  if (!settings.showTray) { tray?.destroy(); tray = null; return; }
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Terminal Plus');
  tray.on('click', () => (win?.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Terminal Plus', click: showWindow },
    { label: 'New tab', click: () => { showWindow(); win?.webContents.send('open-tab', {}); } },
    { label: 'Drop-down terminal', click: toggleQuake },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; showWindow(); win?.close(); } },
  ]));
}

// "Open in Terminal Plus" on folder right-click (per-user registry keys, no admin needed).
function setExplorerMenu(on) {
  if (process.platform !== 'win32') return;
  const { exe, pre } = exeLaunch();
  const cmd = [exe, ...pre].map((a) => `"${a}"`).join(' ');
  for (const [base, arg] of [['HKCU\\Software\\Classes\\Directory\\Background\\shell\\TerminalPlus', '%V'], ['HKCU\\Software\\Classes\\Directory\\shell\\TerminalPlus', '%1']]) {
    if (on) {
      execFile('reg.exe', ['add', base, '/ve', '/d', 'Open in Terminal Plus', '/f'], { windowsHide: true });
      execFile('reg.exe', ['add', base, '/v', 'Icon', '/d', exe, '/f'], { windowsHide: true });
      execFile('reg.exe', ['add', base + '\\command', '/ve', '/d', `${cmd} "${arg}"`, '/f'], { windowsHide: true });
    } else {
      execFile('reg.exe', ['delete', base, '/f'], { windowsHide: true });
    }
  }
}
function applySideEffects(p) {
  if ('quakeHotkey' in p) registerQuake();
  if ('alwaysOnTop' in p) win?.setAlwaysOnTop(!!settings.alwaysOnTop);
  if ('explorerMenu' in p) setExplorerMenu(!!settings.explorerMenu);
  if (('launchAtLogin' in p || 'startHidden' in p) && process.platform === 'win32') {
    const { exe, pre } = exeLaunch();
    app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin, path: exe, args: [...pre, '--hidden'] });
  }
  if ('showTray' in p) setupTray();
}

function saveSettings() { if (!elevatedRun) writeJson(USER('settings.json'), settings); } // admin windows never overwrite the normal settings

// An elevated window is a separate instance with its own lock-free lifetime.
if (!elevatedRun && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    showWindow();
    win.webContents.send('open-tab', { cwd: argDir(argv), profile: argVal(argv, '--profile') });
  });
  app.whenReady().then(() => {
    settings = { ...DEFAULTS, ...readJson(USER('settings.json'), {}) };
    detectProfiles();
    createWindow();
    registerQuake();
    setupTray();
  });
}
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

// ---------- IPC: window ----------
ipcMain.on('win:min', () => win?.minimize());
ipcMain.on('win:max', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.on('win:close', () => win?.close());
ipcMain.on('win:force-close', () => { forceClose = true; win?.close(); });
ipcMain.on('win:fullscreen', () => win?.setFullScreen(!win.isFullScreen()));
ipcMain.on('open-url', (_e, url) => openUrl(url));
ipcMain.on('notify', (_e, title, body) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') });
  n.on('click', () => { win?.show(); win?.focus(); });
  n.show();
});
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.on('clip:write', (_e, t) => clipboard.writeText(String(t)));

// ---------- IPC: files / folders ----------
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
ipcMain.on('open-folder', (_e, p) => { if (typeof p === 'string' && isDir(p)) shell.openPath(p); });
ipcMain.on('reveal', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(path.resolve(p)); }); // reveal only, never execute
ipcMain.handle('git-branch', (_e, dir) => {
  if (typeof dir !== 'string' || !isDir(dir)) return null;
  for (let d = path.resolve(dir), i = 0; i < 40; i++) {
    const g = path.join(d, '.git');
    try {
      let gitDir = g;
      if (fs.statSync(g).isFile()) gitDir = path.resolve(d, fs.readFileSync(g, 'utf8').replace(/^gitdir:\s*/, '').trim());
      const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
      return head.startsWith('ref:') ? head.replace(/^ref:\s*refs\/heads\//, '') : head.slice(0, 7);
    } catch { /* keep walking up */ }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
});
ipcMain.handle('save-text', async (_e, name, text) => {
  const ext = path.extname(String(name)).slice(1) || 'txt';
  const filters = ext === 'cast' ? [{ name: 'Terminal recording (asciinema)', extensions: ['cast'] }]
    : ext === 'json' ? [{ name: 'JSON', extensions: ['json'] }] : [{ name: 'Text', extensions: ['txt', 'log'] }];
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, String(text));
  return r.filePath;
});
ipcMain.handle('open-json', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return readJson(r.filePaths[0], null);
});
// Desktop shortcut that opens Terminal Plus straight into one shell profile.
ipcMain.handle('desktop-shortcut', (_e, profileId) => {
  const prof = profiles.find((p) => p.id === profileId);
  if (!prof || process.platform !== 'win32') return null;
  const { exe, pre } = exeLaunch();
  const file = path.join(app.getPath('desktop'), `Terminal Plus - ${prof.name.replace(/[\\/:*?"<>|]/g, '')}.lnk`);
  const ok = shell.writeShortcutLink(file, 'create', { target: exe, args: [...pre.map((a) => `"${a}"`), '--profile', `"${prof.id}"`].join(' '), icon: exe, iconIndex: 0, description: `Terminal Plus: ${prof.name}` });
  return ok ? file : null;
});
// New elevated window (Windows shows its UAC prompt).
ipcMain.on('open-admin', () => {
  if (process.platform !== 'win32') return;
  const { exe, pre } = exeLaunch();
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const argList = [...pre.map((a) => `"${a}"`), '--elevated'].map(q).join(',');
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${q(exe)} -ArgumentList ${argList} -Verb RunAs`], { windowsHide: true });
});
// Power-ups: which tools are on PATH, which PowerShell modules are installed.
ipcMain.handle('tools:which', async (_e, names) => {
  if (!Array.isArray(names)) return {};
  const env = { ...process.env, PATH: freshPath() };
  const one = (n) => new Promise((res) => {
    if (!/^[\w.-]+$/.test(n)) return res([n, null]);
    execFile('where.exe', [n], { env, timeout: 4000, windowsHide: true }, (err, out) => res([n, err ? null : String(out).split(/\r?\n/)[0].trim()]));
  });
  return Object.fromEntries(await Promise.all(names.slice(0, 80).map(one)));
});
ipcMain.handle('tools:psmodules', () => new Promise((res) => {
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Module -ListAvailable | ForEach-Object { $_.Name + " " + $_.Version }'],
    { timeout: 15000, windowsHide: true, maxBuffer: 4 << 20 }, (err, out) => {
      const mods = {};
      for (const l of String(out || '').split(/\r?\n/)) { const [n, v] = l.trim().split(' '); if (n && (!mods[n] || v > mods[n])) mods[n] = v; }
      res(mods);
    });
}));
const loadWs = () => readJson(USER('workspaces.json'), {});
ipcMain.handle('ws:get', () => loadWs());
ipcMain.handle('ws:set', (_e, name, data) => {
  if (typeof name !== 'string' || !name.trim()) return loadWs();
  const ws = loadWs();
  if (data) ws[name.trim().slice(0, 60)] = { ...data, t: Date.now() }; else delete ws[name];
  writeJson(USER('workspaces.json'), ws);
  return ws;
});

// ---------- IPC: settings / session / history ----------
ipcMain.handle('settings:get', () => ({ settings, profiles: detectProfiles(), home: os.homedir(), startCwd, startProfile, platform: process.platform, admin: isAdmin, elevated: elevatedRun }));
ipcMain.handle('settings:export', async () => {
  const { bounds, ...rest } = settings;
  const r = await dialog.showSaveDialog(win, { defaultPath: 'terminal-plus-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(rest, null, 2));
  return r.filePath;
});
ipcMain.handle('settings:import', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const data = readJson(r.filePaths[0], null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Not a Terminal Plus settings file');
  const patch = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (k === 'bounds' || !(k in data)) continue;
    if (DEFAULTS[k] === null || typeof data[k] === typeof DEFAULTS[k]) patch[k] = data[k]; // only known keys of the right type
  }
  settings = { ...settings, ...patch };
  saveSettings();
  applySideEffects(patch);
  return { settings, profiles: detectProfiles() };
});
ipcMain.handle('settings:set', (_e, patch) => {
  settings = { ...settings, ...patch };
  saveSettings();
  applySideEffects(patch);
  return { settings, profiles: detectProfiles() };
});
ipcMain.handle('session:load', () => readJson(USER('session.json'), null));
ipcMain.on('session:save', (e, data) => { try { writeJson(USER('session.json'), data); } catch { /* disk full etc. */ } e.returnValue = true; });
let history = null, histTimer = null;
const loadHistory = () => (history ??= readJson(USER('history.json'), []));
ipcMain.handle('history:get', () => loadHistory());
ipcMain.on('history:add', (_e, item) => {
  if (!item || typeof item.cmd !== 'string' || !item.cmd.trim() || item.cmd.length > 4000) return;
  const h = loadHistory();
  const i = h.findIndex((x) => x.cmd === item.cmd);
  if (i >= 0) h.splice(i, 1);
  h.push({ cmd: item.cmd, cwd: item.cwd || null, shell: item.shell || null, exit: item.exit ?? null, t: Date.now() });
  if (h.length > 3000) h.splice(0, h.length - 3000);
  clearTimeout(histTimer);
  histTimer = setTimeout(() => writeJson(USER('history.json'), h), 1000);
});
ipcMain.on('history:clear', () => { history = []; writeJson(USER('history.json'), []); });
ipcMain.on('history:remove', (_e, cmd) => {
  const h = loadHistory();
  const i = h.findIndex((x) => x.cmd === cmd);
  if (i >= 0) { h.splice(i, 1); writeJson(USER('history.json'), h); }
});

// ---------- IPC: shells ----------
ipcMain.handle('pty:create', (e, { profileId, cols, rows, cwd }) => {
  const prof = profiles.find((p) => p.id === profileId) || profiles[0];
  if (!prof) throw new Error('No shell found on this system');
  const id = nextPty++;
  const { args, env } = shellLaunch(prof);
  const dir = [cwd, prof.cwd, settings.startDir].find((d) => d && isDir(d)) || os.homedir();
  const p = pty.spawn(prof.custom ? resolveCmd(prof.file) : prof.file, args, { name: 'xterm-256color', cols: cols || 80, rows: rows || 24, cwd: dir, env, useConpty: true });
  ptys.set(id, p);
  const sender = e.sender;
  p.onData((d) => { if (!sender.isDestroyed()) sender.send('pty:data', id, d); });
  p.onExit(({ exitCode }) => { ptys.delete(id); if (!sender.isDestroyed()) sender.send('pty:exit', id, exitCode); });
  return { id, cwd: dir };
});
ipcMain.on('pty:write', (_e, id, data) => ptys.get(id)?.write(data));
ipcMain.on('pty:resize', (_e, id, cols, rows) => { try { ptys.get(id)?.resize(Math.max(cols, 2), Math.max(rows, 1)); } catch { /* pty gone */ } });
ipcMain.on('pty:kill', (_e, id) => { ptys.get(id)?.kill(); ptys.delete(id); });
