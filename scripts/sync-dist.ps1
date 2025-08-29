<#!
.SYNOPSIS
  Fast sync of local dist/ output to an existing deployment directory without tests or rebuild.
.DESCRIPTION
  Copies current dist/ tree into destination's dist/ (overwriting) and optionally updates package.json version.
.PARAMETER Destination
  Target deployment root (default C:\mcp\mcp-index-server)
.PARAMETER UpdatePackage
  Also copy package.json runtime subset (like deploy script generates) preserving dependencies object.
.EXAMPLE
  pwsh scripts/sync-dist.ps1 -Destination C:\mcp\mcp-index-server
#>
param(
  [string]$Destination = 'C:\mcp\mcp-index-server',
  [switch]$UpdatePackage
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if(-not (Test-Path 'dist')){ throw 'dist/ not found. Run a build first.' }
if(-not (Test-Path $Destination)){ throw "Destination not found: $Destination (run deploy first)" }
$destDist = Join-Path $Destination 'dist'
if(-not (Test-Path $destDist)){ New-Item -ItemType Directory -Force -Path $destDist | Out-Null }
Write-Host "[sync] Copying dist -> $destDist" -ForegroundColor Cyan
# Remove old JS to avoid stale deletions
Get-ChildItem -Path $destDist -Recurse -File | Remove-Item -Force
Copy-Item -Recurse -Force dist/* $destDist
if($UpdatePackage){
  $pkgPath = Join-Path $PWD 'package.json'
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  $runtime = [ordered]@{ name = $pkg.name; version = $pkg.version; type='commonjs'; license=$pkg.license; description=$pkg.description; repository=$pkg.repository; author=$pkg.author; dependencies=$pkg.dependencies; engines = $pkg.engines; scripts = @{ start = 'node dist/server/index.js' } }
  $runtime | ConvertTo-Json -Depth 10 | Out-File (Join-Path $Destination 'package.json') -Encoding UTF8
  Write-Host '[sync] Updated runtime package.json' -ForegroundColor Green
}
Write-Host '[sync] Done.' -ForegroundColor Green
