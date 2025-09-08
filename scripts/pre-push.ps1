Param()

# Optional bypass for infrastructure / documentation only commits.
# Set ALLOW_FAILING_SLOW=1 in the environment to skip executing slow regression suite.
if ($env:ALLOW_FAILING_SLOW -eq '1') {
  Write-Host '[pre-push] Bypass enabled (ALLOW_FAILING_SLOW=1) - skipping slow test suite.' -ForegroundColor Yellow
  exit 0
}

Write-Host '[pre-push] Running slow test suite (test:slow)...'
$env:SKIP_PRETEST_BUILD='1'
$process = Start-Process -FilePath 'npm' -ArgumentList 'run','test:slow' -NoNewWindow -PassThru -Wait
if ($process.ExitCode -ne 0) {
  Write-Host '[pre-push] Slow tests failed. Aborting push.' -ForegroundColor Red
  exit 1
}
Write-Host '[pre-push] Slow suite passed.' -ForegroundColor Green
