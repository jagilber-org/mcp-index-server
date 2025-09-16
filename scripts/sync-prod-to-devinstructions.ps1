param(
  [string]$ProdDir = 'C:\mcp\mcp-index-server-prod\instructions',
  [string]$DestDir = 'C:\github\jagilber\mcp-index-server\devinstructions'
)

if (-not (Test-Path $ProdDir)) { Write-Error "Production instructions path missing: $ProdDir"; exit 1 }
if (-not (Test-Path $DestDir)) { New-Item -ItemType Directory -Path $DestDir | Out-Null }

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backup = Join-Path (Split-Path $DestDir -Parent) ("devinstructions_backup_$timestamp")
New-Item -ItemType Directory -Path $backup | Out-Null

# Backup existing contents if any
$existing = Get-ChildItem -LiteralPath $DestDir -Force -ErrorAction SilentlyContinue
if ($existing) {
  Copy-Item -Path (Join-Path $DestDir '*') -Destination $backup -Recurse -Force -ErrorAction SilentlyContinue
}

# Clear destination
Get-ChildItem -Path $DestDir -Recurse -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# Copy prod files
Copy-Item -Path (Join-Path $ProdDir '*') -Destination $DestDir -Recurse -Force

$prodCount = (Get-ChildItem -File $ProdDir -Filter *.json).Count
$destCount = (Get-ChildItem -File $DestDir -Filter *.json).Count

[PSCustomObject]@{
  backupDirectory = $backup
  prodJsonCount   = $prodCount
  destJsonCount   = $destCount
  completedAt     = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 4
