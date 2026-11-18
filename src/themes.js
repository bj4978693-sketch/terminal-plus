// Built-in color schemes. `ui` drives the chrome, the rest is the xterm theme.
window.THEMES = {
  carbon: { label: 'Carbon (dark)', ui: 'dark', background: '#0f1115', foreground: '#d8dee9', cursor: '#5aa9ff', selectionBackground: '#2f4a6d',
    black: '#1c1f26', red: '#ff6b6b', green: '#7ee787', yellow: '#f2cc60', blue: '#5aa9ff', magenta: '#c792ea', cyan: '#5fd7e6', white: '#d8dee9',
    brightBlack: '#5c6370', brightRed: '#ff8787', brightGreen: '#a6f0a6', brightYellow: '#ffe08a', brightBlue: '#8cc4ff', brightMagenta: '#dcb4ff', brightCyan: '#8ce9f5', brightWhite: '#ffffff' },
  daylight: { label: 'Daylight (light)', ui: 'light', background: '#fbfbfc', foreground: '#1f2328', cursor: '#0b5cd5', selectionBackground: '#cfe3ff',
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#7d4e00', blue: '#0550ae', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f' },
  ocean: { label: 'Ocean', ui: 'dark', background: '#0b1726', foreground: '#cfe6ff', cursor: '#4fd1ff', selectionBackground: '#1d3d63',
    black: '#0f2238', red: '#ff7a90', green: '#5ef2b5', yellow: '#ffd479', blue: '#4fa3ff', magenta: '#b48bff', cyan: '#4fd1ff', white: '#cfe6ff',
    brightBlack: '#4a6687', brightRed: '#ff9aab', brightGreen: '#8cf7cc', brightYellow: '#ffe2a3', brightBlue: '#7fbcff', brightMagenta: '#cbadff', brightCyan: '#86e1ff', brightWhite: '#ffffff' },
  ember: { label: 'Ember', ui: 'dark', background: '#1a1210', foreground: '#f3e3d3', cursor: '#ff9e3d', selectionBackground: '#4a2c1e',
    black: '#2a1d19', red: '#ff5f4a', green: '#b8d86b', yellow: '#ffb547', blue: '#7aa6da', magenta: '#e58ac9', cyan: '#7fd3c7', white: '#f3e3d3',
    brightBlack: '#6e5547', brightRed: '#ff8a78', brightGreen: '#d1ec8b', brightYellow: '#ffcc7a', brightBlue: '#a2c4ec', brightMagenta: '#f1aedb', brightCyan: '#a3e6dc', brightWhite: '#fff8f0' },
  matrix: { label: 'Matrix', ui: 'dark', background: '#030a04', foreground: '#5dff7a', cursor: '#9dffad', selectionBackground: '#11421b',
    black: '#03140a', red: '#3aff5c', green: '#5dff7a', yellow: '#b6ff5d', blue: '#2bd96a', magenta: '#7dffb0', cyan: '#5dffcf', white: '#c8ffd0',
    brightBlack: '#1f6b30', brightRed: '#7dff95', brightGreen: '#9dffad', brightYellow: '#d9ff9d', brightBlue: '#6dffa0', brightMagenta: '#adffd0', brightCyan: '#9dffe4', brightWhite: '#effff1' },
  glacier: { label: 'Glacier', ui: 'dark', background: '#1d2330', foreground: '#d8dee9', cursor: '#88c0d0', selectionBackground: '#3b4a63',
    black: '#2b3242', red: '#e06c75', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#5b6680', brightRed: '#f08a92', brightGreen: '#bcd4a6', brightYellow: '#f3dba8', brightBlue: '#9db8d6', brightMagenta: '#c9a6c4', brightCyan: '#a5d4e0', brightWhite: '#eceff4' },
  grape: { label: 'Grape', ui: 'dark', background: '#1a1426', foreground: '#e6dcff', cursor: '#c38bff', selectionBackground: '#3d2c5c',
    black: '#251c36', red: '#ff6e9c', green: '#8ff0b4', yellow: '#ffd36e', blue: '#8fa6ff', magenta: '#c38bff', cyan: '#7fe3f0', white: '#e6dcff',
    brightBlack: '#5e4d80', brightRed: '#ff94b6', brightGreen: '#b3f6cc', brightYellow: '#ffe299', brightBlue: '#b0c0ff', brightMagenta: '#d8b0ff', brightCyan: '#a8eef6', brightWhite: '#ffffff' },
  rose: { label: 'Rose', ui: 'dark', background: '#1f1418', foreground: '#f5dfe5', cursor: '#ff7aa2', selectionBackground: '#4a2733',
    black: '#2c1c22', red: '#ff6b81', green: '#9fd8a4', yellow: '#f6c177', blue: '#8aa8f0', magenta: '#ff7aa2', cyan: '#8fd3d6', white: '#f5dfe5',
    brightBlack: '#6e4b57', brightRed: '#ff94a5', brightGreen: '#bce6bf', brightYellow: '#f9d4a0', brightBlue: '#adc1f5', brightMagenta: '#ffa3bf', brightCyan: '#b0e2e4', brightWhite: '#fff4f7' },
  paper: { label: 'Paper (light)', ui: 'light', background: '#f6f1e7', foreground: '#3a3530', cursor: '#b5651d', selectionBackground: '#e3d6bd',
    black: '#3a3530', red: '#b03a2e', green: '#4f7a28', yellow: '#9a6a00', blue: '#2f5f9e', magenta: '#8a4f9e', cyan: '#2c7c7c', white: '#8c8478',
    brightBlack: '#6b645a', brightRed: '#cc4a3c', brightGreen: '#5f9131', brightYellow: '#b07c00', brightBlue: '#3c74bd', brightMagenta: '#a061b5', brightCyan: '#379595', brightWhite: '#a8a094' },
  contrast: { label: 'High Contrast', ui: 'dark', background: '#000000', foreground: '#ffffff', cursor: '#ffff00', selectionBackground: '#1aebff', selectionForeground: '#000000',
    black: '#000000', red: '#ff4040', green: '#3cff3c', yellow: '#ffff00', blue: '#5c9dff', magenta: '#ff5cff', cyan: '#1aebff', white: '#ffffff',
    brightBlack: '#a0a0a0', brightRed: '#ff7070', brightGreen: '#80ff80', brightYellow: '#ffff80', brightBlue: '#8cbaff', brightMagenta: '#ff8cff', brightCyan: '#80f5ff', brightWhite: '#ffffff' },
  mono: { label: 'Mono', ui: 'dark', background: '#121212', foreground: '#d4d4d4', cursor: '#ffffff', selectionBackground: '#3a3a3a',
    black: '#1e1e1e', red: '#bdbdbd', green: '#d4d4d4', yellow: '#e0e0e0', blue: '#a8a8a8', magenta: '#c4c4c4', cyan: '#b8b8b8', white: '#d4d4d4',
    brightBlack: '#6e6e6e', brightRed: '#e0e0e0', brightGreen: '#eeeeee', brightYellow: '#f5f5f5', brightBlue: '#cfcfcf', brightMagenta: '#e6e6e6', brightCyan: '#dadada', brightWhite: '#ffffff' },
};

// Convert a Windows Terminal / iTerm-style JSON color scheme into our theme format.
window.importScheme = (json) => {
  const s = typeof json === 'string' ? JSON.parse(json) : json;
  const pick = (...k) => k.map((x) => s[x]).find((v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v));
  const bg = pick('background');
  const fg = pick('foreground');
  if (!bg || !fg) throw new Error('Scheme needs "background" and "foreground" as #rrggbb colors');
  const lum = parseInt(bg.slice(1, 3), 16) * 0.299 + parseInt(bg.slice(3, 5), 16) * 0.587 + parseInt(bg.slice(5, 7), 16) * 0.114;
  const t = { label: String(s.name || 'Imported').slice(0, 40), ui: lum > 140 ? 'light' : 'dark', background: bg, foreground: fg,
    cursor: pick('cursorColor', 'cursor') || fg, selectionBackground: pick('selectionBackground') || '#44475a' };
  for (const c of ['black', 'red', 'green', 'yellow', 'blue', 'cyan', 'white']) {
    t[c] = pick(c) || window.THEMES.carbon[c];
    const B = 'bright' + c[0].toUpperCase() + c.slice(1);
    t[B] = pick(B) || t[c];
  }
  t.magenta = pick('purple', 'magenta') || window.THEMES.carbon.magenta;
  t.brightMagenta = pick('brightPurple', 'brightMagenta') || t.magenta;
  return t;
};
