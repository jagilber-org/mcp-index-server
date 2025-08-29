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
  When specified, existing destination content (except an existing instructions folder) is removed first.

.PARAMETER BundleDeps
  When specified, runs 'npm install --production' inside the destination so runtime dependencies are
  already present (useful when launching via node directly instead of start.ps1 auto-install logic).

.EXAMPLE
  pwsh scripts/deploy-local.ps1 -Destination C:\mcp\mcp-index-server -Rebuild -Overwrite

.NOTES
  Does not install devDependencies outside the build step. Runtime only needs the compiled dist.
#>
param(
  [Alias('TargetDir')]
  [string]$Destination = 'C:\mcp\mcp-index-server',
  [switch]$Rebuild,
  [switch]$Overwrite,
  [switch]$BundleDeps,
  # Disable automatic backup of existing destination instructions directory
  [switch]$NoBackup,
  # Maximum number of instruction backups to retain (0 = unlimited)
  [int]$BackupRetention = 10,
  # When a rebuild is requested, allow continuing with an existing dist/ directory
  # if npm ci / build fails (e.g. transient EPERM on Windows from locked executables)
  [switch]$AllowStaleDistOnRebuildFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "[deploy] Destination: $Destination" -ForegroundColor Cyan
if($Rebuild){
  Write-Host '[deploy] Rebuilding project (npm ci && npm run build)...'
  $rebuildSucceeded = $false
  try {
    npm ci
    npm run build
    $rebuildSucceeded = $true
  } catch {
    Write-Host ("[deploy] Rebuild failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
    if(-not (Test-Path 'dist')){
      Write-Host '[deploy] No existing dist/ to fall back to. Aborting.' -ForegroundColor Red
      exit 1
    }
    if($AllowStaleDistOnRebuildFailure){
      Write-Host '[deploy] Proceeding with existing dist/ due to -AllowStaleDistOnRebuildFailure.' -ForegroundColor Yellow
    } else {
      Write-Host '[deploy] Re-run with -AllowStaleDistOnRebuildFailure to use existing dist/, or resolve the build issue (close processes locking node_modules).' -ForegroundColor Yellow
      exit 1
    }
  }
  if($rebuildSucceeded){
    Write-Host '[deploy] Rebuild completed successfully.' -ForegroundColor Green
  }
}

if(Test-Path $Destination){
  $destInstructionsPath = Join-Path $Destination 'instructions'
  $shouldBackup = -not $NoBackup -and (Test-Path $destInstructionsPath)
  if($shouldBackup){
  try {
      $jsonFiles = Get-ChildItem -Path $destInstructionsPath -Filter *.json -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "\\_templates\\" }
      if($jsonFiles){
        $backupRoot = Join-Path $Destination 'backups'
        if(-not (Test-Path $backupRoot)){ New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backupDir = Join-Path $backupRoot "instructions-$stamp"
        # Avoid collisions (rare); append incremental suffix if exists
        $i = 1
        while(Test-Path $backupDir){ $backupDir = Join-Path $backupRoot ("instructions-$stamp-" + ($i++)) }
        Write-Host "[deploy] Backing up instructions to $backupDir" -ForegroundColor Cyan
        New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
        foreach($f in $jsonFiles){ Copy-Item $f.FullName (Join-Path $backupDir $f.Name) }
        Write-Host "[deploy] Backup completed (${($jsonFiles|Measure-Object).Count} files)." -ForegroundColor Green
        if($BackupRetention -gt 0){
          $existing = Get-ChildItem -Path $backupRoot -Directory -Filter 'instructions-*' | Sort-Object Name -Descending
          if($existing.Count -gt $BackupRetention){
            $toPrune = $existing | Select-Object -Skip $BackupRetention
            foreach($p in $toPrune){
              try { Remove-Item -Recurse -Force $p.FullName } catch { Write-Host "[deploy] Warning: failed pruning old backup $($p.Name): $($_.Exception.Message)" -ForegroundColor Yellow }
            }
            Write-Host "[deploy] Pruned $($toPrune.Count) old backup(s) (retention $BackupRetention)." -ForegroundColor DarkGray
          }
        }
      } else {
        Write-Host '[deploy] No runtime instruction JSON files to backup (only templates or empty).' -ForegroundColor DarkGray
      }
    } catch {
      Write-Host "[deploy] Warning: backup attempt failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  } elseif(-not $NoBackup) {
    Write-Host '[deploy] No existing instructions directory to backup.' -ForegroundColor DarkGray
  }

  if($Overwrite){
    Write-Host '[deploy] Overwrite requested. Preserving existing instructions folder if present...' -ForegroundColor Cyan
    $preserveInstructions = $destInstructionsPath
    $hadInstructions = Test-Path $preserveInstructions
    if($hadInstructions){ Write-Host '[deploy] Preserving instructions folder.' -ForegroundColor Green }
    Get-ChildItem -Force $Destination | ForEach-Object {
      if($hadInstructions -and $_.FullName -eq $preserveInstructions){ return }
      try { Remove-Item -Recurse -Force $_.FullName } catch { Write-Host "[deploy] Warning: failed to remove $($_.FullName): $($_.Exception.Message)" -ForegroundColor Yellow }
    }
    if(-not (Test-Path $Destination)) { New-Item -ItemType Directory -Force -Path $Destination | Out-Null }
  } else {
    Write-Host '[deploy] Destination exists (will update in place). Use -Overwrite to clean (instructions always preserved).' -ForegroundColor Yellow
  }
} else {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
}

New-Item -ItemType Directory -Force -Path (Join-Path $Destination 'dist') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination 'instructions') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination 'logs') | Out-Null

# Copy compiled output
Write-Host '[deploy] Copying dist/...'
Copy-Item -Recurse -Force dist/* (Join-Path $Destination 'dist')
if(-not (Test-Path (Join-Path $Destination 'dist/server/index.js'))){
  Write-Host '[deploy] ERROR: dist/server/index.js missing after copy. Possible locked destination or partial copy.' -ForegroundColor Red
  Write-Host '[deploy] Suggestion: ensure no running process is locking the destination (stop running server) then re-run deploy, or run scripts/sync-dist.ps1.' -ForegroundColor Yellow
  exit 1
}

# Copy schema assets required at runtime. The compiled catalogLoader.js references ../../schemas/instruction.schema.json
# relative to its own location (dist/services -> dist -> project root -> schemas). In the development workspace that
# resolves to <repo>/schemas, but in the production deployment we previously did not copy the top-level schemas folder,
# leading to MODULE_NOT_FOUND at startup. We replicate the same layout here by copying the schemas directory.
if(Test-Path 'schemas'){
  Write-Host '[deploy] Copying schemas/ (runtime JSON schema assets)...'
  Copy-Item -Recurse -Force 'schemas' (Join-Path $Destination 'schemas')
  if(-not (Test-Path (Join-Path $Destination 'schemas/instruction.schema.json'))){
    Write-Host '[deploy] ERROR: instruction.schema.json missing after schemas copy.' -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host '[deploy] WARNING: schemas directory not found in source; runtime schema validation may fail.' -ForegroundColor Yellow
}

# Minimal runtime package file: strip dev deps to reduce noise
$pkgPath = Join-Path $PWD 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json

# Helper to safely read a property that may not exist under strict mode
function Get-PkgProp($obj, $name, $default){
  if($null -ne $obj -and ($obj.PSObject.Properties.Name -contains $name)){
    return $obj.$name
  }
  return $default
}

$runtime = [ordered]@{
  name = Get-PkgProp $pkg 'name' 'mcp-index-server'
  version = Get-PkgProp $pkg 'version' '0.0.0'
  type = 'commonjs'
  license = Get-PkgProp $pkg 'license' 'MIT'
  description = Get-PkgProp $pkg 'description' 'MCP Index Server'
  repository = Get-PkgProp $pkg 'repository' @{ type = 'git'; url = '' }
  author = Get-PkgProp $pkg 'author' 'Unknown'
  dependencies = Get-PkgProp $pkg 'dependencies' @{}
  engines = Get-PkgProp $pkg 'engines' @{ node = '>=20 <21' }
  scripts = @{ start = 'node dist/server/index.js' }
}
$runtime | ConvertTo-Json -Depth 10 | Out-File (Join-Path $Destination 'package.json') -Encoding UTF8

# Copy license
Copy-Item -Force LICENSE (Join-Path $Destination 'LICENSE')

# Seed instructions only if destination has none (to avoid overwriting user-managed runtime catalog).
$destInstructions = Join-Path $Destination 'instructions'
$hasExistingRuntime = Get-ChildItem -Path $destInstructions -Filter *.json -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "\\_templates\\" } | Select-Object -First 1
if(-not $hasExistingRuntime){
  Write-Host '[deploy] Destination instructions empty -> seeding baseline (non-secret) files...' -ForegroundColor Cyan
  Get-ChildItem instructions -Filter *.json | Where-Object { -not ($_.Name -match 'concurrent-|fuzz_|crud.cycle|temp') } | ForEach-Object {
    $target = Join-Path $destInstructions $_.Name
    if(-not (Test-Path $target)){
      Copy-Item $_.FullName $target
    }
  }
} else {
  Write-Host '[deploy] Skipping instruction seeding (existing runtime instructions preserved).' -ForegroundColor Green
}

# Create launch scripts
$startPs1 = @'
param(
  [switch]$VerboseLogging,
  [switch]$EnableMutation,
  [switch]$TraceRequire
)
Set-StrictMode -Version Latest
if($VerboseLogging){ $env:MCP_LOG_VERBOSE = '1' } elseif(-not $env:MCP_LOG_VERBOSE){ $env:MCP_LOG_VERBOSE = '' }
if($EnableMutation){ $env:MCP_ENABLE_MUTATION = '1' }
Write-Host "[start] Launching MCP Index Server..." -ForegroundColor Cyan
# Auto-install production dependencies if not present
if(-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))){
  Write-Host '[start] node_modules missing - installing production dependencies (npm install --production)...' -ForegroundColor Yellow
  pushd $PSScriptRoot
  try { npm install --production } catch { Write-Host "[start] npm install failed: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
  finally { popd }
}
$nodeArgs = @()
if($TraceRequire){ $nodeArgs += '--trace-require' }
node @nodeArgs dist/server/index.js 2>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'logs/server.log')
'@
Set-Content -Path (Join-Path $Destination 'start.ps1') -Value $startPs1 -Encoding UTF8

$startCmd = "@echo off" + "`r`nrem Set MCP_LOG_VERBOSE=1 to enable catalogCount / diagnostics" + "`r`nif not exist node_modules (echo [start] Installing production dependencies... & call npm install --production)" + "`r`nnode %* dist\server\index.js"
Set-Content -Path (Join-Path $Destination 'start.cmd') -Value $startCmd -Encoding ASCII

Write-Host '[deploy] Done.' -ForegroundColor Green
if($BundleDeps){
  Write-Host '[deploy] Installing production dependencies into destination (BundleDeps)...' -ForegroundColor Cyan
  pushd $Destination
  try { npm install --production } catch { Write-Host "[deploy] npm install failed: $($_.Exception.Message)" -ForegroundColor Red; exit 1 } finally { popd }
  Write-Host '[deploy] Production dependencies installed.' -ForegroundColor Green
}
Write-Host "Next: (cd $Destination ; pwsh .\\start.ps1 -VerboseLogging -EnableMutation)" -ForegroundColor Cyan
