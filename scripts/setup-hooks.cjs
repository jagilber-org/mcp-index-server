const { existsSync, mkdirSync, copyFileSync, chmodSync } = require('fs');
const { join } = require('path');

function main(){
  if(!existsSync('.git')) return; // not a git repo yet
  const hooksDir = join('.git','hooks');
  if(!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  // Pre-commit hook wrapper to invoke PowerShell script
  const hookPath = join(hooksDir, 'pre-commit');
  const content = `#!/usr/bin/env bash\n# Auto-generated hook installs PowerShell pre-commit\nif command -v pwsh >/dev/null 2>&1; then pwsh ./scripts/pre-commit.ps1; else powershell -ExecutionPolicy Bypass -File ./scripts/pre-commit.ps1; fi`;
  require('fs').writeFileSync(hookPath, content, { encoding:'utf8' });
  chmodSync(hookPath, 0o755);
}

main();