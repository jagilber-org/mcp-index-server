param(
    [switch]$SkipTests,
    [switch]$SkipLint
)

$ErrorActionPreference = 'Stop'

function Write-Section($title) {
  Write-Host "`n=== $title ===" -ForegroundColor Cyan
}

# Ensure we're at repo root (script lives in scripts/)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir '..')

Write-Section "Type Check"

# Simple file lock to avoid overlapping build:verify executions that race on cleaning dist/
# Extend wait to cover full typical test duration; only break if explicitly allowed via env.
$lock = ".build.lock"
if (Test-Path $lock) {
  if ($env:ALLOW_STALE_BUILD_LOCK -eq '1') {
    Write-Host "Detected build lock but ALLOW_STALE_BUILD_LOCK=1 set. Forcing immediate override." -ForegroundColor Yellow
    try { Remove-Item $lock -ErrorAction SilentlyContinue } catch {}
  } else {
    Write-Host "Detected existing build lock. Waiting for it to release..." -ForegroundColor DarkGray
    $waitStart = Get-Date
    $maxWaitSeconds = 240
    while (Test-Path $lock) {
      Start-Sleep -Milliseconds 300
      $elapsed = (New-TimeSpan -Start $waitStart -End (Get-Date)).TotalSeconds
      if ($elapsed -gt $maxWaitSeconds) {
        if ($env:ALLOW_STALE_BUILD_LOCK -eq '1') {
          Write-Host "Stale build lock exceeded $maxWaitSeconds s and ALLOW_STALE_BUILD_LOCK=1 set. Proceeding (no dist clean)." -ForegroundColor Yellow
          break
        } else {
          Write-Host "Stale build lock exceeded $maxWaitSeconds s. Exiting to avoid overlapping clean. Set ALLOW_STALE_BUILD_LOCK=1 to override." -ForegroundColor Red
          exit 1
        }
      }
    }
  }
}
New-Item -Path $lock -ItemType File -Force | Out-Null
try {
  # Pre-clean dist to avoid stale compiled artifacts on the FIRST run only. Subsequent rapid cycles
  # are likely intentional re-verifications where cleaning introduces a race with test spawns.
  # We honor either a dist/.keep sentinel (legacy) or a repo-root .dist.keep sentinel.
  $rootSentinel = '.dist.keep'
  $distSentinel = Join-Path dist '.keep'
  $distServerIndex = Join-Path dist 'server' | Join-Path -ChildPath 'index.js'
  if (Test-Path dist) {
    $hasRoot = Test-Path $rootSentinel
    $hasDist = Test-Path $distSentinel
    if (-not $hasRoot -and -not $hasDist) {
      # Self-heal: if a prior successful compile exists (server/index.js present) recreate sentinel instead of cleaning.
      if (Test-Path $distServerIndex) {
        Write-Host "Sentinels missing but build output present; recreating sentinel to avoid unnecessary clean" -ForegroundColor DarkYellow
        try { Set-Content -Path $rootSentinel -Value 'persist dist between rapid test cycles (self-healed)' -Encoding UTF8 } catch {}
        try {
          if (-not (Test-Path $distSentinel)) { Set-Content -Path $distSentinel -Value 'dist sentinel (self-healed)' -Encoding UTF8 }
        } catch {}
      }
    }
    $hasRoot = Test-Path $rootSentinel
    $hasDist = Test-Path $distSentinel
    if (-not $hasRoot -and -not $hasDist) {
      Write-Host "Cleaning dist/ to remove stale artifacts (no sentinel present and no server/index.js)" -ForegroundColor Yellow
      try { Remove-Item -Recurse -Force dist -ErrorAction Stop } catch { Write-Host "Warning: dist clean failed: $($_.Exception.Message)" -ForegroundColor Yellow }
    } else {
      Write-Host "Skipping dist clean due to sentinel (dist/.keep or .dist.keep)" -ForegroundColor DarkYellow
    }
  }

  npm run typecheck | Write-Host

  Write-Section "Compile"
  npm run build | Write-Host
  # Immediately create/update sentinels after a successful compile so rapid subsequent cycles skip cleaning.
  try {
    if (-not (Test-Path $rootSentinel)) { Set-Content -Path $rootSentinel -Value 'persist dist between rapid test cycles' -Encoding UTF8 }
    if (-not (Test-Path $distSentinel)) {
      if (-not (Test-Path dist)) { New-Item -ItemType Directory -Path dist | Out-Null }
      Set-Content -Path $distSentinel -Value 'dist sentinel' -Encoding UTF8
    }
    Write-Host "Ensured dist sentinels (.dist.keep & dist/.keep)" -ForegroundColor DarkGray
  } catch {
    Write-Host "Warning: failed to create dist sentinels: $($_.Exception.Message)" -ForegroundColor Yellow
  }

  if (-not $SkipLint) {
    Write-Section "Lint"
    npm run lint | Write-Host
  }

  if (-not $SkipTests) {
    Write-Section "Unit Tests"
  # Enforce no skipped tests before executing suite
  Write-Host "Running skip guard (guard:skips)" -ForegroundColor DarkCyan
  node scripts/check-no-skips.mjs
  # Avoid triggering a second concurrent build via package.json pretest hook.
  # We compile explicitly above; set flag so new pretest script is a no-op.
  $env:SKIP_PRETEST_BUILD = '1'
  # (duplicate safeguard if script structure refactored) ensure flag still present
  if (-not $env:SKIP_PRETEST_BUILD) { $env:SKIP_PRETEST_BUILD = '1' }
  npm test | Write-Host

    Write-Section "Contract Schemas"
    npm run test:contracts | Write-Host
  }

  Write-Section "Done"
}
finally {
  Remove-Item $lock -ErrorAction SilentlyContinue
}
