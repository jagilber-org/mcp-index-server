<#!
.SYNOPSIS
  Restores a previously backed-up instructions directory created by deploy-local.ps1.

.DESCRIPTION
  Copies JSON files from a backup folder (backups/instructions-<timestamp>) back into the active
  instructions directory without deleting existing files unless -Force is specified. By default
  only missing files are restored (safety first). Excludes _templates content.

.PARAMETER Destination
  Root deployment directory containing backups/ and instructions/ (default C:\mcp\mcp-index-server)

.PARAMETER BackupName
  Specific backup folder name (e.g. instructions-20250828-153011). If omitted, the most recent
  backup is used.

.PARAMETER Force
  Overwrite existing instruction files with versions from backup.

.EXAMPLE
  pwsh scripts/restore-instructions.ps1 -Destination C:\mcp\mcp-index-server

.EXAMPLE
  pwsh scripts/restore-instructions.ps1 -Destination C:\mcp\mcp-index-server -BackupName instructions-20250828-153011 -Force
#>
param(
  [string]$Destination = 'C:\mcp\mcp-index-server',
  [string]$BackupName,
  [switch]$Force
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$backupRoot = Join-Path $Destination 'backups'
$instructionsDir = Join-Path $Destination 'instructions'
if(-not (Test-Path $backupRoot)){ throw "Backup root not found: $backupRoot" }
if(-not (Test-Path $instructionsDir)){ New-Item -ItemType Directory -Force -Path $instructionsDir | Out-Null }

$selected = $null
if($BackupName){
  $candidate = Join-Path $backupRoot $BackupName
  if(-not (Test-Path $candidate)){ throw "Specified backup not found: $BackupName" }
  $selected = Get-Item $candidate
} else {
  $selected = Get-ChildItem -Path $backupRoot -Directory -Filter 'instructions-*' | Sort-Object Name -Descending | Select-Object -First 1
  if(-not $selected){ throw 'No instruction backups found.' }
}
Write-Host "[restore] Using backup: $($selected.Name)" -ForegroundColor Cyan

$files = Get-ChildItem -Path $selected.FullName -Filter *.json -File -ErrorAction SilentlyContinue
if(-not $files){ throw 'Backup contains no JSON files.' }
$restored = 0
$skipped = 0
foreach($f in $files){
  $target = Join-Path $instructionsDir $f.Name
  if(Test-Path $target -and -not $Force){ $skipped++ ; continue }
  Copy-Item $f.FullName $target -Force
  $restored++
}
Write-Host "[restore] Restored=$restored Skipped=$skipped Target=$instructionsDir" -ForegroundColor Green
