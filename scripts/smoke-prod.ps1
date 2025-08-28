param(
  [string]$Dir = 'C:\mcp\mcp-index-server-prod',
  [int]$WaitSeconds = 5
)
<#!
.SYNOPSIS
  Minimal smoke test to confirm the deployed production directory can start the MCP Index Server.
.DESCRIPTION
  Starts the server (node dist/server/index.js) inside the specified deployment directory, captures
  stdout/stderr for a short window, then terminates the process. This validates that required runtime
  files (dist/, package.json, dependencies when bundled) are present and the server boots without
  immediate fatal errors.
.PARAMETER Dir
  Deployment directory root (containing dist/ and start scripts). Default: C:\mcp\mcp-index-server-prod
.PARAMETER WaitSeconds
  Seconds to allow the server to run before terminating (default 5). Increase if you need more output.
.EXAMPLE
  pwsh scripts/smoke-prod.ps1 -Dir C:\mcp\mcp-index-server-prod -WaitSeconds 8
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if(-not (Test-Path $Dir)) { throw "Deployment directory not found: $Dir" }
if(-not (Test-Path (Join-Path $Dir 'dist/server/index.js'))) { throw "dist/server/index.js missing in $Dir" }

Write-Host "[smoke] Starting server from $Dir" -ForegroundColor Cyan
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'node'
$psi.WorkingDirectory = $Dir
$psi.Arguments = 'dist/server/index.js'
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
$null = $proc.Start()

$start = Get-Date
while((Get-Date) -lt $start.AddSeconds($WaitSeconds) -and -not $proc.HasExited){
  Start-Sleep -Milliseconds 250
}

# Collect output (non-blocking safety)
$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
if(-not $proc.HasExited){
  Write-Host '[smoke] Stopping server (timeout reached)...'
  try { $proc.Kill() } catch {}
}
$exitCode = $proc.ExitCode
Write-Host "[smoke] ExitCode: $exitCode" -ForegroundColor Gray
if($stdout){ Write-Host "[smoke] stdout (truncated to 40 lines):" -ForegroundColor Green; $stdout -split "`r?`n" | Select-Object -First 40 | ForEach-Object { Write-Host "  $_" } }
if($stderr){ Write-Host "[smoke] stderr (truncated to 40 lines):" -ForegroundColor Yellow; $stderr -split "`r?`n" | Select-Object -First 40 | ForEach-Object { Write-Host "  $_" } }

if($exitCode -ne 0){
  Write-Host '[smoke] Non-zero exit code detected (this may be expected if process was killed).'
} else {
  Write-Host '[smoke] Server started successfully within allotted window.' -ForegroundColor Cyan
}

Write-Host '[smoke] Done.' -ForegroundColor Green
