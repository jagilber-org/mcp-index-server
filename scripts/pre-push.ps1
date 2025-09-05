Param()
Write-Host '[pre-push] Running slow test suite (test:slow)...'
$env:SKIP_PRETEST_BUILD='1'
$process = Start-Process -FilePath 'npm' -ArgumentList 'run','test:slow' -NoNewWindow -PassThru -Wait
if ($process.ExitCode -ne 0) {
  Write-Host '[pre-push] Slow tests failed. Aborting push.' -ForegroundColor Red
  exit 1
}
Write-Host '[pre-push] Slow suite passed.' -ForegroundColor Green
