# Hierarchical Instruction Management System
# PowerShell module for managing local and MCP Index Server instructions

param(
    [Parameter(Position=0)]
    [ValidateSet("query", "add", "promote", "review", "sync", "status")]
    [string]$Action = "status",
    
    [Parameter(Position=1)]
    [string]$Query,
    
    [Parameter()]
    [string[]]$Categories,
    
    [Parameter()]
    [string]$InstructionFile,
    
    [Parameter()]
    [switch]$LocalOnly,
    
    [Parameter()]
    [switch]$MCPOnly,
    
    [Parameter()]
    [switch]$VerboseOutput
)

# Configuration
$LocalInstructionsPath = "c:\cases\.instructions"
$MCPServerConfig = @{
    ServerType = "mcp-index-server"
    Available = $true
}

function Get-LocalInstructions {
    param(
        [string]$Query,
        [string[]]$Categories,
        [string]$Path = "$LocalInstructionsPath"
    )
    
    $instructions = @()
    
    # Get all JSON files in local and candidates directories
    $jsonFiles = Get-ChildItem -Path "$Path\local", "$Path\candidates" -Filter "*.json" -Recurse -ErrorAction SilentlyContinue
    
    foreach ($file in $jsonFiles) {
        try {
            $instruction = Get-Content $file.FullName | ConvertFrom-Json
            
            # Apply filters
            $matches = $true
            
            if ($Query -and $instruction.title -notmatch $Query -and $instruction.body -notmatch $Query) {
                $matches = $false
            }
            
            if ($Categories -and (-not $instruction.categories -or @($instruction.categories | Where-Object { $_ -in $Categories }).Count -eq 0)) {
                $matches = $false
            }
            
            if ($matches) {
                $instruction | Add-Member -NotePropertyName "source" -NotePropertyValue "local" -Force
                $instruction | Add-Member -NotePropertyName "filepath" -NotePropertyValue $file.FullName -Force
                $instructions += $instruction
            }
        }
        catch {
            Write-Warning "Failed to parse instruction file: $($file.FullName)"
        }
    }
    
    return $instructions
}

function Get-MCPInstructions {
    param(
        [string]$Query,
        [string[]]$Categories
    )
    
    if (-not $MCPServerConfig.Available) {
        return @()
    }
    
    try {
        # Query MCP Index Server using the existing tool functions
        $mcpQuery = @{
            text = $Query
        }
        
        if ($Categories) {
            $mcpQuery.categoriesAny = $Categories
        }
        
        # This would need to be replaced with actual MCP query mechanism
        # For now, return empty array since we need MCP connection
        if ($VerboseOutput) { Write-Host "MCP Server query would be executed here" }
        return @()
    }
    catch {
        Write-Warning "Failed to query MCP Index Server: $($_.Exception.Message)"
        return @()
    }
}

function Merge-Instructions {
    param(
        [array]$LocalInstructions,
        [array]$MCPInstructions
    )
    
    # Local instructions take precedence
    $merged = @()
    $localIds = $LocalInstructions | ForEach-Object { $_.id }
    
    # Add all local instructions first
    $merged += $LocalInstructions
    
    # Add MCP instructions that don't conflict with local ones
    foreach ($mcpInstruction in $MCPInstructions) {
        if ($mcpInstruction.id -notin $localIds) {
            $mcpInstruction | Add-Member -NotePropertyName "source" -NotePropertyValue "mcp-server" -Force
            $merged += $mcpInstruction
        }
    }
    
    return $merged | Sort-Object priority, title
}

function Show-InstructionStatus {
    Write-Host "=== Hierarchical Instruction Management Status ===" -ForegroundColor Green
    
    # Local instructions count
    $localCount = (Get-LocalInstructions).Count
    $candidateCount = (Get-ChildItem "$LocalInstructionsPath\candidates" -Filter "*.json" -ErrorAction SilentlyContinue).Count
    
    Write-Host "Local Instructions: $localCount total" -ForegroundColor Yellow
    Write-Host "Promotion Candidates: $candidateCount ready" -ForegroundColor Cyan
    
    # MCP Server status
    if ($MCPServerConfig.Available) {
        Write-Host "MCP Index Server: Available" -ForegroundColor Green
    } else {
        Write-Host "MCP Index Server: Unavailable" -ForegroundColor Red
    }
    
    # Recent promotion activity
    if (Test-Path "$LocalInstructionsPath\metadata\promotion-log.json") {
        $promotionLog = Get-Content "$LocalInstructionsPath\metadata\promotion-log.json" | ConvertFrom-Json
        $lastPromotion = $promotionLog.lastPromotion
        if ($lastPromotion) {
            Write-Host "Last Promotion: $lastPromotion" -ForegroundColor Magenta
        } else {
            Write-Host "Last Promotion: Never" -ForegroundColor Gray
        }
        Write-Host "Next Review: $($promotionLog.nextReview)" -ForegroundColor Blue
    }
}

