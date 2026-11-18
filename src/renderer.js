// Terminal Plus - renderer: tabs, resizable split panes, shell integration, palette, history, snippets, SSH, session restore.
'use strict';
const $ = (s) => document.querySelector(s);

let settings, profiles, startCwd, home, elevated = false;
const tabs = [];
let activeTab = null;
const panes = new Map(); // ptyId -> pane
let tabSeq = 0;
let history = [];

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n) => ICONS[n] || '';
const div = (cls, html) => Object.assign(document.createElement('div'), { className: cls || '', innerHTML: html || '' });
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.hydrated) return;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    el.dataset.hydrated = '1';
  });
}
const profileById = (id) => profiles.find((p) => p.id === id) || profiles.find((p) => p.id === settings.defaultProfile) || profiles[0];
const activePane = () => activeTab?.active;
const allPanes = () => tabs.flatMap((t) => t.panes);
const folderName = (p) => (p ? p.split(/[\\/]/).filter(Boolean).pop() || p : '');
const fmtDur = (ms) => (ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
const b64utf8 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- theme / options ----------
function allThemes() { return { ...THEMES, ...(settings.customThemes || {}) }; }
const darkMq = matchMedia('(prefers-color-scheme: dark)');
function themeKey() { return settings.themeMode === 'system' ? (darkMq.matches ? settings.themeDark : settings.themeLight) : settings.theme; }
function themeObj() { return allThemes()[themeKey()] || THEMES.carbon; }
darkMq.addEventListener('change', () => { if (settings?.themeMode === 'system') applyAll(); }); // follow Windows light/dark live
function withAlpha(hex, a) {
  if (a >= 1 || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;
}
function termTheme() { const t = themeObj(); return { ...t, background: withAlpha(t.background, settings.opacity / 100) }; }
function termOptions() {
  return {
    fontFamily: settings.fontFamily, fontSize: settings.fontSize, fontWeight: settings.fontWeight, fontWeightBold: 'bold',
    lineHeight: settings.lineHeight, letterSpacing: settings.letterSpacing,
    cursorStyle: settings.cursorStyle, cursorBlink: settings.cursorBlink, scrollback: settings.scrollback, theme: termTheme(),
    smoothScrollDuration: settings.smoothScroll ? 90 : 0,
    wordSeparator: ' ()[]{}\'"`,;|<>', // smart double-click: whole paths, URLs and flags select as one word
  };
}
function applyAll() {
  const t = themeObj();
  const root = document.documentElement;
  root.dataset.ui = t.ui;
  root.style.setProperty('--term-bg', withAlpha(t.background, settings.opacity / 100));
  if (/^#[0-9a-f]{6}$/i.test(settings.accent)) root.style.setProperty('--accent', settings.accent); else root.style.removeProperty('--accent');
  setTabsPosition(settings.tabsPosition);
  const o = termOptions();
  for (const p of allPanes()) { Object.assign(p.term.options, o, { fontSize: settings.fontSize + (p.fontDelta || 0) }); fitPane(p); p.trail?.sync(); rescanHighlight(p); }
  $('#pinBtn').classList.toggle('on', !!settings.alwaysOnTop);
}
// Tabs across the top (default) or in a vertical list on the left.
function setTabsPosition(pos) {
  const v = pos === 'left';
  document.body.classList.toggle('vtabs', v);
  const host = v ? $('#vtabs') : $('#titlebar .tabs-host');
  if ($('#tabs').parentElement !== host) host.append($('#tabs'));
  $('#vtabs').hidden = !v;
}
async function setSetting(patch) {
  const r = await tp.settings.set(patch);
  settings = r.settings; profiles = r.profiles;
  applyAll();
}

// ---------- dialogs ----------
let dlgResolve = null;
function openDialog(title, body, okLabel = 'OK', { danger = false, cancel = true } = {}) {
  $('#dlgTitle').textContent = title;
  $('#dlgBody').replaceChildren(body);
  $('#dlgOk').textContent = okLabel;
  $('#dlgOk').classList.toggle('danger', danger);
  $('#dlgCancel').hidden = !cancel;
  $('#dialog').hidden = false;
  setTimeout(() => ($('#dlgBody').querySelector('input,textarea') || $('#dlgOk')).focus(), 0);
  return new Promise((res) => { dlgResolve = res; });
}
function closeDialog(v) { $('#dialog').hidden = true; const r = dlgResolve; dlgResolve = null; r?.(v); if (!v) activePane()?.term.focus(); }
$('#dialogForm').addEventListener('submit', (e) => { e.preventDefault(); closeDialog(true); });
$('#dlgCancel').onclick = () => closeDialog(false);
$('#dialog').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeDialog(false); } });
const confirmBox = (title, text, ok, opts) => { const b = div('dlg-text'); b.textContent = text; return openDialog(title, b, ok, opts); };
async function formBox(title, fields, ok = 'OK') {
  const box = div('dlg-fields');
  for (const f of fields) {
    const l = document.createElement('label');
    l.textContent = f.label;
    const i = Object.assign(document.createElement('input'), { value: f.value || '', placeholder: f.placeholder || '' });
    i.dataset.k = f.k;
    l.append(i); box.append(l);
  }
  if (!(await openDialog(title, box, ok))) return null;
  return Object.fromEntries([...box.querySelectorAll('input')].map((i) => [i.dataset.k, i.value]));
}

// ---------- tabs ----------
function createTab(profileId, opts = {}) {
  const prof = profileById(profileId);
  const tab = { id: ++tabSeq, panes: [], active: null, broadcast: false, custom: opts.title || null, color: opts.color || null, zoomed: null };
  tab.root = div('tabroot');
  $('#workspace').append(tab.root);
  tab.el = div('tab', `<span class="ico"></span><span class="ttl"></span><span class="dot"></span><button class="x" title="Close tab (Ctrl+Shift+W)">${icon('close')}</button><i class="prog"></i>`);
  tab.el.draggable = true;
  tab.el.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); requestCloseTab(tab); } });
  tab.el.addEventListener('click', (e) => { if (e.target.closest('.x')) requestCloseTab(tab); else activateTab(tab); });
  tab.el.addEventListener('dblclick', (e) => { if (!e.target.closest('.x')) renameTab(tab); });
  tab.el.addEventListener('contextmenu', (e) => { e.preventDefault(); activateTab(tab); showTabMenu(tab, e.clientX, e.clientY); });
  tab.el.addEventListener('dragstart', () => tab.el.classList.add('dragging'));
  tab.el.addEventListener('dragend', () => { tab.el.classList.remove('dragging'); syncTabOrder(); });
  $('#tabs').append(tab.el);
  tabs.push(tab);
  if (opts.adopt) adoptPane(opts.adopt, tab, tab.root);
  else if (opts.layout) buildLayout(tab, opts.layout, tab.root);
  else createPane(tab, prof.id, tab.root, { cwd: opts.cwd });
  setTabColor(tab, tab.color);
  activateTab(tab);
  return tab;
}
$('#tabs').addEventListener('dragover', (e) => {
  const dragging = $('.tab.dragging');
  if (!dragging) return;
  e.preventDefault();
  const v = document.body.classList.contains('vtabs');
  const after = [...$('#tabs').children].find((c) => {
    if (c === dragging) return false;
    const r = c.getBoundingClientRect();
    return v ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
  });
  $('#tabs').insertBefore(dragging, after || null);
});
let tabClock = 0;
function syncTabOrder() {
  const order = [...$('#tabs').children];
  tabs.sort((a, b) => order.indexOf(a.el) - order.indexOf(b.el));
}
function activateTab(tab) {
  activeTab = tab;
  tab.used = ++tabClock;
  for (const t of tabs) {
    t.root.style.display = t === tab ? '' : 'none';
    t.el.classList.toggle('active', t === tab);
  }
  tab.el.classList.remove('activity');
  tab.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  requestAnimationFrame(() => { tab.panes.forEach(fitPane); tab.active?.term.focus(); });
  updateTabTitle(tab);
  updateStatus();
}
function closeTab(tab, { quiet } = {}) {
  [...tab.panes].forEach((p) => disposePane(p));
  tab.root.remove(); tab.el.remove();
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  if (!tabs.length) { if (!quiet) tp.win.close(); return; }
  if (activeTab === tab) activateTab(tabs[Math.min(i, tabs.length - 1)]);
}
function cycleTab(d) {
  if (tabs.length < 2) return;
  if (settings.mruTabs) { // most-recently-used order: Ctrl+Tab flips back to the tab you were just on
    const byUse = [...tabs].sort((a, b) => b.used - a.used);
    return activateTab(byUse[d > 0 ? 1 : byUse.length - 1]);
  }
  activateTab(tabs[(tabs.indexOf(activeTab) + d + tabs.length) % tabs.length]);
}
const isRunning = (p) => !!p.cur?.start;
async function requestCloseTab(tab) {
  const busy = tab.panes.filter(isRunning);
  if (settings.confirmRunning && busy.length && !(await confirmBox('Close tab?', `A command is still running: ${busy[0].cur.text || 'unknown'}`, 'Close', { danger: true }))) return;
  closeTab(tab);
}
async function requestClosePane(p = activePane()) {
  if (!p) return;
  if (settings.confirmRunning && isRunning(p) && !(await confirmBox('Close pane?', `A command is still running: ${p.cur.text || 'unknown'}`, 'Close', { danger: true }))) return;
  closePane(p);
}
function paneTitle(p) { return p.oscTitle || (p.cwd && p.cwd !== home ? folderName(p.cwd) : p.profile.name); }
function updateTabTitle(tab) {
  const p = tab.active || tab.panes[0];
  const t = tab.custom || (p ? paneTitle(p) : '');
  tab.el.querySelector('.ttl').textContent = t;
  tab.el.querySelector('.ico').innerHTML = icon(p?.profile.icon);
  tab.el.title = `${t}${p?.cwd ? '\n' + p.cwd : ''}`;
  tab.el.classList.toggle('running', tab.panes.some((x) => x.cur?.start));
  if (tab === activeTab) document.title = t + ' — Terminal Plus';
}
function renameTab(tab) {
  const ttl = tab.el.querySelector('.ttl');
  const inp = Object.assign(document.createElement('input'), { value: ttl.textContent, className: 'tab-rename' });
  ttl.replaceWith(inp); inp.focus(); inp.select();
  const done = () => { tab.custom = inp.value.trim() || null; inp.replaceWith(ttl); updateTabTitle(tab); tab.active?.term.focus(); };
  inp.addEventListener('blur', done);
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') inp.blur(); });
}
const TAB_COLORS = ['#e81123', '#ff8c00', '#ffb900', '#16c60c', '#00b7c3', '#0078d4', '#8764b8', '#e3008c'];
function setTabColor(tab, c) {
  tab.color = c || null;
  tab.el.classList.toggle('colored', !!c);
  tab.el.style.setProperty('--tabc', c || 'transparent');
}
function duplicateTab(tab = activeTab) {
  const p = tab?.active;
  if (p) createTab(p.profile.id, { cwd: p.cwd, color: tab.color });
}
function closeOtherTabs(tab, rightOnly) {
  const i = tabs.indexOf(tab);
  tabs.filter((t, j) => t !== tab && (!rightOnly || j > i)).forEach((t) => closeTab(t));
}

