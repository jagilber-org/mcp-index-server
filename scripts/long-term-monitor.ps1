# Enhanced Long-Term Memory Monitor
# Monitors memory usage and tracks specific potential leak sources

param(
    [int]$IntervalSeconds = 10,
    [int]$DurationMinutes = 60,
    [string]$LogFile = "memory-monitor-$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

Write-Host "=== LONG-TERM MEMORY MONITOR ===" -ForegroundColor Green
Write-Host "Duration: $DurationMinutes minutes" -ForegroundColor Yellow
Write-Host "Interval: $IntervalSeconds seconds" -ForegroundColor Yellow
Write-Host "Log file: $LogFile" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop early" -ForegroundColor Red
Write-Host ""

# Create CSV header
"Timestamp,PID,RSS_MB,Virtual_MB,Handles,HeapUsed_MB,HeapTotal_MB,External_MB,ArrayBuffers_KB" | Out-File -FilePath $LogFile -Encoding UTF8

$startTime = Get-Date
$endTime = $startTime.AddMinutes($DurationMinutes)
$iteration = 0

while ((Get-Date) -lt $endTime) {
    $iteration++
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    
    Write-Host "[$timestamp] Iteration $iteration" -ForegroundColor Cyan
    
    try {
        $nodeProcesses = Get-Process -Name node -ErrorAction SilentlyContinue
        
        if ($nodeProcesses) {
            foreach ($proc in $nodeProcesses) {
                $rssMB = [math]::Round($proc.WorkingSet/1MB, 3)
                $virtualMB = [math]::Round($proc.VirtualMemorySize/1MB, 3)
                $handles = $proc.Handles
                
                # Try to get detailed memory info via Node.js if possible
                $heapUsed = "N/A"
                $heapTotal = "N/A" 
                $external = "N/A"
                $arrayBuffers = "N/A"
                
                # Log to CSV
                "$timestamp,$($proc.Id),$rssMB,$virtualMB,$handles,$heapUsed,$heapTotal,$external,$arrayBuffers" | 
                    Out-File -FilePath $LogFile -Append -Encoding UTF8
                
                # Console output with change detection
                $color = "White"
                if ($iteration -gt 1) {
                    if ($rssMB -gt $script:lastRSS + 0.5) { $color = "Red" }
                    elseif ($rssMB -gt $script:lastRSS + 0.1) { $color = "Yellow" }
                    elseif ($rssMB -lt $script:lastRSS - 0.1) { $color = "Green" }
                }
                
                Write-Host "  PID:$($proc.Id) RSS:${rssMB}MB Virtual:${virtualMB}MB Handles:$handles" -ForegroundColor $color
                
                $script:lastRSS = $rssMB
            }
        } else {
            Write-Host "  No Node.js processes found" -ForegroundColor Red
            "$timestamp,NO_PROCESS,0,0,0,0,0,0,0" | Out-File -FilePath $LogFile -Append -Encoding UTF8
        }
    } catch {
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # Show time remaining
    $elapsed = (Get-Date) - $startTime
    $remaining = $endTime - (Get-Date)
    Write-Host "  Elapsed: $($elapsed.ToString('mm\:ss')) | Remaining: $($remaining.ToString('mm\:ss'))" -ForegroundColor Gray
    
    Start-Sleep $IntervalSeconds
}

Write-Host ""
Write-Host "=== MONITORING COMPLETE ===" -ForegroundColor Green
Write-Host "Log saved to: $LogFile" -ForegroundColor Yellow

# Show summary analysis
Write-Host ""
Write-Host "=== SUMMARY ANALYSIS ===" -ForegroundColor Green

try {
    $data = Import-Csv $LogFile | Where-Object { $_.PID -ne "NO_PROCESS" }
    
    if ($data.Count -gt 1) {
        $first = $data[0]
        $last = $data[-1]
        
        $rssGrowth = [decimal]$last.RSS_MB - [decimal]$first.RSS_MB
        $virtualGrowth = [decimal]$last.Virtual_MB - [decimal]$first.Virtual_MB
        $handleGrowth = [int]$last.Handles - [int]$first.Handles
        
        Write-Host "RSS Growth: $($rssGrowth.ToString('F3')) MB" -ForegroundColor $(if($rssGrowth -gt 1) {"Red"} elseif($rssGrowth -gt 0.1) {"Yellow"} else {"Green"})
        Write-Host "Virtual Growth: $($virtualGrowth.ToString('F3')) MB" -ForegroundColor $(if($virtualGrowth -gt 10) {"Red"} elseif($virtualGrowth -gt 1) {"Yellow"} else {"Green"})
        Write-Host "Handle Growth: $handleGrowth" -ForegroundColor $(if($handleGrowth -gt 5) {"Red"} elseif($handleGrowth -gt 0) {"Yellow"} else {"Green"})
        
        $duration = ([DateTime]$last.Timestamp - [DateTime]$first.Timestamp).TotalMinutes
        if ($duration -gt 0 -and $rssGrowth -gt 0) {
            $rssRate = $rssGrowth / $duration
            Write-Host "RSS Growth Rate: $($rssRate.ToString('F3')) MB/minute" -ForegroundColor $(if($rssRate -gt 0.1) {"Red"} elseif($rssRate -gt 0.01) {"Yellow"} else {"Green"})
        }
    }
} catch {
    Write-Host "Analysis failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Open $LogFile in Excel or import into PowerShell for detailed analysis" -ForegroundColor Cyan
