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
npm run typecheck | Write-Host

Write-Section "Compile"
npm run build | Write-Host

if (-not $SkipLint) {
  Write-Section "Lint"
  npm run lint | Write-Host
}

if (-not $SkipTests) {
  Write-Section "Unit Tests"
  npm test | Write-Host

  Write-Section "Contract Schemas"
  npm run test:contracts | Write-Host
}

Write-Section "Done"
