# Memory Analysis Script - Analyzes monitoring CSV data for leak patterns

param(
    [Parameter(Mandatory=$true)]
    [string]$CsvFile
)

if (!(Test-Path $CsvFile)) {
    Write-Host "❌ CSV file not found: $CsvFile" -ForegroundColor Red
    exit 1
}

Write-Host "📊 MEMORY ANALYSIS REPORT" -ForegroundColor Green
Write-Host "File: $CsvFile" -ForegroundColor Cyan
Write-Host "=" * 60

try {
    $data = Import-Csv $CsvFile
    $samples = $data.Count
    
    if ($samples -lt 2) {
        Write-Host "❌ Insufficient data (need at least 2 samples)" -ForegroundColor Red
        exit 1
    }
    
    $first = $data[0]
    $last = $data[-1]
    $duration = [double]$last.ElapsedMinutes
    
    Write-Host "📋 SUMMARY:" -ForegroundColor White
    Write-Host "  Samples: $samples" -ForegroundColor Gray
    Write-Host "  Duration: ${duration:F1} minutes" -ForegroundColor Gray
    Write-Host "  PID: $($first.PID)" -ForegroundColor Gray
    Write-Host ""
    
    # Memory analysis
    $startRSS = [double]$first.RSS_MB
    $endRSS = [double]$last.RSS_MB
    $rssGrowth = $endRSS - $startRSS
    $rssGrowthKB = $rssGrowth * 1024
    $rssRate = if ($duration -gt 0) { $rssGrowthKB / $duration } else { 0 }
    
    $startVirtual = [double]$first.Virtual_MB
    $endVirtual = [double]$last.Virtual_MB
    $virtualGrowth = $endVirtual - $startVirtual
    $virtualGrowthKB = $virtualGrowth * 1024
    $virtualRate = if ($duration -gt 0) { $virtualGrowthKB / $duration } else { 0 }
    
    $startHandles = [int]$first.Handles
    $endHandles = [int]$last.Handles
    $handleGrowth = $endHandles - $startHandles
    $handleRate = if ($duration -gt 0) { $handleGrowth / $duration } else { 0 }
    
    Write-Host "📈 MEMORY GROWTH:" -ForegroundColor White
    Write-Host "  RSS: ${startRSS:F1} MB → ${endRSS:F1} MB ($(if($rssGrowth -gt 0){'+'})${rssGrowthKB:F1} KB)" -ForegroundColor $(if($rssGrowth -gt 10) {'Red'} elseif($rssGrowth -gt 2) {'Yellow'} else {'Green'})
    Write-Host "  Virtual: ${startVirtual:F1} MB → ${endVirtual:F1} MB ($(if($virtualGrowth -gt 0){'+'})${virtualGrowthKB:F1} KB)" -ForegroundColor Gray
    Write-Host "  Handles: $startHandles → $endHandles ($(if($handleGrowth -gt 0){'+'})$handleGrowth)" -ForegroundColor $(if($handleGrowth -gt 10) {'Yellow'} else {'Gray'})
    Write-Host ""
    
    Write-Host "📊 GROWTH RATES:" -ForegroundColor White
    Write-Host "  RSS Rate: ${rssRate:F1} KB/minute" -ForegroundColor $(if($rssRate -gt 100) {'Red'} elseif($rssRate -gt 20) {'Yellow'} else {'Green'})
    Write-Host "  Virtual Rate: ${virtualRate:F1} KB/minute" -ForegroundColor Gray
    Write-Host "  Handle Rate: ${handleRate:F2} handles/minute" -ForegroundColor $(if($handleRate -gt 1) {'Yellow'} else {'Gray'})
    Write-Host ""
    
    # Leak assessment
    Write-Host "🎯 LEAK ASSESSMENT:" -ForegroundColor White
    $leakIndicators = @()
    
    if ($rssRate -gt 100) {
        $leakIndicators += "HIGH RSS GROWTH RATE (>100 KB/min)"
        Write-Host "  🚨 HIGH RSS GROWTH RATE (${rssRate:F1} KB/min)" -ForegroundColor Red
    } elseif ($rssRate -gt 20) {
        $leakIndicators += "MODERATE RSS GROWTH RATE (>20 KB/min)"
        Write-Host "  ⚠️  MODERATE RSS GROWTH RATE (${rssRate:F1} KB/min)" -ForegroundColor Yellow
    } else {
        Write-Host "  ✅ RSS growth rate normal (${rssRate:F1} KB/min)" -ForegroundColor Green
    }
    
    if ($handleRate -gt 1) {
        $leakIndicators += "HANDLE COUNT INCREASING (${handleRate:F2}/min)"
        Write-Host "  ⚠️  HANDLE COUNT INCREASING (${handleRate:F2}/min)" -ForegroundColor Yellow
    } else {
        Write-Host "  ✅ Handle count stable" -ForegroundColor Green
    }
    
    if ($endHandles -gt 200) {
        $leakIndicators += "HIGH ABSOLUTE HANDLE COUNT ($endHandles)"
        Write-Host "  🚨 HIGH ABSOLUTE HANDLE COUNT ($endHandles)" -ForegroundColor Red
    }
    
    # Pattern analysis
    Write-Host ""
    Write-Host "📉 PATTERN ANALYSIS:" -ForegroundColor White
    
    $rssValues = $data | ForEach-Object { [double]$_.RSS_MB }
    $rssChanges = $data | ForEach-Object { [double]$_.RSS_Change_KB }
    
    # Find significant spikes
    $significantSpikes = $rssChanges | Where-Object { $_ -gt 1000 }
    if ($significantSpikes.Count -gt 0) {
        Write-Host "  ⚠️  Found $($significantSpikes.Count) significant RSS spikes (>1MB)" -ForegroundColor Yellow
        $maxSpike = ($significantSpikes | Measure-Object -Maximum).Maximum
        Write-Host "     Largest spike: ${maxSpike:F1} KB" -ForegroundColor Yellow
    } else {
        Write-Host "  ✅ No significant RSS spikes detected" -ForegroundColor Green
    }
    
    # Trend analysis
    $midPoint = [math]::Floor($samples / 2)
    $firstHalf = $rssValues[0..$midPoint] | Measure-Object -Average
    $secondHalf = $rssValues[$midPoint..($samples-1)] | Measure-Object -Average
    $trendDiff = $secondHalf.Average - $firstHalf.Average
    
    if ($trendDiff -gt 5) {
        Write-Host "  📈 INCREASING TREND: RSS increased ${trendDiff:F1} MB from first to second half" -ForegroundColor Yellow
    } elseif ($trendDiff -lt -2) {
        Write-Host "  📉 DECREASING TREND: RSS decreased ${trendDiff:F1} MB from first to second half" -ForegroundColor Green
    } else {
        Write-Host "  ➡️  STABLE TREND: RSS change ${trendDiff:F1} MB between halves" -ForegroundColor Green
    }
    
    Write-Host ""
    Write-Host "🏁 CONCLUSION:" -ForegroundColor White
    if ($leakIndicators.Count -eq 0) {
        Write-Host "  ✅ NO MEMORY LEAK DETECTED" -ForegroundColor Green
        Write-Host "     Memory usage appears stable within normal parameters." -ForegroundColor Gray
    } else {
        Write-Host "  ⚠️  POTENTIAL MEMORY LEAK DETECTED" -ForegroundColor Red
        Write-Host "     Indicators found:" -ForegroundColor Gray
        foreach ($indicator in $leakIndicators) {
            Write-Host "     • $indicator" -ForegroundColor Red
        }
        Write-Host ""
        Write-Host "     🔍 RECOMMENDED ACTIONS:" -ForegroundColor Yellow
        Write-Host "     • Run longer monitoring session (60+ minutes)" -ForegroundColor Gray
        Write-Host "     • Check for event listener accumulation" -ForegroundColor Gray
        Write-Host "     • Profile heap snapshots in Chrome DevTools" -ForegroundColor Gray
        Write-Host "     • Review recent code changes for resource cleanup" -ForegroundColor Gray
    }
    
} catch {
    Write-Host "❌ Error analyzing CSV: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