// ---------- panes ----------
function createPane(tab, profileId, container, opts = {}) {
  const prof = profileById(profileId);
  const el = div('pane');
  const termEl = div('term');
  el.append(termEl, div('pane-badge', `${icon('lock')}Read-only`), div('rec-badge', '<i></i>REC'));
  container.append(el);
  const term = new window.Terminal({
    ...termOptions(), allowProposedApi: true, allowTransparency: true, rightClickSelectsWord: false,
    macOptionIsMeta: true, drawBoldTextInBrightColors: false,
    altClickMovesCursor: true, // Alt+click moves the prompt cursor
    linkHandler: { activate: (_e, uri) => tp.openUrl(uri), allowNonHttpProtocols: false }, // OSC 8 hyperlinks
  });
  const fit = new window.FitAddon.FitAddon();
  const search = new window.SearchAddon.SearchAddon();
  const serialize = new window.SerializeAddon.SerializeAddon();
  term.loadAddon(fit); term.loadAddon(search); term.loadAddon(serialize);
  term.loadAddon(new window.WebLinksAddon.WebLinksAddon((_e, uri) => tp.openUrl(uri)));
  term.loadAddon(new window.Unicode11Addon.Unicode11Addon());
  term.unicode.activeVersion = '11';
  // OSC 52: programs (ssh, tmux, vim) may set the clipboard; reading it back is refused.
  term.loadAddon(new window.ClipboardAddon.ClipboardAddon(undefined, { readText: async () => '', writeText: async (_s, t) => tp.clip.write(t) }));
  term.open(termEl);
  if (settings.gpu) {
    try { const gl = new window.WebglAddon.WebglAddon(); gl.onContextLoss(() => gl.dispose()); term.loadAddon(gl); } catch { /* falls back to DOM renderer */ }
  }
  const pane = { id: null, tab, el, term, fit, search, serialize, profile: prof, cwd: opts.cwd || null, oscTitle: null, prompts: [], done: [], cur: null, last: null, locked: false, fontDelta: 0, hl: [] };
  el._pane = pane;
  tab.panes.push(pane);
  tab.root.classList.toggle('multi', tab.panes.length > 1);

  term.onData((d) => {
    if (pane.exitedAt) { closePane(pane); return; }
    if (pane.locked) { flash(pane); return; }
    trackInput(pane, d);
    const targets = tab.broadcast ? tab.panes : [pane];
    for (const p of targets) if (p.id && !p.locked) tp.pty.write(p.id, d);
  });
  term.onResize(({ cols, rows }) => { if (pane.id) tp.pty.resize(pane.id, cols, rows); if (pane === activePane()) updateStatus(); });
  term.onTitleChange((t) => {
    pane.oscTitle = !t || /\.exe$|^(MINGW|MSYS|Administrator:|Windows PowerShell)/i.test(t) ? null : t;
    updateTabTitle(tab);
  });
  term.onSelectionChange(() => { if (settings.copyOnSelect && term.hasSelection()) tp.clip.write(term.getSelection()); });
  term.onBell(() => {
    if (settings.bell === 'none') return;
    flash(pane);
    if (settings.bell === 'notify' && (!document.hasFocus() || tab !== activeTab)) tp.notify('Terminal Plus', `🔔 ${paneTitle(pane)}`);
  });
  search.onDidChangeResults((r) => {
    if (pane !== activePane()) return;
    $('#findCount').textContent = !$('#findInput').value ? '' : r.resultCount ? `${r.resultIndex + 1}/${r.resultCount}` : 'No results';
  });
  setupIntegration(pane);
  setupPathLinks(pane);
  setupHighlight(pane);
  setupCursorTrail(pane);
  term.textarea.addEventListener('focus', () => setActivePane(pane));
  // Ctrl+mouse wheel zooms just this pane.
  el.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); e.stopPropagation();
    pane.fontDelta = Math.max(-6, Math.min(20, pane.fontDelta + (e.deltaY < 0 ? 1 : -1)));
    term.options.fontSize = settings.fontSize + pane.fontDelta;
    fitPane(pane);
  }, { capture: true, passive: false });
  // Middle-click pastes (like conhost / Linux terminals).
  el.addEventListener('mousedown', (e) => { if (e.button === 1 && settings.middlePaste) { e.preventDefault(); setActivePane(pane); paste(); } });

  // Paste guard: catch every paste (Ctrl+V, menu) before xterm sees it.
  el.addEventListener('paste', (e) => { e.preventDefault(); e.stopImmediatePropagation(); guardedPaste(pane, e.clipboardData.getData('text/plain')); }, true);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault(); setActivePane(pane);
    if (settings.rightClick === 'paste' && !e.shiftKey) { if (!copySel()) paste(); return; }
    showPaneMenu(e.clientX, e.clientY);
  });
  // Drag files/folders in: paste their quoted paths. Drag another tab in: it joins this tab as a split.
  const draggedTab = () => { const d = $('.tab.dragging'); return d && tabs.find((t) => t.el === d && t !== pane.tab); };
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); el.classList.add('drop'); el.dataset.drop = 'Drop to paste path'; }
    else if (draggedTab()) { e.preventDefault(); el.classList.add('drop'); el.dataset.drop = 'Drop to add tab as a split'; }
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop');
    const t = draggedTab();
    if (t) { e.preventDefault(); mergeTabInto(t, pane); return; }
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const paths = [...e.dataTransfer.files].map((f) => tp.pathForFile(f)).filter(Boolean);
    if (paths.length) { term.paste(paths.map((p) => quotePath(pane, p)).join(' ') + ' '); term.focus(); }
  });
  pane.ro = new ResizeObserver(() => requestAnimationFrame(() => fitPane(pane)));
  pane.ro.observe(el);

  fitPane(pane);
  // Restored output goes into scrollback: ConPTY clears the visible screen when the new shell starts.
  if (opts.buf) term.write(opts.buf.replace(/\s+$/, '') + '\r\n\x1b[0m\x1b[2m──────── restored from last session ────────\x1b[0m' + '\r\n'.repeat(term.rows));
  tp.pty.create({ profileId: prof.id, cols: term.cols, rows: term.rows, cwd: opts.cwd || null }).then(({ id, cwd }) => {
    if (pane.disposed) return tp.pty.kill(id);
    pane.id = id;
    panes.set(id, pane);
    if (!pane.cwd) setCwd(pane, cwd);
    tp.pty.resize(id, term.cols, term.rows);
  }).catch((err) => term.write(`\x1b[31mCould not start ${prof.name}: ${err.message}\x1b[0m\r\n`));
  setActivePane(pane);
  return pane;
}
function fitPane(p) {
  if (!p.el.offsetWidth || !p.el.offsetHeight) return; // hidden tab
  try { p.fit.fit(); } catch { /* not ready */ }
}
function setActivePane(p) {
  const tab = p.tab;
  tab.active = p;
  tab.panes.forEach((x) => x.el.classList.toggle('focused', x === p));
  updateTabTitle(tab);
  if (tab === activeTab) updateStatus();
}
function flash(p) { p.el.classList.remove('bell'); void p.el.offsetWidth; p.el.classList.add('bell'); }

function makeDivider(wrap) {
  const d = div('divider');
  d.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const col = wrap.classList.contains('col');
    const [a, , b] = wrap.children;
    document.body.classList.add('resizing', col ? 'rows' : 'cols');
    const move = (ev) => {
      const r = wrap.getBoundingClientRect();
      const f = Math.min(0.92, Math.max(0.08, col ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width));
      a.style.flex = `${f} 1 0`; b.style.flex = `${1 - f} 1 0`;
    };
    const up = () => { document.body.classList.remove('resizing', 'rows', 'cols'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });
  d.addEventListener('dblclick', () => { for (const c of wrap.children) c.style.flex = ''; }); // reset to 50/50
  return d;
}
function splitPane(dir, profileId) {
  const p = activePane();
  if (!p) return;
  if (p.tab.zoomed) toggleZoom();
  if (dir === 'auto') dir = p.el.offsetWidth >= p.el.offsetHeight * 1.6 ? 'right' : 'down';
  const wrap = div('split' + (dir === 'down' ? ' col' : ''));
  wrap.style.flex = p.el.style.flex;
  p.el.style.flex = '';
  p.el.replaceWith(wrap);
  wrap.append(p.el, makeDivider(wrap));
  const np = createPane(p.tab, profileId || p.profile.id, wrap, { cwd: settings.newTabSameDir ? p.cwd : null });
  requestAnimationFrame(() => { p.tab.panes.forEach(fitPane); np.term.focus(); });
}
// Take a pane out of its tab's layout (collapsing its split) without stopping its shell.
function detachPane(p) {
  const parent = p.el.parentElement;
  p.el.remove();
  if (parent?.classList.contains('split')) {
    parent.querySelector(':scope > .divider')?.remove();
    const rest = parent.firstElementChild;
    rest.style.flex = parent.style.flex;
    parent.replaceWith(rest);
  }
  const tab = p.tab;
  tab.panes.splice(tab.panes.indexOf(p), 1);
  if (tab.zoomed) { tab.zoomed.el.classList.remove('zpane'); tab.zoomed = null; tab.root.classList.remove('zoomed'); }
  tab.root.classList.toggle('multi', tab.panes.length > 1);
  if (tab.active === p) tab.active = tab.panes[tab.panes.length - 1] || null;
}
function adoptPane(p, tab, container) {
  p.el.style.flex = '';
  container.append(p.el);
  p.tab = tab;
  tab.panes.push(p);
  tab.root.classList.toggle('multi', tab.panes.length > 1);
  setActivePane(p);
}
function disposePane(p) {
  p.disposed = true;
  if (p.rec) stopRecording(p, true);
  if (p.id) { tp.pty.kill(p.id); panes.delete(p.id); }
  p.ro.disconnect();
  p.term.dispose();
  detachPane(p);
}
function movePaneToNewTab(p = activePane()) {
  if (!p || p.tab.panes.length < 2) return toast('Only one pane in this tab');
  const from = p.tab;
  detachPane(p);
  updateTabTitle(from);
  createTab(null, { adopt: p });
}
// Put every pane of tab `src` next to pane `target` (drag a tab onto a pane, or palette "Merge").
function mergeTabInto(src, target = activePane()) {
  if (!target || src === target.tab) return;
  const dst = target.tab;
  if (dst.zoomed) toggleZoom();
  const layout = src.root.firstElementChild;
  const moved = [...src.panes];
  const wrap = div('split' + (target.el.offsetWidth >= target.el.offsetHeight * 1.6 ? '' : ' col'));
  wrap.style.flex = target.el.style.flex;
  target.el.style.flex = '';
  target.el.replaceWith(wrap);
  wrap.append(target.el, makeDivider(wrap), layout);
  for (const m of moved) { m.tab = dst; dst.panes.push(m); }
  src.panes = [];
  dst.root.classList.toggle('multi', dst.panes.length > 1);
  src.root.remove(); src.el.remove();
  tabs.splice(tabs.indexOf(src), 1);
  activateTab(dst);
  setActivePane(moved[0]);
}
function equalizePanes(t = activeTab) {
  t?.root.querySelectorAll('.split > :not(.divider)').forEach((c) => (c.style.flex = ''));
  requestAnimationFrame(() => t?.panes.forEach(fitPane));
}
function swapPane(d = 1) {
  const t = activeTab;
  if (!t || t.panes.length < 2) return;
  const a = t.active;
  const b = t.panes[(t.panes.indexOf(a) + d + t.panes.length) % t.panes.length];
  const mark = document.createComment('');
  const [fa, fb] = [a.el.style.flex, b.el.style.flex];
  a.el.replaceWith(mark); b.el.replaceWith(a.el); mark.replaceWith(b.el);
  a.el.style.flex = fb; b.el.style.flex = fa;
  const ia = t.panes.indexOf(a), ib = t.panes.indexOf(b);
  [t.panes[ia], t.panes[ib]] = [b, a];
  requestAnimationFrame(() => { t.panes.forEach(fitPane); a.term.focus(); });
}
function closePane(p = activePane()) {
  if (!p) return;
  const tab = p.tab;
  disposePane(p);
  if (!tab.panes.length) return closeTab(tab);
  setActivePane(tab.panes[tab.panes.length - 1]);
  requestAnimationFrame(() => { tab.panes.forEach(fitPane); tab.active.term.focus(); });
}
function focusNextPane(d) {
  const t = activeTab;
  if (!t || t.panes.length < 2 || t.zoomed) return;
  t.panes[(t.panes.indexOf(t.active) + d + t.panes.length) % t.panes.length].term.focus();
}
function toggleZoom() {
  const t = activeTab;
  if (!t || (t.panes.length < 2 && !t.zoomed)) return;
  t.panes.forEach((x) => x.el.classList.remove('zpane'));
  t.zoomed = t.zoomed ? null : t.active;
  t.zoomed?.el.classList.add('zpane');
  t.root.classList.toggle('zoomed', !!t.zoomed);
  requestAnimationFrame(() => { t.panes.forEach(fitPane); t.active.term.focus(); });
  updateStatus();
}
function toggleLock(p = activePane()) {
  if (!p) return;
  p.locked = !p.locked;
  p.el.classList.toggle('locked', p.locked);
  updateStatus();
}
function toggleBroadcast() {
  if (!activeTab) return;
  activeTab.broadcast = !activeTab.broadcast;
  activeTab.root.classList.toggle('broadcast', activeTab.broadcast);
  updateStatus();
}

