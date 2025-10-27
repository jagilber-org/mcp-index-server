Param()

# Optional bypass for infrastructure / documentation only commits.
# Set ALLOW_FAILING_SLOW=1 in the environment to skip executing slow regression suite.
if ($env:ALLOW_FAILING_SLOW -eq '1') {
  Write-Host '[pre-push] Bypass enabled (ALLOW_FAILING_SLOW=1) - skipping slow test suite.' -ForegroundColor Yellow
  exit 0
}

Write-Host '[pre-push] Running slow test suite (test:slow)...'
$env:SKIP_PRETEST_BUILD='1'
$npmCommand = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  Write-Host '[pre-push] Unable to locate npm on PATH.' -ForegroundColor Red
  exit 1
}
$LASTEXITCODE = 0
try {
  npm run test:slow
} catch {
  Write-Host "[pre-push] Failed to launch npm." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor DarkRed
  exit 1
}
if ($LASTEXITCODE -ne 0) {
  Write-Host '[pre-push] Slow tests failed. Aborting push.' -ForegroundColor Red
  exit $LASTEXITCODE
}
Write-Host '[pre-push] Slow suite passed.' -ForegroundColor Green
