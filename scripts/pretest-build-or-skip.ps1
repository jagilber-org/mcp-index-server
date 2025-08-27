param()
$skip = $env:SKIP_PRETEST_BUILD -eq '1'
if($skip){
  Write-Host "[pretest] Skipping build (SKIP_PRETEST_BUILD=1)" -ForegroundColor DarkGray
} else {
  Write-Host "[pretest] Performing build (no SKIP_PRETEST_BUILD flag)" -ForegroundColor DarkGray
  npm run build
}

# Always attempt compatibility shim creation: some tests expect dist/server/index.js while tsc outputs dist/src/server/index.js
$legacyDir = Join-Path (Get-Location) 'dist/server'
$legacyIndex = Join-Path $legacyDir 'index.js'
$modernIndex = Join-Path (Get-Location) 'dist/src/server/index.js'
if(Test-Path $modernIndex -PathType Leaf){
  if(-not (Test-Path $legacyIndex)){
    Write-Host "[pretest] Creating legacy dist/server/index.js shim -> src/server/index.js" -ForegroundColor DarkGray
    New-Item -ItemType Directory -Path $legacyDir -Force | Out-Null
    "// auto-generated shim for backward compatibility`nmodule.exports = require('../src/server/index.js');" | Out-File -FilePath $legacyIndex -Encoding utf8 -Force
  } else {
    Write-Host "[pretest] Legacy shim already present" -ForegroundColor DarkGray
  }
} else {
  Write-Host "[pretest] Modern index not found yet (dist/src/server/index.js); build may be in progress" -ForegroundColor DarkGray
}
