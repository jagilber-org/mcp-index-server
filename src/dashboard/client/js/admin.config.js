/* eslint-disable */
// Extracted from admin.html: Configuration management helpers
(function(){
    async function loadConfiguration() {
        try {
            const res = await fetch('/api/admin/config');
            const data = await res.json();
            if (!data.success) throw new Error('Failed to load config');
            const cfg = data.config;
            const featureFlags = data.featureFlags || {};
            let allFlags = Array.isArray(data.allFlags)? data.allFlags : [];
            if(!allFlags.length){
                // Retry via dedicated endpoint (supports hot reload when only server portion updated)
                try {
                    const fres = await fetch('/api/admin/flags');
                    const fdata = await fres.json();
                    if(fdata.success && Array.isArray(fdata.allFlags)) allFlags = fdata.allFlags;
                } catch { /* ignore */ }
            }
            const flagsHtml = allFlags.length ? `
                <div class="flag-table" style="display:grid; grid-template-columns: 260px 90px 90px 120px 1fr; gap:6px; font-size:12px; align-items:center;">
                    <div style="opacity:0.7; font-weight:600;">Name</div>
                    <div style="opacity:0.7; font-weight:600;">Current</div>
                    <div style="opacity:0.7; font-weight:600;">Default</div>
                    <div style="opacity:0.7; font-weight:600;">Stability</div>
                    <div style="opacity:0.7; font-weight:600;">Description</div>
                    ${allFlags.map(f=>{
                        const isBool = f.type === 'boolean';
                        const currentVal = (f.enabled !== undefined ? (f.enabled? 'on':'off') : (f.value !== undefined ? f.value : '')) || '';
                        const select = isBool ? `<select data-flag="${f.name.toLowerCase()}" class="form-input" style="max-width:86px; padding:2px 4px; font-size:11px;">
                            <option value="1" ${(featureFlags[f.name.toLowerCase()] ?? f.enabled)?'selected':''}>On</option>
                            <option value="0" ${!(featureFlags[f.name.toLowerCase()] ?? f.enabled)?'selected':''}>Off</option>
                        </select>` : `<span style="opacity:0.8;">${currentVal || ''}</span>`;
                        return `<div style="font-family:monospace;">${f.name}</div>
                            <div>${select}</div>
                            <div style="opacity:0.65;">${f.default || ''}</div>
                            <div style="${f.stability==='deprecated'?'color:#e67e22': f.stability==='experimental'?'color:#9b59b6': f.stability==='diagnostic'?'color:#3498db':'opacity:0.85'}; font-size:11px;">${f.stability}</div>
                            <div style="opacity:0.85; font-size:11px; line-height:1.35;">${f.description}</div>`;
                    }).join('')}
                </div>` : '<div style="opacity:0.7;">No feature flags detected</div>';
            const html = `
                <div class="config-layout-wrapper">
                <form onsubmit="return updateConfiguration(event)" class="config-form-root">
                    <div class="form-group">
                        <label class="form-label">Max Connections</label>
                        <input class="form-input" type="number" id="cfg-maxConnections" value="${cfg.serverSettings.maxConnections}" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">Request Timeout (ms)</label>
                        <input class="form-input" type="number" id="cfg-requestTimeout" value="${cfg.serverSettings.requestTimeout}" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">Verbose Logging</label>
                        <select class="form-input" id="cfg-verbose"> <option value="1" ${cfg.serverSettings.enableVerboseLogging ? 'selected':''}>Enabled</option><option value="0" ${!cfg.serverSettings.enableVerboseLogging ? 'selected':''}>Disabled</option></select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Enable Mutation</label>
                        <select class="form-input" id="cfg-mutation"> <option value="1" ${cfg.serverSettings.enableMutation ? 'selected':''}>Enabled</option><option value="0" ${!cfg.serverSettings.enableMutation ? 'selected':''}>Disabled</option></select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Rate Limit Window (ms)</label>
                        <input class="form-input" type="number" id="cfg-windowMs" value="${cfg.serverSettings.rateLimit.windowMs}" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">Rate Limit Max Requests</label>
                        <input class="form-input" type="number" id="cfg-maxRequests" value="${cfg.serverSettings.rateLimit.maxRequests}" />
                    </div>
                    <div style="margin-top:10px;">
                        <button class="action-btn" type="submit">💾 Save Config</button>
                    </div>
                </form>
                <hr/>
                <h3 style="margin-top:18px; margin-bottom:6px;">Feature Flags</h3>
                <div style="font-size:11px; opacity:0.65; margin-bottom:6px;">All recognized flags (edit boolean flags inline – updates persist to flags file). Non-boolean flags are read-only.</div>
                <div class="flags-scroll">${flagsHtml}</div>
                </div>`;
            const target = document.getElementById('config-form');
            try { console.debug('[dashboard-config] flags snapshot', { allFlagsCount: allFlags.length }); } catch {}
            if (target) target.innerHTML = html;
        } catch (e) {
            const target = document.getElementById('config-form');
            if (target) target.innerHTML = '<div class="error">Failed to load configuration</div>';
        }
    }

    async function updateConfiguration(ev) {
        ev.preventDefault();
        const flagSelects = document.querySelectorAll('[data-flag]');
        const featureFlags = {};
        flagSelects.forEach(function(sel){ featureFlags[sel.getAttribute('data-flag')] = sel.value === '1'; });
        const updates = {
            serverSettings: {
                maxConnections: parseInt(document.getElementById('cfg-maxConnections').value),
                requestTimeout: parseInt(document.getElementById('cfg-requestTimeout').value),
                enableVerboseLogging: document.getElementById('cfg-verbose').value === '1',
                enableMutation: document.getElementById('cfg-mutation').value === '1',
                rateLimit: {
                    windowMs: parseInt(document.getElementById('cfg-windowMs').value),
                    maxRequests: parseInt(document.getElementById('cfg-maxRequests').value)
                }
            },
            featureFlags
        };
        try {
            const res = await fetch('/api/admin/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(updates)});
            const data = await res.json();
            if (data.success) { if (typeof showSuccess === 'function') showSuccess('Configuration updated'); loadConfiguration(); } else { if (typeof showError === 'function') showError(data.error || 'Update failed'); }
        } catch (e) { if (typeof showError === 'function') showError('Update failed'); }
        return false;
    }

    window.loadConfiguration = loadConfiguration;
    window.updateConfiguration = updateConfiguration;
})();
