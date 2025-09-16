/* eslint-disable */
// Extracted overview functions from admin.html
(function(){
    // rely on global helpers: formatUptime, formatBytes, showError
    window.statsAvailable = false;

    async function loadOverviewData(){
        try {
            const [statsRes, maintenanceRes, healthRes] = await Promise.allSettled([
                fetch('/api/admin/stats'),
                fetch('/api/maintenance'),
                fetch('/api/system/health')
            ]);
            const statsData = statsRes.status==='fulfilled' ? await statsRes.value.json().catch(()=> ({})) : {};
            const maintenanceData = maintenanceRes.status==='fulfilled' ? await maintenanceRes.value.json().catch(()=> ({})) : {};
            const healthData = healthRes.status==='fulfilled' ? await healthRes.value.json().catch(()=> ({})) : {};
            if(statsData?.success && statsData.stats){
                window.statsAvailable = true; displaySystemStats(statsData.stats);
            } else {
                window.statsAvailable = false; const statsEl = document.getElementById('system-stats'); if(statsEl) statsEl.innerHTML = '<div class="error-message">Stats unavailable</div>';
            }
            if(maintenanceData?.success && maintenanceData.maintenance && typeof displayMaintenanceInfo==='function'){
                try { displayMaintenanceInfo(maintenanceData.maintenance); } catch(e){ console.warn('displayMaintenanceInfo failed:', e); }
            }
            if(healthData && (healthData.success || ['ok','healthy','degraded'].includes(healthData.status))){
                displaySystemHealth(healthData.systemHealth || healthData.maintenance?.systemHealth || healthData);
            }
        } catch(err){
            console.error('Error loading overview data:', err);
            showError('Failed to load overview data');
        }
    }

    function displaySystemStats(stats) {
        try { window.lastSystemStats = stats; } catch(e) { /* ignore */ }
        const html = `
            <div class="stat-row">
                <span class="stat-label">Uptime</span>
                <span class="stat-value">${formatUptime(stats.uptime)}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Active Connections (WS)</span>
                <span class="stat-value">${stats.activeConnections}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Admin Sessions</span>
                <span class="stat-value">${stats.adminActiveSessions ?? '0'}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Total Requests</span>
                <span class="stat-value">${stats.totalRequests.toLocaleString()}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Error Rate</span>
                <span class="stat-value">${stats.errorRate.toFixed(2)}%</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Avg Response Time</span>
                <span class="stat-value">${stats.avgResponseTime.toFixed(1)}ms</span>
            </div>
            <hr style="opacity:.15;margin:6px 0;"/>
            <div class="stat-row">
                <span class="stat-label" style="opacity:.8">Catalog Accepted</span>
                <span class="stat-value">${stats.catalogStats?.acceptedInstructions ?? stats.catalogStats?.totalInstructions ?? '—'}</span>
            </div>
            <div class="stat-row" title="Physical *.json files discovered (raw). May exceed accepted due to validation skips">
                <span class="stat-label" style="opacity:.8">Catalog Files</span>
                <span class="stat-value">${stats.catalogStats?.rawFileCount ?? '—'}</span>
            </div>
            <div class="stat-row" title="Rejected/skipped after validation/normalization">
                <span class="stat-label" style="opacity:.8">Catalog Skipped</span>
                <span class="stat-value">${stats.catalogStats?.skippedInstructions ?? '—'}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label" style="opacity:.8">Catalog Version</span>
                <span class="stat-value">${stats.catalogStats?.version ?? '—'}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label" style="opacity:.8">Schema Version</span>
                <span class="stat-value">${stats.catalogStats?.schemaVersion ?? 'unknown'}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label" style="opacity:.8">Last Updated</span>
                <span class="stat-value">${stats.catalogStats?.lastUpdated ? new Date(stats.catalogStats.lastUpdated).toLocaleString() : 'N/A'}</span>
            </div>
        `;
        const el = document.getElementById('system-stats'); if(el) el.innerHTML = html;

        const perfParts = [];
        perfParts.push(`
            <div class="stat-row">
                <span class="stat-label">Total Connections</span>
                <span class="stat-value">${stats.totalConnections.toLocaleString()}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Error Rate</span>
                <span class="stat-value">${stats.errorRate.toFixed(2)}%</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Response Time</span>
                <span class="stat-value">${stats.avgResponseTime.toFixed(1)}ms</span>
            </div>`);
        try {
            if(window.__resourceTrendCache){
                const t = window.__resourceTrendCache;
                perfParts.push(`
                    <div class="stat-row">
                        <span class="stat-label">Window</span>
                        <span class="stat-value">${t.windowSec}s (${t.sampleCount} samples)</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Memory Usage</span>
                        <span class="stat-value">${formatBytes(stats.memoryUsage.heapUsed)} / ${formatBytes(stats.memoryUsage.heapTotal)}</span>
                    </div>`);
            }
        } catch(e) { /* ignore */ }
        const perfEl = document.getElementById('performance-stats'); if(perfEl) perfEl.innerHTML = perfParts.join('');

        displayToolMetrics(stats);
    }

    function displayToolMetrics(stats) {
        const toolMetricsEl = document.getElementById('tool-metrics');
        if (!toolMetricsEl || !stats.toolMetrics) {
            if (toolMetricsEl) toolMetricsEl.innerHTML = '<div class="error-message">Tool metrics unavailable</div>';
            return;
        }
        const tools = Object.entries(stats.toolMetrics);
        tools.sort(([,a], [,b]) => b.callCount - a.callCount);

        let html = '<div class="tool-metrics-grid">';
        tools.forEach(([toolName, metrics]) => {
            const avgResponseTime = metrics.callCount > 0 ? (metrics.totalResponseTime / metrics.callCount).toFixed(1) : '0.0';
            const successRate = metrics.callCount > 0 ? ((metrics.successCount / metrics.callCount) * 100).toFixed(1) : '100.0';
            html += `
                <div class="tool-metric-card">
                    <div class="tool-name">${toolName}</div>
                    <div class="tool-stats">
                        <div class="stat-row">
                            <span class="stat-label">Total Calls</span>
                            <span class="stat-value">${metrics.callCount.toLocaleString()}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Success Rate</span>
                            <span class="stat-value ${parseFloat(successRate) < 95 ? 'warning' : ''}">${successRate}%</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Avg Response</span>
                            <span class="stat-value">${avgResponseTime}ms</span>
                        </div>
                    </div>
                </div>`;
        });
        html += '</div>';
        toolMetricsEl.innerHTML = html;
    }

    // expose for other scripts and inline handlers
    window.loadOverviewData = loadOverviewData;
    window.displaySystemStats = displaySystemStats;
    window.displayToolMetrics = displayToolMetrics;
})();