// ---------- shell integration (OSC 133 marks, OSC 9;9 / 7 cwd, OSC 9;4 progress) ----------
function setupIntegration(pane) {
  const term = pane.term;
  term.parser.registerOscHandler(133, (data) => { onMark(pane, data); return true; });
  term.parser.registerOscHandler(9, (data) => {
    if (data.startsWith('9;')) { setCwd(pane, data.slice(2).replace(/^"|"$/g, '')); return true; }
    if (data.startsWith('4;')) { const [, st, pr] = data.split(';'); setProgress(pane, +st || 0, +pr || 0); return true; }
    return false;
  });
  term.parser.registerOscHandler(7, (data) => {
    try { const u = new URL(data); if (u.protocol === 'file:') setCwd(pane, decodeURIComponent(u.pathname)); } catch { /* bad uri */ }
    return true;
  });
}
function onMark(pane, data) {
  const [k, ...rest] = data.split(';');
  const term = pane.term;
  const b = term.buffer.active;
  if (k === 'A') {
    if (pane.cur) finishCmd(pane, pane.cur, null);
    const m = term.registerMarker(0);
    if (m) { pane.prompts.push(m); m.onDispose(() => pane.prompts.splice(pane.prompts.indexOf(m), 1)); }
    pane.cur = { marker: m, inputX: null, inMarker: null, text: null };
    pane.integrated = true;
  } else if (k === 'B' && pane.cur) {
    pane.cur.inputX = b.cursorX; pane.cur.inMarker = term.registerMarker(0);
  } else if (k === 'C' && pane.cur) {
    if (rest[0]) { try { pane.cur.text = b64utf8(rest.join(';')).trim(); } catch { /* keep typed text */ } }
    if (!pane.cur.start) { pane.cur.start = Date.now(); pane.cur.outMarker = term.registerMarker(-1); updateTabTitle(pane.tab); }
  } else if (k === 'D' && pane.cur) {
    finishCmd(pane, pane.cur, rest[0]);
    pane.cur = null;
  }
}
function trackInput(pane, d) {
  const c = pane.cur;
  if (!c || c.start || pane.term.buffer.active.type !== 'normal') return;
  const b = pane.term.buffer.active;
  if (c.inputX == null) { c.inputX = b.cursorX; c.inMarker = pane.term.registerMarker(0); } // prompt ends where typing starts
  if (d.includes('\r')) {
    c.start = Date.now();
    c.outMarker = pane.term.registerMarker(0);
    updateTabTitle(pane.tab);
  }
}
function lineText(term, y) { return term.buffer.active.getLine(y)?.translateToString(true) ?? ''; }
// Read the typed command once it has finished (the shell's echo of the last keys arrives after Enter).
function readInput(pane, c) {
  const { term } = pane;
  const b = term.buffer.active;
  const to = c.outMarker?.isDisposed === false ? c.outMarker.line : null;
  const from = c.inMarker?.isDisposed === false ? c.inMarker.line : null;
  if (to == null) return '';
  if (from == null || from > to || to - from > 20) return lineText(term, to).replace(/^.*?[>$#%❯] /, '').trim();
  let s = '';
  for (let r = from; r <= to; r++) {
    let t = lineText(term, r);
    if (r === from) t = t.slice(c.inputX);
    s += (r > from && !b.getLine(r)?.isWrapped ? '\n' : '') + t;
  }
  return s.trim();
}
function finishCmd(pane, c, exitStr) {
  if (!c.start) return;
  if (c.text == null) c.text = readInput(pane, c);
  c.end = Date.now();
  c.exit = exitStr == null || exitStr === '' ? null : parseInt(exitStr, 10);
  const dur = c.end - c.start;
  pane.last = c;
  pane.done.push(c);
  if (pane.done.length > 500) pane.done.shift();
  updateTabTitle(pane.tab);
  if (!c.text) return;
  decorate(pane, c, dur);
  const item = { cmd: c.text, cwd: pane.cwd, shell: pane.profile.name, exit: c.exit, t: Date.now() };
  tp.history.add(item);
  const i = history.findIndex((h) => h.cmd === item.cmd);
  if (i >= 0) history.splice(i, 1);
  history.push(item);
  if (!$('#sideHist').hidden && !$('#side').hidden) renderHistory();
  if (settings.notifyLong && dur >= settings.notifySeconds * 1000 && (!document.hasFocus() || pane.tab !== activeTab || pane !== activePane())) {
    tp.notify(c.exit ? `✗ Failed (exit ${c.exit}) after ${fmtDur(dur)}` : `✓ Finished in ${fmtDur(dur)}`, `${c.text.slice(0, 120)}\n${paneTitle(pane)}`);
  }
  if (pane === activePane()) updateStatus();
}
function decorate(pane, c, dur) {
  const m = c.marker;
  if (!m || m.isDisposed) return;
  const st = c.exit == null ? 'neutral' : c.exit === 0 ? 'good' : 'bad';
  const when = settings.cmdTimestamps ? new Date(c.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '  ' : '';
  let label = `${when}${st === 'bad' ? `✗ ${c.exit}` : st === 'good' ? '✓' : '•'} ${fmtDur(dur)}`;
  // Long command lines leave no room: show just a colored dot instead of covering the text.
  if (lineText(pane.term, m.line).length > pane.term.cols - label.length - 2) label = '●';
  const d = pane.term.registerDecoration({
    marker: m, anchor: 'right', x: 0, width: label.length + 1,
    overviewRulerOptions: { color: st === 'bad' ? '#ff5f56' : st === 'good' ? '#3fb950' : '#8b949e', position: 'left' },
  });
  d?.onRender((el) => {
    el.style.left = 'auto'; el.style.right = '0'; // xterm leaves right-anchored x=0 at the left edge
    if (el.dataset.tp) return;
    el.dataset.tp = '1'; el.classList.add('cmd-badge', st); el.textContent = label;
  });
}
function setCwd(pane, dir) {
  if (!dir || dir === pane.cwd) return;
  pane.cwd = dir;
  updateTabTitle(pane.tab);
  if (pane === activePane()) updateStatus();
}
function setProgress(pane, st, pr) {
  pane.tab.el.style.setProperty('--prog', st === 0 ? 0 : st === 3 ? 100 : Math.min(100, pr));
  pane.tab.el.dataset.prog = st;
}
function jumpPrompt(dir) {
  const p = activePane();
  if (!p) return;
  if (!p.prompts.length) return toast(p.integrated ? 'No commands yet' : `Command marks need shell integration (PowerShell, cmd, Git Bash)`);
  const vy = p.term.buffer.active.viewportY;
  const lines = p.prompts.filter((m) => !m.isDisposed).map((m) => m.line);
  const target = dir < 0 ? lines.filter((l) => l < vy).pop() : lines.find((l) => l > vy);
  if (target == null) { if (dir > 0) p.term.scrollToBottom(); return; }
  p.term.scrollToLine(target);
}
function lastOutput(p = activePane()) {
  const c = p?.last;
  if (!c?.outMarker || c.outMarker.isDisposed) return null;
  const start = c.outMarker.line + 1;
  const next = p.prompts.map((m) => m.line).filter((l) => l > c.outMarker.line).sort((a, b) => a - b)[0];
  const b = p.term.buffer.active;
  const end = (next ?? b.baseY + b.cursorY) - 1;
  const out = [];
  for (let y = start; y <= end; y++) out.push(lineText(p.term, y));
  return out.join('\n').replace(/\s+$/, '');
}
function copyLastOutput() {
  const t = lastOutput();
  if (t == null) return toast('No finished command output yet');
  tp.clip.write(t); toast(`Copied ${t.split('\n').length} lines of output`);
}
function rerunLast() {
  const p = activePane();
  const c = [...(p?.done || [])].reverse().find((x) => x.text);
  if (!c) return toast('No command to re-run yet');
  insertCmd(c.text, true);
}

// ---------- cell geometry (shared by quick select, suggestions, cursor trail) ----------
function cellBox(p) {
  const screen = p.term.element?.querySelector('.xterm-screen');
  if (!screen) return null;
  return { screen, cw: screen.clientWidth / p.term.cols, ch: screen.clientHeight / p.term.rows };
}

// ---------- keyword highlighting: user rules color matching words as output arrives ----------
let hlRules = [];
function compileRules() {
  hlRules = [];
  for (const r of settings.highlightRules || []) {
    if (!r.on || !r.re) continue;
    try { hlRules.push({ re: new RegExp(r.re, 'gi'), color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#ff6b6b' }); } catch { /* skip bad pattern */ }
  }
}
function setupHighlight(pane) {
  const t = pane.term;
  let timer = 0;
  t.onWriteParsed(() => { if (!timer) timer = setTimeout(() => { timer = 0; scanHighlight(pane); }, 60); });
  // Clearing the screen leaves stale colors on new text, so drop them.
  t.parser.registerCsiHandler({ final: 'J' }, (params) => { if (params[0] === 2 || params[0] === 3) clearHighlight(pane); return false; });
}
function clearHighlight(p) { for (const d of p.hl) d.dispose(); p.hl = []; p.hlNext = null; }
function rescanHighlight(p) { clearHighlight(p); scanHighlight(p, true); }
function scanHighlight(p, full) {
  if (!settings.highlight || !hlRules.length || p.disposed) return;
  const t = p.term, b = t.buffer.active;
  if (b.type !== 'normal') return;
  const cur = b.baseY + b.cursorY;
  let from = p.hlNext?.isDisposed === false ? p.hlNext.line + 1 : Math.max(0, cur - (full ? 2000 : t.rows));
  for (let y = from; y <= cur; y++) {
    const text = lineText(t, y);
    if (!text) continue;
    let n = 0;
    for (const r of hlRules) {
      r.re.lastIndex = 0;
      for (const m of text.matchAll(r.re)) {
        if (++n > 24 || !m[0]) break;
        const marker = t.registerMarker(y - cur);
        if (!marker) continue;
        const d = t.registerDecoration({ marker, x: m.index, width: Math.min(m[0].length, t.cols - m.index), foregroundColor: r.color, layer: 'top' });
        if (d) { p.hl.push(d); d.onDispose(() => { const i = p.hl.indexOf(d); if (i >= 0) p.hl.splice(i, 1); }); }
        else marker.dispose();
      }
    }
  }
  p.hlNext?.dispose();
  p.hlNext = t.registerMarker(-1); // re-scan the cursor line next time: it may still be growing
  if (p.hl.length > 4000) p.hl.splice(0, p.hl.length - 4000).forEach((d) => d.dispose());
}

// ---------- animated cursor trail (opt-in) ----------
function setupCursorTrail(pane) {
  const glow = div('cursor-trail');
  let raf = 0;
  const place = () => {
    raf = 0;
    const box = cellBox(pane);
    const b = pane.term.buffer.active;
    const vis = settings.cursorTrail && box && document.activeElement === pane.term.textarea && b.baseY + b.cursorY >= b.viewportY && b.baseY + b.cursorY < b.viewportY + pane.term.rows;
    glow.hidden = !vis;
    if (!vis) return;
    if (glow.parentElement !== box.screen) box.screen.append(glow);
    glow.style.width = box.cw + 'px'; glow.style.height = box.ch + 'px';
    glow.style.transform = `translate(${b.cursorX * box.cw}px, ${(b.baseY + b.cursorY - b.viewportY) * box.ch}px)`;
  };
  const sync = () => { if (!raf) raf = requestAnimationFrame(place); };
  pane.term.onCursorMove(sync); pane.term.onScroll(sync); pane.term.onRender(sync);
  pane.term.textarea.addEventListener('focus', sync); pane.term.textarea.addEventListener('blur', sync);
  pane.trail = { sync };
}

// ---------- quick select: label every URL / path / IP / hash on screen, press its letters to copy ----------
const QS_PATTERNS = [
  /https?:\/\/[^\s"'<>`]+[^\s"'<>`.,;:)\]}]/g,
  WIN_PATH_RE(),
  /(?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]+)+/g,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\b[0-9a-f]{7,40}\b/g,
  /\b\d{3,}\b/g,
];
function WIN_PATH_RE() { return /(?<![\w\\])[A-Za-z]:\\[^\s"'<>|*?\x00-\x1f]*[^\s"'<>|*?.,:;)\]}\x00-\x1f]/g; }
let qs = null;
function quickSelect() {
  const p = activePane();
  if (!p || qs) return;
  const box = cellBox(p);
  if (!box) return;
  const b = p.term.buffer.active;
  const found = [];
  for (let r = 0; r < p.term.rows; r++) {
    const text = lineText(p.term, b.viewportY + r);
    const taken = [];
    for (const re of QS_PATTERNS) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const s = m.index, e = s + m[0].length;
        if (taken.some(([a, z]) => s < z && e > a)) continue; // earlier patterns win overlaps
        if (/^\d+$/.test(m[0]) && m[0].length < 3) continue;
        taken.push([s, e]);
        found.push({ r, x: s, text: m[0] });
      }
    }
  }
  if (!found.length) return toast('Nothing to pick on screen (URLs, paths, IPs, hashes, numbers)');
  const keys = 'asdfjklghqweruiopzxcvbnmty';
  const labels = found.length <= keys.length ? [...keys].slice(0, found.length)
    : found.map((_, i) => keys[Math.floor(i / keys.length) % keys.length] + keys[i % keys.length]);
  const layer = div('qs-layer');
  found.forEach((f, i) => {
    f.label = labels[i];
    const hl = div('qs-hit'); hl.style.cssText = `left:${f.x * box.cw}px;top:${f.r * box.ch}px;width:${f.text.length * box.cw}px;height:${box.ch}px`;
    const lb = div('qs-label'); lb.textContent = f.label; lb.style.cssText = `left:${f.x * box.cw}px;top:${f.r * box.ch}px;height:${box.ch}px;line-height:${box.ch}px`;
    f.lb = lb;
    layer.append(hl, lb);
  });
  layer.append(div('qs-help', '<b>type letters</b> copy · <b>Shift</b>+letters insert at prompt · <b>Esc</b> cancel'));
  box.screen.append(layer);
  qs = { p, found, typed: '', layer };
}
function endQuickSelect() { qs?.layer.remove(); const p = qs?.p; qs = null; p?.term.focus(); }
function quickSelectKey(e) {
  if (e.key === 'Escape') return endQuickSelect();
  if (!/^[a-z]$/i.test(e.key)) return;
  qs.typed += e.key.toLowerCase();
  const hits = qs.found.filter((f) => f.label.startsWith(qs.typed));
  qs.found.forEach((f) => f.lb.classList.toggle('dim', !f.label.startsWith(qs.typed)));
  if (!hits.length) return endQuickSelect();
  if (hits.length === 1 && hits[0].label === qs.typed) {
    const t = hits[0].text;
    const p = qs.p;
    endQuickSelect();
    if (e.shiftKey) insertCmd(quotePath(p, t), false); else { tp.clip.write(t); toast('Copied ' + t); }
  }
}

// ---------- history suggestions at the prompt (Ctrl+Space) ----------
function currentInput(p) {
  const c = p.cur;
  if (!c || c.start || c.inputX == null || c.inMarker?.isDisposed !== false) return '';
  const b = p.term.buffer.active;
  const to = b.baseY + b.cursorY;
  let s = '';
  for (let r = c.inMarker.line; r <= to && r - c.inMarker.line < 20; r++) s += (r === c.inMarker.line ? lineText(p.term, r).slice(c.inputX) : lineText(p.term, r));
  return s.trim();
}
let sug = null;
async function openSuggest() {
  const p = activePane();
  if (!p) return;
  if (!p.integrated) return toast('Suggestions need shell integration (PowerShell, cmd, Git Bash)');
  history = await tp.history.get();
  const typed = currentInput(p);
  const pool = [...new Set([...history].reverse().map((h) => h.cmd).concat(settings.snippets.map((s) => s.cmd)))];
  const items = (typed ? pool.map((c) => ({ c, s: fuzzy(typed, c) })).filter((x) => x.s > 0 && x.c !== typed).sort((a, b) => b.s - a.s).map((x) => x.c) : pool).slice(0, 10);
  if (!items.length) return toast(typed ? `No history matches “${typed}”` : 'No history yet');
  closeSuggest();
  const box = cellBox(p);
  const b = p.term.buffer.active;
  const pop = div('suggest');
  items.forEach((c, i) => {
    const row = div(i ? '' : 'sel'); row.textContent = c; row.title = c;
    row.onmousedown = (e) => { e.preventDefault(); acceptSuggest(i); };
    pop.append(row);
  });
  pop.append(div('suggest-foot', '<b>↑↓</b> choose · <b>Enter</b> put at prompt (does not run) · <b>Esc</b> close'));
  const r = p.term.element.getBoundingClientRect();
  const y = r.top + (b.cursorY + 1) * box.ch;
  pop.style.left = Math.min(r.left + 6 + Math.max(0, (p.cur?.inputX ?? b.cursorX) - 1) * box.cw, innerWidth - 520) + 'px';
  document.body.append(pop);
  pop.style.top = (y + pop.offsetHeight > innerHeight - 30 ? r.top + b.cursorY * box.ch - pop.offsetHeight : y) + 'px';
  sug = { p, items, sel: 0, pop };
}
function closeSuggest() { sug?.pop.remove(); sug = null; }
function acceptSuggest(i = sug?.sel) {
  const { p, items } = sug;
  closeSuggest();
  const k = p.profile.kind;
  // Clear what is typed, then insert the choice (not run). bash: end-of-line + kill-line; PowerShell/cmd: Escape.
  if (p.id) tp.pty.write(p.id, k === 'bash' || k === 'wsl' ? '\x05\x15' : '\x1b');
  setTimeout(() => insertCmd(items[i], false), 30);
}
function suggestKey(e) {
  if (e.key === 'Escape') return closeSuggest();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    sug.pop.children[sug.sel].classList.remove('sel');
    sug.sel = (sug.sel + (e.key === 'ArrowDown' ? 1 : -1) + sug.items.length) % sug.items.length;
    sug.pop.children[sug.sel].classList.add('sel');
    return;
  }
  if (e.key === 'Enter' || e.key === 'Tab') return acceptSuggest();
  closeSuggest();
  return 'pass';
}

// ---------- recording (asciinema .cast v2, plays at asciinema.org or with `asciinema play`) ----------
function toggleRecording(p = activePane()) {
  if (!p) return;
  if (p.rec) return stopRecording(p);
  p.rec = { t0: performance.now(), cols: p.term.cols, rows: p.term.rows, ev: [], at: Date.now() };
  p.el.classList.add('recording');
  toast('Recording this pane — run the same command again to stop and save');
  updateStatus();
}
async function stopRecording(p, silent) {
  const r = p.rec;
  p.rec = null;
  p.el.classList.remove('recording');
  updateStatus();
  if (silent || !r?.ev.length) { if (!silent) toast('Nothing recorded'); return; }
  const head = { version: 2, width: r.cols, height: r.rows, timestamp: Math.round(r.at / 1000), title: paneTitle(p), env: { TERM: 'xterm-256color', SHELL: p.profile.name } };
  const body = r.ev.map((e) => JSON.stringify(e)).join('\n');
  const f = await tp.saveText(`terminal-${new Date(r.at).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.cast`, JSON.stringify(head) + '\n' + body + '\n');
  if (f) toast('Saved recording ' + f);
}

// ---------- Windows paths: Ctrl+click to show in Explorer ----------
const WIN_PATH = /(?<![\w\\])[A-Za-z]:\\[^\s"'<>|*?\x00-\x1f]*[^\s"'<>|*?.,:;)\]}\x00-\x1f]/g;
function setupPathLinks(pane) {
  pane.term.registerLinkProvider({
    provideLinks(y, cb) {
      const text = lineText(pane.term, y - 1);
      const links = [];
      for (const m of text.matchAll(WIN_PATH)) {
        links.push({
          range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } }, text: m[0],
          decorations: { underline: true, pointerCursor: true },
          activate: (e, t) => (e.ctrlKey ? tp.reveal(t) : toast('Ctrl+click to show in Explorer')),
        });
      }
      cb(links.length ? links : undefined);
    },
  });
}
function quotePath(pane, p) {
  const k = pane.profile.kind;
  if (k === 'bash' || k === 'wsl') {
    const m = p.match(/^([A-Za-z]):\\(.*)$/);
    if (m) p = (k === 'wsl' ? '/mnt/' : '/') + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/');
    return /[^\w@%+=:,./-]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p;
  }
  if (k === 'powershell') return /[\s'"&()[\]{}$`;,@#]/.test(p) ? `'${p.replace(/'/g, "''")}'` : p;
  return /[\s&()[\]{}^=;!'+,`~]/.test(p) ? `"${p}"` : p;
}

// ---------- pty events ----------
tp.pty.onData((id, data) => {
  const p = panes.get(id);
  if (!p) return;
  p.term.write(data);
  if (p.rec) p.rec.ev.push([+((performance.now() - p.rec.t0) / 1000).toFixed(4), 'o', data]);
  if (p.tab !== activeTab) p.tab.el.classList.add('activity');
});
tp.pty.onExit((id, code) => {
  const p = panes.get(id);
  if (!p) return;
  panes.delete(id);
  p.id = null;
  if (code === 0) return closePane(p);
  p.exitedAt = Date.now();
  p.term.write(`\r\n\x1b[90m[process exited with code ${code} — press any key to close]\x1b[0m`);
});

// ---------- status bar ----------
const gitCache = new Map();
async function updateStatus() {
  const p = activePane();
  if (!p) return;
  $('#sbProfile').innerHTML = `${icon(p.profile.icon)}${esc(p.profile.name)}`;
  $('#sbCwd').innerHTML = p.cwd ? `${icon('folder')}<span>${esc(p.cwd.replace(/^C:\\Users\\[^\\]+/i, '~'))}</span>` : '';
  $('#sbCwd').hidden = !p.cwd;
  $('#sbSize').textContent = `${p.term.cols} × ${p.term.rows}`;
  $('#sbBroadcast').hidden = !activeTab.broadcast;
  $('#sbLock').hidden = !p.locked;
  $('#sbZoom').hidden = !activeTab.zoomed;
  $('#sbRec').hidden = !p.rec;
  const c = p.last;
  $('#sbLast').innerHTML = c?.text ? `<span class="${c.exit == null ? '' : c.exit ? 'bad' : 'good'}">${c.exit == null ? '•' : c.exit ? '✗ ' + c.exit : '✓'}</span> ${esc(fmtDur(c.end - c.start))}` : '';
  $('#sbLast').title = c?.text || '';
  let br = null;
  if (p.cwd) {
    const hit = gitCache.get(p.cwd);
    if (hit && Date.now() - hit.t < 4000) br = hit.v;
    else { br = await tp.gitBranch(p.cwd); gitCache.set(p.cwd, { v: br, t: Date.now() }); }
  }
  if (p !== activePane()) return;
  $('#sbGit').hidden = !br;
  $('#sbGit').innerHTML = br ? `${icon('branch')}${esc(br)}` : '';
}
$('#sbCwd').onclick = () => activePane()?.cwd && tp.openFolder(activePane().cwd);

// ---------- find ----------
const findOpts = { caseSensitive: false, wholeWord: false, regex: false };
function openFind() {
  $('#findBar').hidden = false;
  const sel = activePane()?.term.getSelection();
  if (sel && !sel.includes('\n')) $('#findInput').value = sel;
  $('#findInput').focus(); $('#findInput').select();
  if ($('#findInput').value) doFind(false);
}
function doFind(back) {
  const p = activePane(); const q = $('#findInput').value;
  if (!p) return;
  if (!q) { p.search.clearDecorations(); $('#findCount').textContent = ''; return; }
  const opts = { ...findOpts, decorations: { matchOverviewRuler: '#f2cc60', activeMatchColorOverviewRuler: '#ff9e3d', matchBackground: '#5c4a1a', activeMatchBackground: '#a86a00' } };
  try { back ? p.search.findPrevious(q, opts) : p.search.findNext(q, opts); } catch { $('#findCount').textContent = 'Bad pattern'; }
}
function closeFind() { $('#findBar').hidden = true; activePane()?.search.clearDecorations(); activePane()?.term.focus(); }
$('#findInput').addEventListener('input', () => doFind(false));
$('#findInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doFind(e.shiftKey); if (e.key === 'Escape') closeFind(); });
$('#findNext').onclick = () => doFind(false);
$('#findPrev').onclick = () => doFind(true);
$('#findClose').onclick = closeFind;
for (const [id, k] of [['#findCase', 'caseSensitive'], ['#findWord', 'wholeWord'], ['#findRegex', 'regex']]) {
  $(id).onclick = () => { findOpts[k] = !findOpts[k]; $(id).classList.toggle('on', findOpts[k]); doFind(false); $('#findInput').focus(); };
}

// ---------- clipboard ----------
function copySel() { const t = activePane()?.term; if (t?.hasSelection()) { tp.clip.write(t.getSelection()); t.clearSelection(); return true; } return false; }
async function paste() { const p = activePane(); if (p) guardedPaste(p, await tp.clip.read()); }
async function guardedPaste(p, text) {
  if (!text) return;
  if (p.locked) { flash(p); return toast('This pane is read-only (Ctrl+Shift+L)'); }
  const multi = text.replace(/\r?\n$/, '').includes('\n');
  if (settings.pasteWarning && (multi || text.length > 5000)) {
    const lines = text.split(/\r?\n/);
    const box = div('dlg-text');
    box.append(Object.assign(document.createElement('p'), { textContent: `You are pasting ${lines.length} lines${text.length > 5000 ? ` (${Math.round(text.length / 1024)} KB)` : ''}. Each line may run as a command.` }));
    box.append(Object.assign(document.createElement('pre'), { textContent: lines.slice(0, 15).join('\n') + (lines.length > 15 ? '\n…' : '') }));
    if (!(await openDialog('Paste multiple lines?', box, 'Paste anyway'))) return;
  }
  p.term.paste(text);
  p.term.focus();
}
function bufferText(p) {
  const b = p.term.buffer.active;
  const out = [];
  for (let y = 0; y < b.length; y++) out.push(b.getLine(y)?.translateToString(true) ?? '');
  return out.join('\n').replace(/\s+$/, '') + '\n';
}
async function exportOutput(p = activePane()) {
  if (!p) return;
  const f = await tp.saveText(`terminal-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`, bufferText(p));
  if (f) toast('Saved to ' + f);
}
function insertCmd(cmd, run) {
  const p = activePane();
  if (!p) return;
  p.term.paste(cmd.replace(/\r?\n$/, ''));
  if (run && p.id) tp.pty.write(p.id, '\r');
  p.term.focus();
}

// ---------- zoom ----------
function zoom(d) {
  settings.fontSize = d === 0 ? 14 : Math.min(32, Math.max(8, settings.fontSize + d));
  applyAll();
  tp.settings.set({ fontSize: settings.fontSize });
}

// ---------- menus ----------
function showMenu(x, y, items) {
  const m = $('#menu');
  m.innerHTML = '';
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(document.createElement('hr')); continue; }
    if (it.swatches) {
      const row = div('swatches');
      for (const c of [null, ...it.swatches]) {
        const b = document.createElement('button');
        b.style.background = c || 'transparent';
        b.className = c ? '' : 'none';
        b.title = c || 'No color';
        b.onclick = () => { hideMenu(); it.run(c); };
        row.append(b);
      }
      m.append(row);
      continue;
    }
    const b = document.createElement('button');
    b.innerHTML = `${icon(it.icon)}<span>${esc(it.label)}</span>${it.check ? `<span class="chk">${icon('check')}</span>` : ''}${it.kbd ? `<span class="kbd">${it.kbd}</span>` : ''}`;
    b.onclick = () => { hideMenu(); it.run(); };
    m.append(b);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
function hideMenu() { $('#menu').hidden = true; }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) hideMenu(); });
function showProfileMenu() {
  const r = $('#profileBtn').getBoundingClientRect();
  const local = profiles.filter((p) => p.kind !== 'ssh');
  const ssh = profiles.filter((p) => p.kind === 'ssh');
  showMenu(r.left, r.bottom + 4, [
    ...local.map((p, i) => ({ icon: p.icon, label: p.name, kbd: i < 9 ? `Ctrl+Shift+${i + 1}` : '', run: () => createTab(p.id, { cwd: settings.newTabSameDir ? activePane()?.cwd : null }) })),
    ssh.length ? '-' : null,
    ...ssh.slice(0, 12).map((p) => ({ icon: 'server', label: `SSH: ${p.name}`, run: () => createTab(p.id) })),
    '-',
    { icon: 'palette', label: 'Command palette', kbd: 'Ctrl+Shift+P', run: () => openPalette() },
    { icon: 'keyboard', label: 'Keyboard shortcuts', kbd: 'F1', run: showShortcuts },
    { icon: 'settings', label: 'Settings', kbd: 'Ctrl+,', run: openSettings },
  ]);
}
function showTabMenu(tab, x, y) {
  showMenu(x, y, [
    { icon: 'tab', label: 'Rename tab', run: () => renameTab(tab) },
    { swatches: TAB_COLORS, run: (c) => setTabColor(tab, c) },
    { icon: 'duplicate', label: 'Duplicate tab', kbd: 'Ctrl+Shift+D', run: () => duplicateTab(tab) },
    { icon: 'export', label: 'Save output to file…', run: () => exportOutput(tab.active) },
    { icon: 'export', label: 'Save window as layout…', run: () => saveWorkspace() },
    tabs.length > 1 ? { icon: 'splitV', label: 'Merge into another tab… (or drag it onto a pane)', run: () => { openPalette(); $('#paletteInput').value = 'merge'; renderPalette(); } } : null,
    '-',
    { icon: 'close', label: 'Close other tabs', run: () => closeOtherTabs(tab, false) },
    { icon: 'close', label: 'Close tabs to the right', run: () => closeOtherTabs(tab, true) },
    { icon: 'close', label: 'Close tab', run: () => requestCloseTab(tab) },
  ]);
}
function showPaneMenu(x, y) {
  const p = activePane();
  const sel = p?.term.hasSelection();
  showMenu(x, y, [
    sel ? { icon: 'copy', label: 'Copy', kbd: 'Ctrl+C', run: copySel } : null,
    { icon: 'insert', label: 'Paste', kbd: 'Ctrl+V', run: paste },
    p?.last ? { icon: 'copy', label: 'Copy last command output', kbd: 'Ctrl+Shift+O', run: copyLastOutput } : null,
    { icon: 'search', label: 'Quick select…', kbd: 'Ctrl+Shift+Space', run: quickSelect },
    { icon: 'palette', label: 'Select all', kbd: 'Ctrl+Shift+A', run: () => p?.term.selectAll() },
    { icon: 'search', label: 'Find', kbd: 'Ctrl+Shift+F', run: openFind },
    '-',
    { icon: 'splitV', label: 'Split right', kbd: 'Alt+Shift+=', run: () => splitPane('right') },
    { icon: 'splitH', label: 'Split down', kbd: 'Alt+Shift+-', run: () => splitPane('down') },
    activeTab.panes.length > 1 || activeTab.zoomed ? { icon: 'zoomPane', label: 'Zoom pane', check: !!activeTab.zoomed, kbd: 'Ctrl+Shift+Z', run: toggleZoom } : null,
    activeTab.panes.length > 1 ? { icon: 'splitV', label: 'Swap with next pane', run: () => swapPane(1) } : null,
    activeTab.panes.length > 1 ? { icon: 'tab', label: 'Move pane to its own tab', run: () => movePaneToNewTab() } : null,
    activeTab.panes.length > 1 ? { icon: 'broadcast', label: 'Type in all panes', check: activeTab.broadcast, kbd: 'Ctrl+Shift+B', run: toggleBroadcast } : null,
    { icon: 'lock', label: 'Read-only', check: p?.locked, kbd: 'Ctrl+Shift+L', run: () => toggleLock() },
    { icon: 'export', label: p?.rec ? 'Stop recording and save' : 'Record this pane (.cast)', check: !!p?.rec, kbd: 'Ctrl+Shift+R', run: () => toggleRecording() },
    '-',
    p?.cwd ? { icon: 'folder', label: 'Open folder in Explorer', run: () => tp.openFolder(p.cwd) } : null,
    p?.cwd ? { icon: 'copy', label: 'Copy folder path', run: () => { tp.clip.write(p.cwd); toast('Copied ' + p.cwd); } } : null,
    { icon: 'export', label: 'Save output to file…', kbd: 'Ctrl+Shift+E', run: () => exportOutput() },
    { icon: 'trash', label: 'Clear', kbd: 'Ctrl+Shift+K', run: () => { p?.term.clear(); if (p) clearHighlight(p); } },
    { icon: 'close', label: 'Close pane', kbd: 'Ctrl+Shift+W', run: () => requestClosePane() },
  ]);
}

// ---------- actions: one registry drives the palette, shortcuts sheet and (remappable) keyboard ----------
const P = () => activePane();
const ACTIONS = [
  { id: 'newTab', cat: 'Tab', icon: 'plus', name: 'New tab', key: 'ctrl+shift+t', run: () => newTab() },
  { id: 'dupTab', cat: 'Tab', icon: 'duplicate', name: 'Duplicate tab', key: 'ctrl+shift+d', run: () => duplicateTab() },
  { id: 'renameTab', cat: 'Tab', icon: 'tab', name: 'Rename tab', run: () => renameTab(activeTab) },
  { id: 'tabColor', cat: 'Tab', icon: 'color', name: 'Set tab color', run: () => { const r = activeTab.el.getBoundingClientRect(); showTabMenu(activeTab, r.left, r.bottom); } },
  { id: 'nextTab', cat: 'Tab', icon: 'tab', name: 'Next tab', key: 'ctrl+tab|ctrl+pagedown', run: () => cycleTab(1) },
  { id: 'prevTab', cat: 'Tab', icon: 'tab', name: 'Previous tab', key: 'ctrl+shift+tab|ctrl+pageup', run: () => cycleTab(-1) },
  { id: 'closeTab', cat: 'Tab', icon: 'close', name: 'Close tab', run: () => requestCloseTab(activeTab) },
  { id: 'closeOthers', cat: 'Tab', icon: 'close', name: 'Close other tabs', run: () => closeOtherTabs(activeTab) },
  { id: 'adminWin', cat: 'Tab', icon: 'warn', name: 'Open administrator window', run: () => tp.win.admin() },
  { id: 'splitRight', cat: 'Pane', icon: 'splitV', name: 'Split pane right', key: 'alt+shift+=', run: () => splitPane('right') },
  { id: 'splitDown', cat: 'Pane', icon: 'splitH', name: 'Split pane down', key: 'alt+shift+-', run: () => splitPane('down') },
  { id: 'splitAuto', cat: 'Pane', icon: 'splitV', name: 'Split pane (auto direction)', key: 'alt+shift+d', run: () => splitPane('auto') },
  { id: 'zoomPane', cat: 'Pane', icon: 'zoomPane', name: 'Zoom / unzoom pane', key: 'ctrl+shift+z', run: toggleZoom },
  { id: 'nextPane', cat: 'Pane', icon: 'tab', name: 'Focus next pane', key: 'alt+right|alt+down', run: () => focusNextPane(1) },
  { id: 'prevPane', cat: 'Pane', icon: 'tab', name: 'Focus previous pane', key: 'alt+left|alt+up', run: () => focusNextPane(-1) },
  { id: 'swapPane', cat: 'Pane', icon: 'splitV', name: 'Swap pane with next', key: 'ctrl+alt+shift+right', run: () => swapPane(1) },
  { id: 'equalize', cat: 'Pane', icon: 'splitV', name: 'Make all panes equal size', key: 'ctrl+alt+shift+=', run: () => equalizePanes() },
  { id: 'paneToTab', cat: 'Pane', icon: 'tab', name: 'Move pane to its own tab', run: () => movePaneToNewTab() },
  { id: 'broadcast', cat: 'Pane', icon: 'broadcast', name: 'Type in all panes (broadcast)', key: 'ctrl+shift+b', run: toggleBroadcast },
  { id: 'lock', cat: 'Pane', icon: 'lock', name: 'Toggle read-only', key: 'ctrl+shift+l', run: () => toggleLock() },
  { id: 'record', cat: 'Pane', icon: 'export', name: 'Start / stop recording (.cast)', key: 'ctrl+shift+r', run: () => toggleRecording() },
  { id: 'closePane', cat: 'Pane', icon: 'close', name: 'Close pane', key: 'ctrl+shift+w', run: () => requestClosePane() },
  { id: 'quickSelect', cat: 'Command', icon: 'search', name: 'Quick select (copy URLs, paths, IPs, hashes)', key: 'ctrl+shift+space', run: quickSelect },
  { id: 'suggest', cat: 'Command', icon: 'history', name: 'Suggest from history', key: 'ctrl+alt+space', run: openSuggest },
  { id: 'prevCmd', cat: 'Command', icon: 'up2', name: 'Jump to previous command', key: 'ctrl+shift+up', run: () => jumpPrompt(-1) },
  { id: 'nextCmd', cat: 'Command', icon: 'down2', name: 'Jump to next command', key: 'ctrl+shift+down', run: () => jumpPrompt(1) },
  { id: 'copyOut', cat: 'Command', icon: 'copy', name: 'Copy last command output', key: 'ctrl+shift+o', run: copyLastOutput },
  { id: 'rerun', cat: 'Command', icon: 'send', name: 'Re-run last command', key: 'ctrl+shift+enter', run: rerunLast },
  { id: 'history', cat: 'Command', icon: 'history', name: 'Search command history', key: 'ctrl+shift+h', run: () => openPalette('hist') },
  { id: 'find', cat: 'Edit', icon: 'search', name: 'Find', key: 'ctrl+shift+f', run: openFind },
  { id: 'copy', cat: 'Edit', icon: 'copy', name: 'Copy', key: 'ctrl+shift+c', run: copySel },
  { id: 'paste', cat: 'Edit', icon: 'insert', name: 'Paste', key: 'ctrl+shift+v', run: paste },
  { id: 'selectAll', cat: 'Edit', icon: 'palette', name: 'Select all', key: 'ctrl+shift+a', run: () => P()?.term.selectAll() },
  { id: 'clear', cat: 'Edit', icon: 'trash', name: 'Clear terminal', key: 'ctrl+shift+k', run: () => { P()?.term.clear(); if (P()) clearHighlight(P()); } },
  { id: 'export', cat: 'Edit', icon: 'export', name: 'Save output to file', key: 'ctrl+shift+e', run: () => exportOutput() },
  { id: 'top', cat: 'Edit', icon: 'up', name: 'Scroll to top', key: 'ctrl+shift+home', run: () => P()?.term.scrollToTop() },
  { id: 'bottom', cat: 'Edit', icon: 'down', name: 'Scroll to bottom', key: 'ctrl+shift+end', run: () => P()?.term.scrollToBottom() },
  { id: 'pgUp', cat: 'Edit', icon: 'up', name: 'Scroll up one page', key: 'shift+pageup', run: () => P()?.term.scrollPages(-1) },
  { id: 'pgDown', cat: 'Edit', icon: 'down', name: 'Scroll down one page', key: 'shift+pagedown', run: () => P()?.term.scrollPages(1) },
  { id: 'openFolder', cat: 'Folder', icon: 'folder', name: 'Open current folder in Explorer', run: () => P()?.cwd && tp.openFolder(P().cwd) },
  { id: 'copyFolder', cat: 'Folder', icon: 'copy', name: 'Copy current folder path', run: () => P()?.cwd && tp.clip.write(P().cwd) },
  { id: 'zoomIn', cat: 'View', icon: 'zoomIn', name: 'Zoom in', key: 'ctrl+=', run: () => zoom(1) },
  { id: 'zoomOut', cat: 'View', icon: 'zoomOut', name: 'Zoom out', key: 'ctrl+-', run: () => zoom(-1) },
  { id: 'zoomReset', cat: 'View', icon: 'search', name: 'Reset zoom', key: 'ctrl+0', run: () => zoom(0) },
  { id: 'fullscreen', cat: 'View', icon: 'fullscreen', name: 'Toggle full screen', key: 'f11', run: () => tp.win.fullscreen() },
  { id: 'onTop', cat: 'View', icon: 'pin', name: 'Toggle always on top', run: () => setSetting({ alwaysOnTop: !settings.alwaysOnTop }) },
  { id: 'vtabs', cat: 'View', icon: 'tab', name: 'Toggle vertical tabs', run: () => setSetting({ tabsPosition: settings.tabsPosition === 'left' ? 'top' : 'left' }) },
  { id: 'trail', cat: 'View', icon: 'zoomPane', name: 'Toggle animated cursor trail', run: () => setSetting({ cursorTrail: !settings.cursorTrail }) },
  { id: 'highlight', cat: 'View', icon: 'color', name: 'Toggle keyword highlighting', run: async () => { await setSetting({ highlight: !settings.highlight }); toast(`Highlighting ${settings.highlight ? 'on' : 'off'}`); } },
  { id: 'palette', cat: 'App', icon: 'palette', name: 'Command palette', key: 'ctrl+shift+p', run: () => openPalette() },
  { id: 'settings', cat: 'App', icon: 'settings', name: 'Settings', key: 'ctrl+,', run: () => openSettings() },
  { id: 'shortcuts', cat: 'App', icon: 'keyboard', name: 'Keyboard shortcuts', key: 'f1', run: () => showShortcuts() },
  { id: 'side', cat: 'App', icon: 'snippet', name: 'Toggle side panel', key: 'ctrl+shift+s', run: () => toggleSide() },
  { id: 'histPanel', cat: 'App', icon: 'history', name: 'History panel', run: () => toggleSide(true, 'hist') },
  { id: 'sshPanel', cat: 'App', icon: 'server', name: 'SSH hosts panel', run: () => toggleSide(true, 'ssh') },
  { id: 'wsPanel', cat: 'App', icon: 'folder', name: 'Saved layouts panel', run: () => toggleSide(true, 'ws') },
  { id: 'wsSave', cat: 'App', icon: 'export', name: 'Save this window as a layout…', run: () => saveWorkspace() },
];
const PRETTY = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', up: '↑', down: '↓', left: '←', right: '→', space: 'Space', enter: 'Enter', tab: 'Tab', escape: 'Esc', home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn', delete: 'Del', insert: 'Ins' };
const prettyKey = (k) => (k || '').split('|').filter(Boolean).map((c) => c.split('+').map((x) => PRETTY[x] || x.toUpperCase()).join('+')).join(' or ');
const keyOf = (a) => (settings.keybindings && a.id in settings.keybindings ? settings.keybindings[a.id] : a.key) || '';
const CODE_KEY = { Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Space: 'space', Tab: 'tab', Enter: 'enter', NumpadEnter: 'enter', Escape: 'escape', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', Insert: 'insert', Delete: 'delete', NumpadAdd: '=', NumpadSubtract: '-' };
function comboOf(e) {
  const c = e.code;
  const k = /^Key[A-Z]$/.test(c) ? c.slice(3).toLowerCase() : /^Digit\d$/.test(c) ? c.slice(5) : /^F\d{1,2}$/.test(c) ? c.toLowerCase() : CODE_KEY[c];
  if (!k) return null;
  return [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', k].filter(Boolean).join('+');
}
function actionForCombo(combo) { return ACTIONS.find((a) => keyOf(a).split('|').includes(combo)); }
function actions() {
  return [
    ...ACTIONS.map((a) => ({ ...a, kbd: prettyKey(keyOf(a)) })),
    ...profiles.map((p) => ({ cat: p.kind === 'ssh' ? 'SSH' : 'Tab', icon: p.icon, name: p.kind === 'ssh' ? `Connect: ${p.name}` : `New tab: ${p.name}`, run: () => createTab(p.id) })),
    ...profiles.filter((p) => p.kind !== 'ssh').map((p) => ({ cat: 'Pane', icon: p.icon, name: `Split with ${p.name}`, run: () => splitPane('auto', p.id) })),
    ...profiles.map((p) => ({ cat: 'Shortcut', icon: 'export', name: `Create desktop shortcut: ${p.name}`, run: async () => { const f = await tp.desktopShortcut(p.id); toast(f ? 'Created ' + f : 'Could not create shortcut'); } })),
    ...tabs.filter((t) => t !== activeTab).map((t) => ({ cat: 'Tab', icon: 'splitV', name: `Merge tab “${t.el.querySelector('.ttl').textContent}” into this one`, run: () => mergeTabInto(t) })),
    ...Object.keys(workspaces).map((n) => ({ cat: 'Layout', icon: 'folder', name: `Open layout: ${n}`, run: () => openWorkspace(n) })),
    ...Object.entries(allThemes()).map(([k, t]) => ({ cat: 'Theme', icon: 'color', name: `Theme: ${t.label}`, run: () => setSetting({ theme: k, themeMode: 'fixed' }) })),
    ...settings.snippets.map((s) => ({ cat: 'Snippet', icon: 'snippet', name: `${s.name}  —  ${s.cmd}`, run: () => useSnippet(s, false) })),
  ];
}
let palItems = [], palSel = 0, palMode = 'cmd';
function fuzzy(q, s) {
  q = q.toLowerCase(); s = s.toLowerCase();
  if (!q) return 1;
  if (s.includes(q)) return 1000 - s.indexOf(q);
  let i = 0, score = 0, last = -2;
  for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) { score += j === last + 1 ? 3 : 1; last = j; i++; }
  return i === q.length ? score : 0;
}
async function openPalette(mode = 'cmd') {
  palMode = mode;
  if (mode === 'hist') history = await tp.history.get();
  $('#palette').hidden = false;
  $('#paletteInput').value = '';
  $('#paletteInput').placeholder = mode === 'hist' ? 'Search command history…' : 'Type a command…';
  $('#paletteFoot').innerHTML = mode === 'hist' ? '<b>Enter</b> insert · <b>Shift+Enter</b> run · <b>Esc</b> close' : '<b>Enter</b> run · <b>↑↓</b> move · <b>Esc</b> close';
  renderPalette();
  $('#paletteInput').focus();
}
function closePalette() { $('#palette').hidden = true; activePane()?.term.focus(); }
function renderPalette() {
  const q = $('#paletteInput').value;
  if (palMode === 'hist') {
    palItems = [...history].reverse().map((h) => ({ h, s: fuzzy(q, h.cmd) })).filter((x) => x.s > 0);
    if (q) palItems.sort((a, b) => b.s - a.s);
    palItems = palItems.slice(0, 200).map((x) => ({ cat: folderName(x.h.cwd) || x.h.shell || '', icon: x.h.exit ? 'warn' : 'history', name: x.h.cmd, h: x.h }));
  } else {
    palItems = actions().map((a) => ({ a, s: fuzzy(q, `${a.cat} ${a.name}`) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.a);
  }
  palSel = 0;
  $('#paletteList').innerHTML = palItems.length
    ? palItems.map((a, i) => `<li data-i="${i}" class="${i ? '' : 'sel'}">${icon(a.icon)}<span class="cat">${esc(a.cat)}</span><span class="nm">${esc(a.name)}</span>${a.kbd ? `<span class="kbd">${a.kbd}</span>` : ''}</li>`).join('')
    : `<li class="empty">${palMode === 'hist' ? 'No history yet — commands you run appear here' : 'No matches'}</li>`;
}
function movePal(d) {
  const lis = $('#paletteList').querySelectorAll('li[data-i]');
  if (!lis.length) return;
  lis[palSel].classList.remove('sel');
  palSel = (palSel + d + lis.length) % lis.length;
  lis[palSel].classList.add('sel');
  lis[palSel].scrollIntoView({ block: 'nearest' });
}
function runPal(i = palSel, shift = false) {
  const a = palItems[i];
  closePalette();
  if (!a) return;
  if (palMode === 'hist') insertCmd(a.name, shift); else a.run();
}
$('#paletteInput').addEventListener('input', renderPalette);
$('#paletteInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); movePal(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); movePal(-1); }
  else if (e.key === 'Enter') runPal(palSel, e.shiftKey);
  else if (e.key === 'Escape') closePalette();
});
$('#paletteList').addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) runPal(+li.dataset.i, e.shiftKey); });
$('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closePalette(); });

function showShortcuts() {
  const box = div('shortcuts');
  const groups = {};
  for (const a of actions()) if (a.kbd) (groups[a.cat] ||= []).push(a);
  groups.Other = [
    { name: 'Go to tab 1–9', kbd: 'Ctrl+Alt+1…9' }, { name: 'New tab with shell 1–9', kbd: 'Ctrl+Shift+1…9' },
    { name: 'Show/hide window from anywhere', kbd: settings.quakeHotkey || '—' }, { name: 'Show path in Explorer', kbd: 'Ctrl+Click path' },
    { name: 'Resize panes', kbd: 'Drag divider' }, { name: 'Reset pane sizes', kbd: 'Double-click divider' },
    { name: 'Zoom one pane', kbd: 'Ctrl+Wheel' }, { name: 'Move prompt cursor', kbd: 'Alt+Click' },
    { name: 'Paste', kbd: 'Middle-click' }, { name: 'Add tab as a split', kbd: 'Drag tab onto pane' },
    { name: 'Copy (when text selected)', kbd: 'Ctrl+C' }, { name: 'Change any shortcut', kbd: 'Settings → Keyboard' },
  ];
  for (const [g, list] of Object.entries(groups)) {
    box.insertAdjacentHTML('beforeend', `<h4>${esc(g)}</h4>` + list.map((a) => `<div class="sc"><span>${esc(a.name)}</span><kbd>${esc(a.kbd)}</kbd></div>`).join(''));
  }
  openDialog('Keyboard shortcuts', box, 'Close', { cancel: false });
}

// ---------- settings ----------
const SCHEMA = [
  ['Appearance', [
    { k: 'themeMode', label: 'Color scheme mode', type: 'select', opts: [['fixed', 'One scheme'], ['system', 'Follow Windows light / dark']] },
    { k: 'theme', label: 'Color scheme', type: 'select', opts: () => Object.entries(allThemes()).map(([k, t]) => [k, t.label]) },
    { k: 'themeLight', label: 'Scheme when Windows is light', type: 'select', opts: () => Object.entries(allThemes()).map(([k, t]) => [k, t.label]) },
    { k: 'themeDark', label: 'Scheme when Windows is dark', type: 'select', opts: () => Object.entries(allThemes()).map(([k, t]) => [k, t.label]) },
    { k: 'accent', label: 'Accent color, e.g. #ff7aa2 (blank = default)', type: 'text', placeholder: '#4cc2ff' },
    { k: 'tabsPosition', label: 'Tabs', type: 'select', opts: [['top', 'Across the top'], ['left', 'Vertical list on the left']] },
    { k: 'opacity', label: 'Background opacity', type: 'range', min: 40, max: 100, unit: '%' },
    { k: 'fontFamily', label: 'Font family', type: 'text' },
    { k: 'fontSize', label: 'Font size', type: 'number', min: 8, max: 32 },
    { k: 'fontWeight', label: 'Font weight', type: 'select', opts: [['300', 'Light'], ['normal', 'Normal'], ['500', 'Medium'], ['600', 'Semi-bold'], ['bold', 'Bold']] },
    { k: 'lineHeight', label: 'Line height', type: 'number', min: 1, max: 2, step: 0.05 },
    { k: 'letterSpacing', label: 'Letter spacing (px)', type: 'number', min: -2, max: 6, step: 0.5 },
    { k: 'cursorStyle', label: 'Cursor shape', type: 'select', opts: [['bar', 'Bar ┃'], ['block', 'Block █'], ['underline', 'Underline ▁']] },
    { k: 'cursorBlink', label: 'Blinking cursor', type: 'check' },
    { k: 'cursorTrail', label: 'Animated cursor trail', type: 'check' },
    { k: 'smoothScroll', label: 'Smooth scrolling', type: 'check' },
    { k: 'cmdTimestamps', label: 'Show the time each command started', type: 'check' },
    { k: 'gpu', label: 'GPU-accelerated rendering (new panes)', type: 'check' },
  ]],
  ['Terminal', [
    { k: 'defaultProfile', label: 'Default shell', type: 'select', opts: () => profiles.map((p) => [p.id, p.name]) },
    { k: 'startDir', label: 'Starting folder (blank = your user folder)', type: 'text', placeholder: 'C:\\Projects' },
    { k: 'newTabSameDir', label: 'New tabs and splits open in the current folder', type: 'check' },
    { k: 'restoreSession', label: 'Restore tabs, splits and output on next launch', type: 'check' },
    { k: 'shellIntegration', label: 'Shell integration: command marks, folder tracking, history (new panes)', type: 'check' },
    { k: 'scrollback', label: 'Scrollback lines', type: 'number', min: 1000, max: 200000, step: 1000 },
    { k: 'copyOnSelect', label: 'Copy text as soon as it is selected', type: 'check' },
    { k: 'rightClick', label: 'Right-click', type: 'select', opts: [['menu', 'Show menu'], ['paste', 'Copy selection / paste (Shift+right-click for menu)']] },
    { k: 'pasteWarning', label: 'Warn before pasting multiple lines', type: 'check' },
    { k: 'middlePaste', label: 'Middle-click pastes', type: 'check' },
    { k: 'confirmRunning', label: 'Ask before closing a pane while a command is running', type: 'check' },
    { k: 'mruTabs', label: 'Ctrl+Tab switches to the most recently used tab', type: 'check' },
  ]],
  ['Alerts', [
    { k: 'bell', label: 'Bell', type: 'select', opts: [['notify', 'Flash + Windows notification'], ['visual', 'Flash only'], ['none', 'Off']] },
    { k: 'notifyLong', label: 'Notify when a long command finishes in the background', type: 'check' },
    { k: 'notifySeconds', label: '“Long command” means at least (seconds)', type: 'number', min: 2, max: 3600 },
  ]],
  ['Windows', [
    { k: 'confirmClose', label: 'Ask before closing several tabs', type: 'check' },
    { k: 'alwaysOnTop', label: 'Always on top', type: 'check' },
    { k: 'quakeHotkey', label: 'Show/hide hotkey (works from any app)', type: 'text', placeholder: 'Alt+`' },
    { k: 'quakeDropdown', label: 'Hotkey drops the terminal down from the top of the screen', type: 'check' },
    { k: 'quakeHeight', label: 'Drop-down height', type: 'range', min: 20, max: 100, unit: '%' },
    { k: 'quakeHideOnBlur', label: 'Hide the drop-down when I click elsewhere', type: 'check' },
    { k: 'showTray', label: 'Show icon in the system tray', type: 'check' },
    { k: 'closeToTray', label: 'Closing the window keeps it running in the tray', type: 'check' },
    { k: 'launchAtLogin', label: 'Start Terminal Plus when I sign in', type: 'check' },
    { k: 'startHidden', label: '…and start hidden (open with the hotkey or tray)', type: 'check' },
    { k: 'explorerMenu', label: 'Add “Open in Terminal Plus” to folder right-click menu', type: 'check' },
  ]],
  ['Profiles', 'profiles'],
  ['Highlighting', 'highlight'],
  ['Keyboard', 'keys'],
  ['Color schemes', 'custom'],
  ['Backup', 'backup'],
];
// ----- settings: custom sections -----
let kbEdits = {};
function keysUi() {
  kbEdits = { ...(settings.keybindings || {}) };
  const box = div('kb-list');
  const filter = Object.assign(document.createElement('input'), { placeholder: 'Filter actions' });
  box.append(filter);
  const rows = div('kb-rows');
  const render = () => {
    rows.innerHTML = '';
    const q = filter.value;
    const used = {};
    for (const a of ACTIONS) for (const k of ((a.id in kbEdits ? kbEdits[a.id] : a.key) || '').split('|').filter(Boolean)) (used[k] ||= []).push(a.id);
    for (const a of ACTIONS) {
      if (q && !fuzzy(q, a.cat + ' ' + a.name)) continue;
      const cur = a.id in kbEdits ? kbEdits[a.id] : a.key || '';
      const clash = cur.split('|').some((k) => k && used[k]?.length > 1);
      const row = div('kb-row' + (clash ? ' clash' : ''), `<span class="nm">${esc(a.name)}</span>`);
      const keyBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'kb-key', textContent: prettyKey(cur) || 'Not set', title: 'Click, then press the new shortcut' });
      keyBtn.onclick = () => {
        keyBtn.textContent = 'Press keys… (Esc cancels, Backspace clears)'; keyBtn.classList.add('rec');
        const grab = (e) => {
          if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          removeEventListener('keydown', grab, true);
          if (e.key === 'Escape') return render();
          kbEdits[a.id] = e.key === 'Backspace' ? '' : comboOf(e) || cur;
          render();
        };
        addEventListener('keydown', grab, true);
      };
      const reset = Object.assign(document.createElement('button'), { type: 'button', className: 'tbtn', title: 'Reset to default', innerHTML: icon('history') });
      reset.onclick = () => { delete kbEdits[a.id]; render(); };
      row.append(keyBtn, reset);
      rows.append(row);
    }
  };
  filter.oninput = render;
  render();
  box.append(rows, div('hint', 'Red rows share a shortcut with another action.'));
  return box;
}
function highlightUi() {
  const box = div('hl-list');
  const row = (r = { re: '', color: '#ff6b6b', on: true }) => {
    const el = div('hl-row');
    el.dataset.hl = '1';
    el.innerHTML = `<input type="checkbox" ${r.on ? 'checked' : ''} title="On"><input class="re" placeholder="Regular expression, e.g. \\bTODO\\b" value="${esc(r.re)}"><input type="color" value="${esc(r.color)}">`;
    const del = Object.assign(document.createElement('button'), { type: 'button', className: 'tbtn', title: 'Remove', innerHTML: icon('trash') });
    del.onclick = () => el.remove();
    el.append(del);
    return el;
  };
  const on = Object.assign(document.createElement('label'), { className: 'row' });
  on.innerHTML = `<input type="checkbox" data-k="highlight" data-t="check" ${settings.highlight ? 'checked' : ''}> Color matching words in output`;
  const rows = div('hl-rows');
  (settings.highlightRules || []).forEach((r) => rows.append(row(r)));
  const add = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: '+ Add rule' });
  add.onclick = () => rows.append(row());
  box.append(on, rows, add, div('hint', 'Case-insensitive. Applies to new output and the visible screen.'));
  return box;
}
function profilesUi() {
  const box = div('prof-list');
  const ICON_CHOICES = ['cmd', 'pwsh', 'powershell', 'bash', 'linux', 'server', 'snippet', 'folder'];
  const row = (c = { name: '', command: '', args: '', cwd: '', icon: 'cmd' }) => {
    const el = div('prof-row');
    el.dataset.prof = '1';
    el.innerHTML = `<input class="n" placeholder="Name, e.g. Python" value="${esc(c.name)}"><input class="c" placeholder="Program, e.g. python or C:\\tools\\app.exe" value="${esc(c.command)}">
      <input class="a" placeholder="Arguments (optional)" value="${esc(c.args || '')}"><input class="d" placeholder="Start folder (optional)" value="${esc(c.cwd || '')}">
      <select class="i">${ICON_CHOICES.map((i) => `<option ${i === c.icon ? 'selected' : ''}>${i}</option>`).join('')}</select>`;
    const del = Object.assign(document.createElement('button'), { type: 'button', className: 'tbtn', title: 'Remove', innerHTML: icon('trash') });
    del.onclick = () => el.remove();
    el.append(del);
    return el;
  };
  const rows = div('prof-rows');
  (settings.customProfiles || []).forEach((c) => rows.append(row(c)));
  const add = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: '+ Add profile' });
  add.onclick = () => rows.append(row());
  const built = div('hint', 'Found on this PC: ' + profiles.filter((p) => !p.custom && p.kind !== 'ssh').map((p) => p.name).join(', ') + '. Custom profiles appear in the ▾ menu. Right-click Desktop shortcuts are in the command palette (“Create desktop shortcut”).');
  box.append(rows, add, built);
  return box;
}
function backupUi() {
  const box = div('backup');
  const ex = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: 'Export settings…' });
  ex.onclick = async () => { const f = await tp.settings.export(); if (f) toast('Saved ' + f); };
  const im = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: 'Import settings…' });
  im.onclick = async () => {
    try { const r = await tp.settings.import(); if (r) { settings = r.settings; profiles = r.profiles; compileRules(); applyAll(); toast('Settings imported'); openSettings(); } }
    catch (e) { toast('Import failed: ' + (e.message || e)); }
  };
  box.append(ex, im, div('hint', 'Copy your setup to another PC. Window position is not included.'));
  return box;
}
const CUSTOM_SECTIONS = { custom: customThemesUi, keys: keysUi, highlight: highlightUi, profiles: profilesUi, backup: backupUi };
function openSettings() {
  const nav = $('#setNav'); const body = $('#setBody');
  nav.innerHTML = ''; body.innerHTML = '';
  SCHEMA.forEach(([sec, fields], si) => {
    const b = document.createElement('button');
    b.textContent = sec;
    b.onclick = () => { body.querySelector(`[data-sec="${si}"]`).scrollIntoView({ behavior: 'smooth' }); };
    nav.append(b);
    const s = div('set-sec', `<h3>${esc(sec)}</h3>`);
    s.dataset.sec = si;
    if (typeof fields === 'string') { s.append(CUSTOM_SECTIONS[fields]()); body.append(s); return; }
    for (const f of fields) {
      const l = document.createElement('label');
      l.className = f.type === 'check' ? 'row' : '';
      let inp;
      if (f.type === 'select') {
        inp = document.createElement('select');
        for (const [v, t] of typeof f.opts === 'function' ? f.opts() : f.opts) inp.add(new Option(t, v));
        inp.value = settings[f.k] ?? (f.k === 'defaultProfile' ? profiles[0]?.id : '');
      } else if (f.type === 'check') {
        inp = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!settings[f.k] });
      } else {
        inp = Object.assign(document.createElement('input'), { type: f.type, value: settings[f.k] ?? '', placeholder: f.placeholder || '' });
        for (const a of ['min', 'max', 'step']) if (f[a] != null) inp[a] = f[a];
      }
      inp.dataset.k = f.k; inp.dataset.t = f.type;
      if (f.type === 'check') l.append(inp, document.createTextNode(f.label));
      else {
        const cap = div('cap'); cap.textContent = f.label;
        if (f.type === 'range') { const v = div('rv'); v.textContent = inp.value + f.unit; inp.oninput = () => (v.textContent = inp.value + f.unit); cap.append(v); }
        l.append(cap, inp);
      }
      s.append(l);
    }
    body.append(s);
  });
  $('#settings').hidden = false;
  body.scrollTop = 0;
}
function customThemesUi() {
  const box = div('custom-themes');
  const list = div('list');
  for (const [k, t] of Object.entries(settings.customThemes || {})) {
    const row = div('ct', `<span class="sw" style="background:${esc(t.background)};color:${esc(t.foreground)}">Aa</span><span class="grow">${esc(t.label)}</span>`);
    const del = Object.assign(document.createElement('button'), { className: 'tbtn', title: 'Delete', innerHTML: icon('trash') });
    del.onclick = async () => { const c = { ...settings.customThemes }; delete c[k]; await setSetting({ customThemes: c, theme: settings.theme === k ? 'carbon' : settings.theme }); openSettings(); };
    row.append(del); list.append(row);
  }
  const ta = Object.assign(document.createElement('textarea'), { rows: 5, placeholder: 'Paste a Windows Terminal color scheme (JSON with name, background, foreground, black, red, … brightWhite)' });
  const btn = Object.assign(document.createElement('button'), { className: 'primary', type: 'button', textContent: 'Import scheme' });
  btn.onclick = async () => {
    try {
      const t = importScheme(ta.value);
      const key = 'custom-' + t.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await setSetting({ customThemes: { ...settings.customThemes, [key]: t }, theme: key });
      toast(`Imported “${t.label}”`);
      openSettings();
    } catch (e) { toast('Could not import: ' + e.message); }
  };
  box.append(list, ta, btn);
  return box;
}
function closeSettings() { $('#settings').hidden = true; activePane()?.term.focus(); }
$('#setCancel').onclick = closeSettings;
$('#setSave').onclick = async () => {
  const patch = {};
  for (const i of $('#setBody').querySelectorAll('[data-k]')) {
    const t = i.dataset.t;
    patch[i.dataset.k] = t === 'check' ? i.checked : t === 'number' || t === 'range' ? +i.value : i.value.trim();
  }
  for (const [k, lo, hi, d] of [['fontSize', 8, 32, 14], ['lineHeight', 1, 2, 1.1], ['letterSpacing', -2, 6, 0], ['scrollback', 1000, 200000, 10000], ['notifySeconds', 2, 3600, 10], ['opacity', 40, 100, 100], ['quakeHeight', 20, 100, 50]]) {
    patch[k] = Number.isFinite(patch[k]) ? Math.min(hi, Math.max(lo, patch[k])) : d;
  }
  if (!patch.fontFamily) delete patch.fontFamily;
  if (patch.accent && !/^#[0-9a-f]{6}$/i.test(patch.accent)) { toast('Accent must look like #4cc2ff'); delete patch.accent; }
  const bad = [];
  patch.highlightRules = [...$('#setBody').querySelectorAll('[data-hl]')].map((el) => {
    const [on, re, color] = el.querySelectorAll('input');
    try { if (re.value) new RegExp(re.value); } catch { bad.push(re.value); }
    return { on: on.checked, re: re.value.trim(), color: color.value };
  }).filter((r) => r.re && !bad.includes(r.re));
  if (bad.length) toast('Skipped invalid pattern: ' + bad[0]);
  patch.customProfiles = [...$('#setBody').querySelectorAll('[data-prof]')].map((el) => ({
    name: el.querySelector('.n').value.trim(), command: el.querySelector('.c').value.trim(), args: el.querySelector('.a').value.trim(),
    cwd: el.querySelector('.d').value.trim(), icon: el.querySelector('.i').value,
  })).filter((c) => c.name && c.command);
  patch.keybindings = kbEdits;
  await setSetting(patch);
  compileRules();
  allPanes().forEach(rescanHighlight);
  closeSettings();
};
$('#settings').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.kb-key.rec')) closeSettings(); });
$('#settings').addEventListener('mousedown', (e) => { if (e.target.id === 'settings') closeSettings(); });

// ---------- side panel: snippets, history, SSH ----------
function toggleSide(force, which) {
  const side = $('#side');
  const show = force ?? side.hidden;
  side.hidden = !show;
  $('#sideBtn').classList.toggle('on', show);
  if (show) switchSide(which || side.dataset.cur || 'snips');
  requestAnimationFrame(() => activeTab?.panes.forEach(fitPane));
  if (!show) activePane()?.term.focus();
}
function switchSide(w) {
  $('#side').dataset.cur = w;
  $('#sideSnips').hidden = w !== 'snips';
  $('#sideHist').hidden = w !== 'hist';
  $('#sideSsh').hidden = w !== 'ssh';
  $('#sideWs').hidden = w !== 'ws';
  document.querySelectorAll('#sideTabs button').forEach((b) => b.classList.toggle('on', b.dataset.side === w));
  if (w === 'snips') renderSnips();
  if (w === 'hist') tp.history.get().then((h) => { history = h; renderHistory(); });
  if (w === 'ssh') renderSsh();
  if (w === 'ws') renderWs();
}

// ---------- saved layouts (workspaces): name a set of tabs, splits and folders, reopen it any time ----------
let workspaces = {};
function layoutOf(el) {
  if (el.classList.contains('pane')) return { t: 'p', profile: el._pane.profile.id, cwd: el._pane.cwd };
  const [a, , b] = el.children;
  return { t: 's', col: el.classList.contains('col'), r: parseFloat(a.style.flexGrow) || 0.5, a: layoutOf(a), b: layoutOf(b) };
}
async function saveWorkspace(name) {
  if (!name) { const v = await formBox('Save layout', [{ k: 'name', label: 'Name', placeholder: 'e.g. Web dev' }], 'Save'); name = v?.name?.trim(); }
  if (!name) return;
  workspaces = await tp.workspaces.set(name, { tabs: tabs.map((t) => ({ title: t.custom, color: t.color, layout: layoutOf(t.root.firstElementChild) })) });
  toast(`Saved layout “${name}” — ${tabs.length} tab${tabs.length > 1 ? 's' : ''}`);
  if (!$('#sideWs').hidden) renderWs();
}
function openWorkspace(name) {
  const ws = workspaces[name];
  if (!ws) return;
  for (const t of ws.tabs) createTab(null, { layout: t.layout, title: t.title, color: t.color });
}
function renderWs() {
  const list = $('#wsList');
  list.innerHTML = '';
  for (const [n, ws] of Object.entries(workspaces)) {
    const panesN = JSON.stringify(ws.tabs).split('"t":"p"').length - 1;
    list.append(listItem(n, `${ws.tabs.length} tabs · ${panesN} panes · ${new Date(ws.t).toLocaleDateString()}`, [
      ['send', 'Open', () => openWorkspace(n)],
      ['export', 'Overwrite with current window', () => saveWorkspace(n)],
      ['trash', 'Delete', async () => { workspaces = await tp.workspaces.set(n, null); renderWs(); }],
    ], () => openWorkspace(n)));
  }
  if (!list.children.length) list.innerHTML = '<p class="hint">Save the tabs, splits and folders you use for a project, then reopen them in one click.</p>';
}
$('#wsSave').onclick = () => saveWorkspace();
$('#sideTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) switchSide(b.dataset.side); };
$('#sideClose').onclick = () => toggleSide(false);

function listItem(title, sub, buttons, onClick) {
  const el = div('item');
  const t = div('t'); t.textContent = title;
  const s = Object.assign(document.createElement('code'), { textContent: sub, title: sub });
  const acts = div('acts');
  for (const [ic, tip, fn] of buttons) {
    const b = Object.assign(document.createElement('button'), { className: 'tbtn', title: tip, innerHTML: icon(ic) });
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    acts.append(b);
  }
  el.append(t, s, acts);
  if (onClick) el.onclick = onClick;
  return el;
}
async function useSnippet(s, run) {
  const vars = [...new Set([...s.cmd.matchAll(/\{\{\s*([\w ]+?)\s*\}\}/g)].map((m) => m[1]))];
  let cmd = s.cmd;
  if (vars.length) {
    const v = await formBox(s.name, vars.map((k) => ({ k, label: k })), run ? 'Run' : 'Insert');
    if (!v) return;
    cmd = cmd.replace(/\{\{\s*([\w ]+?)\s*\}\}/g, (_, k) => v[k] ?? '');
  }
  insertCmd(cmd, run);
}
function renderSnips() {
  const q = $('#snipFilter').value;
  const list = $('#snipList');
  list.innerHTML = '';
  settings.snippets.forEach((s, i) => {
    if (q && !fuzzy(q, s.name + ' ' + s.cmd)) return;
    list.append(listItem(s.name, s.cmd, [
      ['insert', 'Insert', () => useSnippet(s, false)],
      ['send', 'Run', () => useSnippet(s, true)],
      ['trash', 'Delete', async () => { await setSetting({ snippets: settings.snippets.filter((_, j) => j !== i) }); renderSnips(); }],
    ], () => useSnippet(s, false)));
  });
  if (!list.children.length) list.innerHTML = '<p class="hint">No snippets. Add one below — use {{name}} for values you fill in each time.</p>';
}
$('#snipFilter').addEventListener('input', renderSnips);
$('#snipForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await setSetting({ snippets: [...settings.snippets, { name: $('#snipName').value.trim(), cmd: $('#snipCmd').value.trim() }] });
  $('#snipName').value = ''; $('#snipCmd').value = '';
  renderSnips();
});
function renderHistory() {
  const q = $('#histFilter').value;
  const list = $('#histList');
  list.innerHTML = '';
  let n = 0;
  for (const h of [...history].reverse()) {
    if (q && !fuzzy(q, h.cmd)) continue;
    if (++n > 300) break;
    const when = new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const el = listItem(h.cmd, `${h.exit ? '✗ ' + h.exit + ' · ' : ''}${folderName(h.cwd) || ''} · ${when}`, [
      ['insert', 'Insert', () => insertCmd(h.cmd, false)],
      ['send', 'Run', () => insertCmd(h.cmd, true)],
      ['copy', 'Copy', () => tp.clip.write(h.cmd)],
      ['trash', 'Forget this command', () => { tp.history.remove(h.cmd); history = history.filter((x) => x.cmd !== h.cmd); renderHistory(); }],
    ], () => insertCmd(h.cmd, false));
    el.classList.add('hist');
    if (h.exit) el.classList.add('failed');
    list.append(el);
  }
  $('#histCount').textContent = `${history.length} commands`;
  if (!n) list.innerHTML = '<p class="hint">Commands you run in PowerShell, cmd and Git Bash are saved here.</p>';
}
$('#histFilter').addEventListener('input', renderHistory);
$('#histClear').onclick = async () => {
  if (!(await confirmBox('Clear history?', 'All saved commands will be deleted. This cannot be undone.', 'Clear', { danger: true }))) return;
  tp.history.clear(); history = []; renderHistory();
};
function renderSsh() {
  const list = $('#sshList');
  list.innerHTML = '';
  for (const p of profiles.filter((x) => x.kind === 'ssh')) {
    const btns = [['send', 'Connect in new tab', () => createTab(p.id)], ['splitV', 'Connect in split', () => splitPane('auto', p.id)]];
    if (p.saved) btns.push(['trash', 'Remove', async () => { await setSetting({ sshHosts: settings.sshHosts.filter((h) => 'ssh:' + h.name !== p.id) }); renderSsh(); }]);
    list.append(listItem(p.name, p.dest + (p.fromConfig ? '  (from ~/.ssh/config)' : ''), btns, () => createTab(p.id)));
  }
  if (!list.children.length) list.innerHTML = '<p class="hint">No SSH hosts yet.</p>';
}
$('#sshForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const h = { name: $('#sshName').value.trim(), dest: $('#sshDest').value.trim(), port: +$('#sshPort').value || 0, key: $('#sshKey').value.trim() };
  if (h.dest.startsWith('-')) return toast('Host cannot start with “-”');
  await setSetting({ sshHosts: [...settings.sshHosts.filter((x) => x.name !== h.name), h] });
  for (const id of ['#sshName', '#sshDest', '#sshPort', '#sshKey']) $(id).value = '';
  renderSsh();
});