function Find-Instructions {
    param(
        [string]$Query,
        [string[]]$Categories
    )
    
    Write-Host "=== Searching Instructions ===" -ForegroundColor Green
    Write-Host "Query: $Query" -ForegroundColor Yellow
    if ($Categories) {
        Write-Host "Categories: $($Categories -join ', ')" -ForegroundColor Cyan
    }
    
    $results = @()
    
    if (-not $MCPOnly) {
        if ($VerboseOutput) { Write-Host "Searching local instructions..." }
        $localResults = Get-LocalInstructions -Query $Query -Categories $Categories
        $results += $localResults
        Write-Host "Local Results: $($localResults.Count)" -ForegroundColor Blue
    }
    
    if (-not $LocalOnly) {
        if ($VerboseOutput) { Write-Host "Searching MCP Index Server..." }
        $mcpResults = Get-MCPInstructions -Query $Query -Categories $Categories
        $results += $mcpResults
        Write-Host "MCP Results: $($mcpResults.Count)" -ForegroundColor Blue
    }
    
    # Merge and deduplicate
    $merged = Merge-Instructions -LocalInstructions ($results | Where-Object { $_.source -eq "local" }) -MCPInstructions ($results | Where-Object { $_.source -eq "mcp-server" })
    
    Write-Host "`n=== Results ($($merged.Count) total) ===" -ForegroundColor Green
    foreach ($instruction in $merged) {
        $sourceColor = if ($instruction.source -eq "local") { "Yellow" } else { "Cyan" }
        Write-Host "[$($instruction.source.ToUpper())] $($instruction.title)" -ForegroundColor $sourceColor
        Write-Host "  ID: $($instruction.id)" -ForegroundColor Gray
        Write-Host "  Priority: $($instruction.priority) | Categories: $($instruction.categories -join ', ')" -ForegroundColor Gray
        Write-Host "  $($instruction.body.Substring(0, [Math]::Min(100, $instruction.body.Length)))..." -ForegroundColor White
        Write-Host ""
    }
}

function Show-PromotionCandidates {
    Write-Host "=== Promotion Candidates Review ===" -ForegroundColor Green
    
    $candidates = Get-ChildItem "$LocalInstructionsPath\candidates" -Filter "*.json" -ErrorAction SilentlyContinue
    
    if ($candidates.Count -eq 0) {
        Write-Host "No promotion candidates found." -ForegroundColor Gray
        return
    }
    
    foreach ($candidateFile in $candidates) {
        try {
            $candidate = Get-Content $candidateFile.FullName | ConvertFrom-Json
            
            Write-Host "`n--- $($candidate.title) ---" -ForegroundColor Yellow
            Write-Host "ID: $($candidate.id)" -ForegroundColor Gray
            Write-Host "Use Count: $($candidate.metadata.useCount)" -ForegroundColor Cyan
            Write-Host "Categories: $($candidate.categories -join ', ')" -ForegroundColor Cyan
            Write-Host "Promotion Ready: $(if ($candidate.metadata.promotionCandidate) { 'YES' } else { 'NO' })" -ForegroundColor $(if ($candidate.metadata.promotionCandidate) { 'Green' } else { 'Red' })
            Write-Host "Description: $($candidate.body.Substring(0, [Math]::Min(150, $candidate.body.Length)))..."
            
            # Promotion criteria check
            $criteria = @()
            if ($candidate.metadata.useCount -ge 3) { $criteria += "✓ Usage" } else { $criteria += "✗ Usage" }
            if ($candidate.metadata.applicableWorkspaces -or -not $candidate.metadata.localOnly) { $criteria += "✓ Generalizable" } else { $criteria += "✗ Generalizable" }
            Write-Host "Criteria: $($criteria -join ', ')" -ForegroundColor Magenta
        }
        catch {
            Write-Warning "Failed to parse candidate: $($candidateFile.Name)"
        }
    }
}

# Main execution logic
switch ($Action) {
    "status" {
        Show-InstructionStatus
    }
    
    "query" {
        if (-not $Query -and -not $Categories) {
            Write-Error "Query action requires either -Query or -Categories parameter"
            exit 1
        }
        Find-Instructions -Query $Query -Categories $Categories
    }
    
    "review" {
        Show-PromotionCandidates
    }
    
    "promote" {
        Write-Host "=== Promotion Process ===" -ForegroundColor Green
        Write-Host "Promotion functionality requires MCP Index Server integration." -ForegroundColor Yellow
        Write-Host "This would promote eligible candidates to the central server." -ForegroundColor Gray
    }
    
    "sync" {
        Write-Host "=== Synchronization Process ===" -ForegroundColor Green
        Write-Host "Sync functionality would update local cache of MCP Index Server instructions." -ForegroundColor Yellow
    }
    
    "add" {
        if (-not $InstructionFile) {
            Write-Error "Add action requires -InstructionFile parameter"
            exit 1
        }
        Write-Host "=== Adding Local Instruction ===" -ForegroundColor Green
        Write-Host "Add functionality would create new local instruction from file: $InstructionFile" -ForegroundColor Yellow
    }
    
    default {
        Write-Error "Unknown action: $Action"
        exit 1
    }
}
