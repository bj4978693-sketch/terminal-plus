// Downloads the bundled command-line tools and Nerd Font into vendor/ (run before `npm run dist`).
// Versions are pinned so every build ships the same files. Bump a tag here to update a tool.
// Usage: node scripts/fetch-tools.js   (set GITHUB_TOKEN to avoid API rate limits; not required)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', 'vendor');
const BIN = path.join(ROOT, 'bin');
const FONTS = path.join(ROOT, 'fonts');
const LIC = path.join(ROOT, 'licenses');

const gh = (repo, tag, asset) => `https://github.com/${repo}/releases/download/${tag}/${asset}`;
const raw = (repo, ref, file) => `https://raw.githubusercontent.com/${repo}/${ref}/${file}`;

// exe: files to keep from the archive. license: path in the repo for tools whose zip has no license.
const TOOLS = [
  { name: 'starship', repo: 'starship/starship', tag: 'v1.27.0', asset: 'starship-x86_64-pc-windows-msvc.zip', exe: ['starship.exe'], license: 'LICENSE' },
  { name: 'zoxide', repo: 'ajeetdsouza/zoxide', tag: 'v0.10.0', asset: 'zoxide-0.10.0-x86_64-pc-windows-msvc.zip', exe: ['zoxide.exe'] },
  { name: 'fzf', repo: 'junegunn/fzf', tag: 'v0.75.0', asset: 'fzf-0.75.0-windows_amd64.zip', exe: ['fzf.exe'], license: 'LICENSE' },
  { name: 'ripgrep', repo: 'BurntSushi/ripgrep', tag: '15.2.0', asset: 'ripgrep-15.2.0-x86_64-pc-windows-msvc.zip', exe: ['rg.exe'] },
  { name: 'bat', repo: 'sharkdp/bat', tag: 'v0.26.1', asset: 'bat-v0.26.1-x86_64-pc-windows-msvc.zip', exe: ['bat.exe'] },
  { name: 'fd', repo: 'sharkdp/fd', tag: 'v10.5.2', asset: 'fd-v10.5.2-x86_64-pc-windows-msvc.zip', exe: ['fd.exe'] },
  { name: 'eza', repo: 'eza-community/eza', tag: 'v0.23.5', asset: 'eza.exe_x86_64-pc-windows-gnu.zip', exe: ['eza.exe'], license: 'LICENSE.txt' },
  { name: 'delta', repo: 'dandavison/delta', tag: '0.21.1', asset: 'delta-0.21.1-x86_64-pc-windows-msvc.zip', exe: ['delta.exe'] },
  { name: 'lazygit', repo: 'jesseduffield/lazygit', tag: 'v0.66.3', asset: 'lazygit_0.66.3_windows_x86_64.zip', exe: ['lazygit.exe'] },
  { name: 'dust', repo: 'bootandy/dust', tag: 'v1.2.7', asset: 'dust-v1.2.7-x86_64-pc-windows-msvc.zip', exe: ['dust.exe'], license: 'LICENSE' },
  { name: 'jq', repo: 'jqlang/jq', tag: 'jq-1.8.2', asset: 'jq-windows-amd64.exe', rename: 'jq.exe', license: 'COPYING' },
];
const FONT_FILES = ['JetBrainsMonoNLNerdFontMono-Regular.ttf', 'JetBrainsMonoNLNerdFontMono-Bold.ttf', 'JetBrainsMonoNLNerdFontMono-Italic.ttf', 'JetBrainsMonoNLNerdFontMono-BoldItalic.ttf'];

async function download(url, file) {
  const headers = { 'User-Agent': 'terminal-plus-build' };
  if (process.env.GITHUB_TOKEN && url.includes('github.com/')) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let i = 1; i <= 3; i++) {
    const r = await fetch(url, { headers, redirect: 'follow' });
    if (r.ok) { fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return; }
    if (i === 3) throw new Error(`${r.status} ${url}`);
    await new Promise((res) => setTimeout(res, 1500 * i));
  }
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

async function main() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  for (const d of [BIN, FONTS, LIC]) fs.mkdirSync(d, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-tools-'));
  const versions = {};
  try {
    for (const t of TOOLS) {
      const dl = path.join(tmp, t.asset);
      await download(gh(t.repo, t.tag, t.asset), dl);
      const lic = path.join(LIC, t.name);
      fs.mkdirSync(lic, { recursive: true });
      if (t.rename) {
        fs.copyFileSync(dl, path.join(BIN, t.rename));
      } else {
        const out = path.join(tmp, t.name);
        fs.mkdirSync(out);
        // Windows' own tar.exe (bsdtar) extracts zip; Git Bash's GNU tar would misread "C:" as a host.
        execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', dl, '-C', out]);
        const files = walk(out);
        for (const exe of t.exe) {
          const f = files.find((x) => path.basename(x).toLowerCase() === exe);
          if (!f) throw new Error(`${exe} not found in ${t.asset}`);
          fs.copyFileSync(f, path.join(BIN, exe));
        }
        for (const f of files.filter((x) => /^(license|copying|unlicense|notice)/i.test(path.basename(x)))) fs.copyFileSync(f, path.join(lic, path.basename(f)));
      }
      if (t.license && !fs.readdirSync(lic).length) await download(raw(t.repo, t.tag, t.license), path.join(lic, path.basename(t.license)));
      if (!fs.readdirSync(lic).length) throw new Error(`no license file for ${t.name}`);
      versions[t.name] = t.tag;
      console.log(`  ✓ ${t.name} ${t.tag}`);
    }
    const nf = 'patched-fonts/JetBrainsMono/NoLigatures';
    for (const f of FONT_FILES) await download(raw('ryanoasis/nerd-fonts', 'v3.5.1', `${nf}/${f}`), path.join(FONTS, f));
    fs.mkdirSync(path.join(LIC, 'nerd-fonts'), { recursive: true });
    await download(raw('ryanoasis/nerd-fonts', 'v3.5.1', `${nf}/OFL.txt`), path.join(LIC, 'nerd-fonts', 'OFL.txt'));
    versions['JetBrainsMono Nerd Font'] = 'v3.5.1';
    console.log('  ✓ JetBrainsMono Nerd Font v3.5.1');
    fs.writeFileSync(path.join(ROOT, 'versions.json'), JSON.stringify(versions, null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const size = walk(ROOT).reduce((s, f) => s + fs.statSync(f).size, 0);
  console.log(`vendor/ ready: ${Object.keys(versions).length} items, ${(size / 1048576).toFixed(1)} MB`);
}
main().catch((e) => { console.error('fetch-tools failed:', e.message); process.exit(1); });
