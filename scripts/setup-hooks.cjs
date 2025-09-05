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

  // Commit-msg hook to enforce baseline change request marker
  const commitMsgPath = join(hooksDir, 'commit-msg');
  const commitMsgContent = `#!/usr/bin/env bash\n# Auto-generated commit-msg hook for baseline change control\nif command -v pwsh >/dev/null 2>&1; then pwsh ./scripts/commit-msg-baseline.ps1 "$1"; else powershell -ExecutionPolicy Bypass -File ./scripts/commit-msg-baseline.ps1 "$1"; fi`;
  require('fs').writeFileSync(commitMsgPath, commitMsgContent, { encoding:'utf8' });
  chmodSync(commitMsgPath, 0o755);

  // Pre-push hook to enforce passing slow regression suite before pushing
  const prePushPath = join(hooksDir, 'pre-push');
  const prePushContent = `#!/usr/bin/env bash\n# Auto-generated pre-push hook to run slow regression tests\nif command -v pwsh >/dev/null 2>&1; then pwsh ./scripts/pre-push.ps1; else powershell -ExecutionPolicy Bypass -File ./scripts/pre-push.ps1; fi`;
  require('fs').writeFileSync(prePushPath, prePushContent, { encoding:'utf8' });
  chmodSync(prePushPath, 0o755);
}

main();