param([string]$Destination='C:\mcp\mcp-index-server-prod',[int]$Depth=3)
Set-StrictMode -Version Latest
$ErrorActionPreference='Continue'
if(-not (Test-Path $Destination)){ Write-Host "[diag] Destination missing: $Destination" -ForegroundColor Red; exit 1 }
Write-Host "[diag] Listing files under $Destination (depth $Depth)" -ForegroundColor Cyan
Get-ChildItem -Recurse -Path $Destination -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer -or $_.FullName -match 'dist\\server' } | Select-Object FullName,Length | Format-Table -AutoSize
if(Test-Path (Join-Path $Destination 'package.json')){ Write-Host '[diag] package.json version:'; (Get-Content (Join-Path $Destination 'package.json') -Raw | ConvertFrom-Json).version }
