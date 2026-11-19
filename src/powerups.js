// Power-ups: popular open-source terminal tools (GitHub stars as of Nov 2026), installable with winget.
// `bin` is checked on PATH to show "Installed". `setup` lines are added to the shell's startup file.
const psProfile = (line) => `if (!(Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force | Out-Null }; if (!(Select-String -Path $PROFILE -SimpleMatch -Quiet '${line.replace(/'/g, "''")}')) { Add-Content -Path $PROFILE -Value '${line.replace(/'/g, "''")}' }; . $PROFILE`;
const bashRc = (line) => `grep -qxF '${line.replace(/'/g, `'\\''`)}' ~/.bashrc 2>/dev/null || echo '${line.replace(/'/g, `'\\''`)}' >> ~/.bashrc; source ~/.bashrc`;
const psModule = (name) => `Install-Module ${name} -Scope CurrentUser -Force -AllowClobber`;

window.POWERUPS = [
  // ----- Prompt -----
  { name: 'Starship', repo: 'starship/starship', stars: '61k', cat: 'Prompt', bin: 'starship', winget: 'Starship.Starship',
    desc: 'Fast, beautiful prompt showing git branch, language versions and command time. Works in every shell.',
    setup: { powershell: psProfile('Invoke-Expression (&starship init powershell)'), bash: bashRc('eval "$(starship init bash)"') }, needsFont: true },
  { name: 'Oh My Posh', repo: 'JanDeDobbeleer/oh-my-posh', stars: '24k', cat: 'Prompt', bin: 'oh-my-posh', winget: 'JanDeDobbeleer.OhMyPosh',
    desc: 'Prompt theme engine with 100+ ready-made themes.',
    setup: { powershell: psProfile('oh-my-posh init pwsh | Invoke-Expression'), bash: bashRc('eval "$(oh-my-posh init bash)"') }, needsFont: true },
  { name: 'JetBrains Mono Nerd Font', repo: 'ryanoasis/nerd-fonts', stars: '65k', cat: 'Prompt', winget: 'DEVCOM.JetBrainsMonoNerdFont',
    desc: 'Programming font with thousands of icons. Needed for the icons in Starship, Oh My Posh, eza and Terminal-Icons.',
    font: "'JetBrainsMono Nerd Font', 'JetBrainsMono NF', 'Cascadia Mono', Consolas, monospace" },
  { name: 'Clink', repo: 'chrisant996/clink', stars: '6k', cat: 'Prompt', bin: 'clink', winget: 'chrisant996.Clink',
    desc: 'Gives Command Prompt (cmd) Bash-style editing, history search, completion and Lua scripting.',
    setup: { cmd: 'clink autorun install' } },
  { name: 'PSReadLine predictions', repo: 'PowerShell/PSReadLine', stars: '4k', cat: 'Prompt', psModule: 'PSReadLine',
    desc: 'Grey suggestions from your history as you type in PowerShell, with a list view (F2 toggles).',
    install: psModule('PSReadLine') + ' -SkipPublisherCheck',
    setup: { powershell: psProfile('Set-PSReadLineOption -PredictionSource History -PredictionViewStyle ListView') } },
  { name: 'Terminal-Icons', repo: 'devblackops/Terminal-Icons', stars: '3k', cat: 'Prompt', psModule: 'Terminal-Icons',
    desc: 'File and folder icons and colors in PowerShell directory listings.',
    install: psModule('Terminal-Icons'), setup: { powershell: psProfile('Import-Module Terminal-Icons') }, needsFont: true },
  { name: 'posh-git', repo: 'dahlbyk/posh-git', stars: '8k', cat: 'Prompt', psModule: 'posh-git',
    desc: 'Git status in the PowerShell prompt and tab completion for git commands and branches.',
    install: psModule('posh-git'), setup: { powershell: psProfile('Import-Module posh-git') } },

  // ----- Navigate & search -----
  { name: 'zoxide', repo: 'ajeetdsouza/zoxide', stars: '41k', cat: 'Navigate & search', bin: 'zoxide', winget: 'ajeetdsouza.zoxide',
    desc: 'Smarter cd: type "z proj" to jump to any folder you have visited.',
    setup: { powershell: psProfile('Invoke-Expression (& { (zoxide init powershell | Out-String) })'), bash: bashRc('eval "$(zoxide init bash)"') }, try: 'z' },
  { name: 'fzf', repo: 'junegunn/fzf', stars: '84k', cat: 'Navigate & search', bin: 'fzf', winget: 'junegunn.fzf',
    desc: 'Fuzzy finder for files, history, anything you pipe into it.', try: 'fzf' },
  { name: 'PSFzf', repo: 'kelleyma49/PSFzf', stars: '1k', cat: 'Navigate & search', psModule: 'PSFzf',
    desc: 'fzf inside PowerShell: Ctrl+R fuzzy history search, Ctrl+T file picker. Needs fzf.',
    install: psModule('PSFzf'), setup: { powershell: psProfile("Import-Module PSFzf; Set-PsFzfOption -PSReadlineChordProvider 'Ctrl+t' -PSReadlineChordReverseHistory 'Ctrl+r'") } },
  { name: 'ripgrep', repo: 'BurntSushi/ripgrep', stars: '70k', cat: 'Navigate & search', bin: 'rg', winget: 'BurntSushi.ripgrep.MSVC',
    desc: 'Search inside files very fast; skips .gitignore files. Use: rg "text".', try: 'rg --help' },
  { name: 'fd', repo: 'sharkdp/fd', stars: '45k', cat: 'Navigate & search', bin: 'fd', winget: 'sharkdp.fd',
    desc: 'Simple, fast file finder. Use: fd name.', try: 'fd' },

  // ----- Files -----
  { name: 'eza', repo: 'eza-community/eza', stars: '24k', cat: 'Files', bin: 'eza', winget: 'eza-community.eza',
    desc: 'Modern ls with colors, icons, git status and tree view.', try: 'eza -la --icons --git', needsFont: true },
  { name: 'bat', repo: 'sharkdp/bat', stars: '61k', cat: 'Files', bin: 'bat', winget: 'sharkdp.bat',
    desc: 'cat with syntax highlighting, line numbers and git changes.', try: 'bat README.md' },
  { name: 'dust', repo: 'bootandy/dust', stars: '13k', cat: 'Files', bin: 'dust', winget: 'bootandy.dust',
    desc: 'See what is using disk space, as a bar chart.', try: 'dust' },
  { name: 'duf', repo: 'muesli/duf', stars: '15k', cat: 'Files', bin: 'duf', winget: 'muesli.duf',
    desc: 'Free space on every drive, in a clean table.', try: 'duf' },
  { name: '7-Zip', repo: 'ip7z/7zip', stars: '5k', cat: 'Files', bin: '7z', winget: '7zip.7zip',
    desc: 'Compress and extract zip, 7z, tar, rar and more from the terminal.', try: '7z' },

  // ----- Git & dev -----
  { name: 'lazygit', repo: 'jesseduffield/lazygit', stars: '84k', cat: 'Git & dev', bin: 'lazygit', winget: 'JesseDuffield.lazygit',
    desc: 'Full git interface inside the terminal: stage, commit, branch, rebase with the keyboard.', try: 'lazygit' },
  { name: 'delta', repo: 'dandavison/delta', stars: '33k', cat: 'Git & dev', bin: 'delta', winget: 'dandavison.delta',
    desc: 'Readable, syntax-highlighted git diffs.', setup: { any: 'git config --global core.pager delta' } },
  { name: 'GitHub CLI', repo: 'cli/cli', stars: '47k', cat: 'Git & dev', bin: 'gh', winget: 'GitHub.cli',
    desc: 'Pull requests, issues and releases from the terminal.', try: 'gh auth login' },
  { name: 'jq', repo: 'jqlang/jq', stars: '36k', cat: 'Git & dev', bin: 'jq', winget: 'jqlang.jq',
    desc: 'Slice and pretty-print JSON.', try: 'jq --help' },
  { name: 'xh', repo: 'ducaale/xh', stars: '8k', cat: 'Git & dev', bin: 'xh', winget: 'ducaale.xh',
    desc: 'Friendly HTTP requests with colored output. Use: xh httpbin.org/json.', try: 'xh httpbin.org/json' },
  { name: 'hyperfine', repo: 'sharkdp/hyperfine', stars: '29k', cat: 'Git & dev', bin: 'hyperfine', winget: 'sharkdp.hyperfine',
    desc: 'Benchmark commands with statistics.', try: 'hyperfine --help' },
  { name: 'Neovim', repo: 'neovim/neovim', stars: '104k', cat: 'Git & dev', bin: 'nvim', winget: 'Neovim.Neovim',
    desc: 'Fast, extensible terminal text editor.', try: 'nvim' },

  // ----- System -----
  { name: 'bottom', repo: 'ClementTsang/bottom', stars: '14k', cat: 'System', bin: 'btm', winget: 'Clement.bottom',
    desc: 'Graphical CPU, memory, network and process monitor.', try: 'btm' },
  { name: 'gping', repo: 'orf/gping', stars: '13k', cat: 'System', bin: 'gping', winget: 'orf.gping',
    desc: 'Ping with a live graph. Use: gping google.com.', try: 'gping 1.1.1.1' },
  { name: 'fastfetch', repo: 'fastfetch-cli/fastfetch', stars: '25k', cat: 'System', bin: 'fastfetch', winget: 'Fastfetch-cli.Fastfetch',
    desc: 'Show your PC specs with a logo, the classic terminal screenshot.', try: 'fastfetch' },
  { name: 'gsudo', repo: 'gerardog/gsudo', stars: '6k', cat: 'System', bin: 'gsudo', winget: 'gerardog.gsudo',
    desc: 'Run one command as administrator without opening a new window. Use: gsudo <command>.', try: 'gsudo' },
  { name: 'tldr (tealdeer)', repo: 'tealdeer-rs/tealdeer', stars: '7k', cat: 'System', bin: 'tldr', winget: 'dbrgn.tealdeer',
    desc: 'Short, practical examples for commands. Use: tldr tar.', try: 'tldr --update' },
  { name: 'Nushell', repo: 'nushell/nushell', stars: '41k', cat: 'System', bin: 'nu', winget: 'Nushell.Nushell',
    desc: 'A modern shell where output is structured tables. Add it as a profile after installing.', try: 'nu' },
];

window.STARTER_PACK = ['Starship', 'JetBrains Mono Nerd Font', 'zoxide', 'fzf', 'eza', 'bat', 'ripgrep'];
