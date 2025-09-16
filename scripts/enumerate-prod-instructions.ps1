param(
    [string]$InstructionsDir = 'C:\mcp\mcp-index-server-prod\instructions',
    [int]$Sample = 15
)

if (-not (Test-Path $InstructionsDir)) {
    Write-Error "Instructions directory not found: $InstructionsDir"
    exit 1
}

$files = Get-ChildItem -File $InstructionsDir -Filter *.json -ErrorAction SilentlyContinue | Sort-Object Name
$stats = foreach ($f in $files) {
    try {
        $json = Get-Content $f.FullName -Raw | ConvertFrom-Json -ErrorAction Stop
        [PSCustomObject]@{
            name   = $f.Name
            id     = $json.id
            hasId  = [bool]$json.id
            hasTitle = [bool]$json.title
            status = $json.status
            hasBody = [bool]$json.body
            likely = [bool]($json.body -and $json.id -and $json.title)
        }
    }
    catch {
        [PSCustomObject]@{
            name   = $f.Name
            id     = $null
            hasId  = $false
            hasTitle = $false
            status = $null
            hasBody = $false
            likely = $false
        }
    }
}

$result = [PSCustomObject]@{
    scanned            = $files.Count
    likelyInstructions = ($stats | Where-Object { $_.likely }).Count
    missingId          = ($stats | Where-Object { -not $_.hasId }).Count
    missingTitle       = ($stats | Where-Object { -not $_.hasTitle }).Count
    missingBody        = ($stats | Where-Object { -not $_.hasBody }).Count
    sample             = $stats | Select-Object -First $Sample
}

$result | ConvertTo-Json -Depth 4
