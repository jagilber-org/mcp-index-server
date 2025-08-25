Param()
Write-Host "Running pre-commit checks..." -ForegroundColor Cyan
$errors = 0

function Fail($msg){ Write-Host "[FAIL] $msg" -ForegroundColor Red; $GLOBALS:errors++ }
function Info($msg){ Write-Host "[INFO] $msg" -ForegroundColor Gray }

// Ensure build artifacts are fresh (tests spawn dist/server/index.js)
Info 'Build'
try { npm run build --silent | Out-Null } catch { Fail 'Build failed' }

# 1. Typecheck
Info 'Typechecking'
try { npm run typecheck --silent | Out-Null } catch { Fail 'Typecheck failed'; }

# 2. Lint
Info 'Lint'
try { npm run lint --silent | Out-Null } catch { Fail 'Lint failed' }

# 3. Unit tests (quick)
Info 'Unit tests'
try { npm test --silent | Out-Null } catch { Fail 'Tests failed' }

# 4. Secret scan (simple regex)
Info 'Secret scan'
$patterns = @('AKIA[0-9A-Z]{16}','(?i)secret[_-]?key\s*[:=]','-----BEGIN PRIVATE KEY-----','ghp_[0-9A-Za-z]{36}')
$staged = git diff --cached --name-only | Where-Object { $_ -and (Test-Path $_) -and ($_ -notmatch '^scripts/pre-commit.ps1$') }
foreach($file in $staged){
  $content = Get-Content -Raw -ErrorAction SilentlyContinue -Path $file
  foreach($pat in $patterns){
    if($content -match $pat){ Fail "Potential secret match in $file ($pat)" }
  }
}

if($errors -gt 0){
  Write-Host "Pre-commit failed with $errors issue(s)." -ForegroundColor Red
  exit 1
}
Write-Host 'Pre-commit checks passed.' -ForegroundColor Green
exit 0