// ---------- session save / restore ----------
function nodeOf(el) {
  if (el.classList.contains('pane')) {
    const p = el._pane;
    let buf = '';
    try { buf = p.serialize.serialize({ scrollback: 800, excludeAltBuffer: true, excludeModes: true }); } catch { /* skip buffer */ }
    if (buf.length > 300000) buf = buf.slice(-300000);
    return { t: 'p', profile: p.profile.id, cwd: p.cwd, buf };
  }
  const [a, , b] = el.children;
  return { t: 's', col: el.classList.contains('col'), r: parseFloat(a.style.flexGrow) || 0.5, a: nodeOf(a), b: nodeOf(b) };
}
function buildLayout(tab, node, container) {
  if (node.t === 'p') return createPane(tab, node.profile, container, { cwd: node.cwd, buf: node.buf });
  const w = div('split' + (node.col ? ' col' : ''));
  container.append(w);
  buildLayout(tab, node.a, w);
  w.append(makeDivider(w));
  buildLayout(tab, node.b, w);
  if (node.r && node.r !== 0.5) { w.children[0].style.flex = `${node.r} 1 0`; w.children[2].style.flex = `${1 - node.r} 1 0`; }
}
function snapshot() {
  return { v: 1, active: tabs.indexOf(activeTab), tabs: tabs.map((t) => ({ title: t.custom, color: t.color, layout: nodeOf(t.root.firstElementChild) })) };
}
function saveSession() { if (elevated) return; try { tp.session.save(settings.restoreSession && tabs.length ? snapshot() : null); } catch { /* ignore */ } } // admin windows never overwrite the normal session
setInterval(() => { if (settings?.restoreSession && tabs.length) saveSession(); }, 60000);
tp.win.onCloseRequest(async () => {
  const n = allPanes().length;
  if (settings.confirmClose && n > 1 && !(await confirmBox('Close Terminal Plus?', `${tabs.length} tab${tabs.length > 1 ? 's' : ''} and ${n} shells are open.${settings.restoreSession ? ' They will be restored next time.' : ''}`, 'Close all'))) return;
  saveSession();
  tp.win.forceClose();
});
tp.win.onOpenTab(({ cwd, profile }) => createTab(profile || settings.defaultProfile, { cwd: cwd || (settings.newTabSameDir ? activePane()?.cwd : null) }));
function newTab() { createTab(settings.defaultProfile, { cwd: settings.newTabSameDir ? activePane()?.cwd : null }); }

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  if (!$('#dialog').hidden || !$('#settings').hidden) return;
  const act = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
  // Modal pickers take the keyboard first.
  if (qs) return act(() => quickSelectKey(e));
  if (sug) { const r = suggestKey(e); if (r !== 'pass') { e.preventDefault(); e.stopPropagation(); } return; }
  if (e.target.closest?.('input, textarea, select') && !e.target.closest('.xterm')) {
    if (e.key === 'Escape') { if (!$('#palette').hidden) return act(closePalette); if (!$('#findBar').hidden) return act(closeFind); }
    if (!(e.ctrlKey && e.shiftKey)) return; // let text fields type normally
  }
  const inTerm = !!e.target.closest?.('.xterm');
  const c = e.ctrlKey, s = e.shiftKey, a = e.altKey;
  if (c && !s && !a && e.code === 'KeyC' && inTerm && activePane()?.term.hasSelection()) return act(copySel); // Ctrl+C copies when text is selected, else sends ^C
  if (c && s && !a && /^Digit[1-9]$/.test(e.code)) { const p = profiles.filter((x) => x.kind !== 'ssh')[+e.code.slice(5) - 1]; if (p) return act(() => createTab(p.id)); }
  if (c && a && !s && /^Digit[1-9]$/.test(e.code)) { const t = tabs[+e.code.slice(5) - 1]; if (t) return act(() => activateTab(t)); }
  const combo = comboOf(e);
  const action = combo && actionForCombo(combo);
  if (action) return act(action.run);
  if (e.key === 'Escape') { if (!$('#palette').hidden) return act(closePalette); if (!$('#findBar').hidden) return act(closeFind); if (!$('#menu').hidden) return act(hideMenu); }
}, true);
addEventListener('mousedown', (e) => { if (sug && !e.target.closest('.suggest')) closeSuggest(); if (qs && !e.target.closest('.qs-layer')) endQuickSelect(); });

