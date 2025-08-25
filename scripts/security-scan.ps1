Param()
Write-Host 'Running security scan...' -ForegroundColor Cyan
$issues = @()
# Dependency audit
try {
  $audit = npm audit --json 2>$null | ConvertFrom-Json
  if($audit.metadata.vulnerabilities.total -gt 0){
    $issues += "Vulnerabilities found: $($audit.metadata.vulnerabilities.total)"
  }
} catch { $issues += 'npm audit failed' }

# Simple PII pattern scan in staged & src
$piiPatterns = @('[0-9]{3}-[0-9]{2}-[0-9]{4}','\b\d{16}\b')
$files = Get-ChildItem -Recurse -Include *.ts,*.md | Select-Object -ExpandProperty FullName
foreach($f in $files){
  $text = Get-Content -Raw -Path $f
  foreach($pat in $piiPatterns){ if($text -match $pat){ $issues += "PII-like pattern in $f ($pat)" } }
}

if($issues.Count -gt 0){
  Write-Host 'Security scan issues:' -ForegroundColor Red
  $issues | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
  exit 1
}
Write-Host 'Security scan passed.' -ForegroundColor Green
exit 0
