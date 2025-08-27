<#
.SYNOPSIS
  Builds and deploys the MCP Index Server to a local production-style directory (default: C:\mcp\mcp-index-server).

.DESCRIPTION
  Copies only the runtime necessities (dist, package.json, LICENSE, README excerpt, instructions directory) and
  creates convenience launch scripts (start.ps1 / start.cmd). Intended for single‑machine, non-network MCP usage.

.PARAMETER Destination
  Target root directory. Default: C:\mcp\mcp-index-server

.PARAMETER Rebuild
  When specified, runs `npm ci && npm run build` before copying.

.PARAMETER Overwrite
  When specified, existing destination content is removed first.

.EXAMPLE
  pwsh scripts/deploy-local.ps1 -Destination C:\mcp\mcp-index-server -Rebuild -Overwrite

.NOTES
  Does not install devDependencies outside the build step. Runtime only needs the compiled dist.
#>
param(
  [string]$Destination = 'C:\mcp\mcp-index-server',
  [switch]$Rebuild,
  [switch]$Overwrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "[deploy] Destination: $Destination" -ForegroundColor Cyan
if($Rebuild){
  Write-Host '[deploy] Rebuilding project (npm ci && npm run build)...'
  npm ci
  npm run build
}

if(Test-Path $Destination){
  if($Overwrite){
    Write-Host '[deploy] Removing existing destination (overwrite requested)...'
    Remove-Item -Recurse -Force $Destination
  } else {
    Write-Host '[deploy] Destination exists (will update in place). Use -Overwrite to clean.' -ForegroundColor Yellow
  }
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination 'dist') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination 'instructions') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination 'logs') | Out-Null

# Copy compiled output
Write-Host '[deploy] Copying dist/...'
Copy-Item -Recurse -Force dist/* (Join-Path $Destination 'dist')

# Minimal runtime package file: strip dev deps to reduce noise
$pkgPath = Join-Path $PWD 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$runtime = [ordered]@{
  name = $pkg.name
  version = $pkg.version
  type = 'commonjs'
  license = $pkg.license
  description = $pkg.description
  repository = $pkg.repository
  author = $pkg.author
  dependencies = $pkg.dependencies
  engines = $pkg.engines
  scripts = @{ start = 'node dist/server/index.js' }
}
$runtime | ConvertTo-Json -Depth 6 | Out-File (Join-Path $Destination 'package.json') -Encoding UTF8

# Copy license
Copy-Item -Force LICENSE (Join-Path $Destination 'LICENSE')

# Seed instructions (only non-secret baseline). Avoid copying large temp or test artifacts.
Write-Host '[deploy] Seeding instructions (existing files are preserved)...'
Get-ChildItem instructions -Filter *.json | Where-Object { -not ($_.Name -match 'concurrent-|fuzz_|crud.cycle|temp') } | ForEach-Object {
  $target = Join-Path (Join-Path $Destination 'instructions') $_.Name
  if(-not (Test-Path $target)){
    Copy-Item $_.FullName $target
  }
}

# Create launch scripts
$startPs1 = @'
param(
  [switch]$VerboseLogging,
  [switch]$EnableMutation
)
Set-StrictMode -Version Latest
$env:MCP_LOG_VERBOSE = if($VerboseLogging){ '1' } else { $env:MCP_LOG_VERBOSE }
if($EnableMutation){ $env:MCP_ENABLE_MUTATION = '1' }
Write-Host "[start] Launching MCP Index Server..." -ForegroundColor Cyan
node dist/server/index.js 2>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'logs/server.log')
'@
Set-Content -Path (Join-Path $Destination 'start.ps1') -Value $startPs1 -Encoding UTF8

$startCmd = "@echo off`r`nset MCP_LOG_VERBOSE=1`r`nnode dist\server\index.js"
Set-Content -Path (Join-Path $Destination 'start.cmd') -Value $startCmd -Encoding ASCII

Write-Host '[deploy] Done.' -ForegroundColor Green
Write-Host "Next: (cd $Destination ; npm install --production) then run: pwsh .\start.ps1 -VerboseLogging -EnableMutation" -ForegroundColor Cyan