// ---------- chrome buttons ----------
$('#newTabBtn').onclick = newTab;
$('#profileBtn').onclick = showProfileMenu;
$('#paletteBtn').onclick = () => openPalette();
$('#sideBtn').onclick = () => toggleSide();
$('#settingsBtn').onclick = openSettings;
$('#pinBtn').onclick = () => setSetting({ alwaysOnTop: !settings.alwaysOnTop });
$('#minBtn').onclick = tp.win.min;
$('#maxBtn').onclick = tp.win.max;
$('#closeBtn').onclick = tp.win.close;
$('#titlebar .drag').addEventListener('dblclick', tp.win.max);
tp.win.onMax((m) => { $('#maxBtn').innerHTML = icon(m ? 'restore' : 'max'); $('#maxBtn').title = m ? 'Restore' : 'Maximize'; });
window.addEventListener('resize', () => activeTab?.panes.forEach(fitPane));

// ---------- start ----------
(async () => {
  hydrateIcons();
  let startProfile, admin;
  ({ settings, profiles, startCwd, home, startProfile, admin, elevated } = await tp.settings.get());
  if (!profiles.length) { document.body.insertAdjacentHTML('beforeend', '<p style="padding:20px">No shell found.</p>'); return; }
  if (elevated) { document.body.classList.add('admin'); $('#adminBadge').hidden = !admin; if (!admin) toast('Not running as administrator (UAC was declined)'); }
  compileRules();
  applyAll();
  workspaces = await tp.workspaces.get();
  await document.fonts.ready;
  // Admin windows and windows opened for a folder/profile start fresh; normal launches restore the last session.
  const sess = settings.restoreSession && !startCwd && !startProfile && !elevated ? await tp.session.load() : null;
  if (sess?.tabs?.length) {
    for (const t of sess.tabs) { try { createTab(null, { layout: t.layout, title: t.title, color: t.color }); } catch (e) { console.error('restore', e); } }
    if (tabs[sess.active]) activateTab(tabs[sess.active]);
  }
  if (!tabs.length) createTab(startProfile || settings.defaultProfile, { cwd: startCwd });
})();
