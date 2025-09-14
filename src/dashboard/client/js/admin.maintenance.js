/* eslint-disable */
// Extracted from admin.html: Backup / Restore and maintenance helpers
(function(){
    async function loadBackups() {
        try {
            const sel = document.getElementById('backup-select');
            const meta = document.getElementById('backup-list-meta');
            if (!sel) return;
            sel.innerHTML = '<option value="">Loading...</option>';
            const res = await fetch('/api/admin/maintenance/backups');
            if (!res.ok) throw new Error('list failed');
            const data = await res.json();
            const backups = (data.backups || []).slice(0, 200);
            if (!backups.length) {
                sel.innerHTML = '<option value="">(no backups)</option>';
                if (meta) meta.textContent = 'No backups available';
                return;
            }
            sel.innerHTML = backups.map(b => {
                const label = `${b.id}  •  ${b.instructionCount} files  •  ${b.schemaVersion || 'schema?'}  •  ${new Date(b.createdAt).toLocaleString()}`;
                return `<option value="${b.id}">${label}</option>`;
            }).join('');
            if (meta) meta.textContent = `${backups.length} backup(s)`;
        } catch (err) {
            console.warn('loadBackups error', err);
            const sel = document.getElementById('backup-select');
            if (sel) sel.innerHTML = '<option value="">(error loading)</option>';
        }
    }

    async function restoreSelectedBackup() {
        try {
            const sel = document.getElementById('backup-select');
            const statusEl = document.getElementById('backup-restore-status');
            if (!sel || !sel.value) { if (statusEl) statusEl.textContent = 'Select a backup first'; return; }
            const choice = sel.value;
            if (!confirm(`Restore backup ${choice}? Current instructions will be safety-backed up first.`)) return;
            if (statusEl) statusEl.textContent = 'Restoring...';
            const res = await fetch('/api/admin/maintenance/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backupId: choice }) });
            const data = await res.json();
            if (data.success) {
                if (statusEl) statusEl.textContent = `Restored ${choice} (${data.restored || 0} files)`;
                // Re-load stats & instructions to reflect changes
                if (typeof loadOverviewData === 'function') loadOverviewData();
                if (typeof currentSection !== 'undefined' && currentSection === 'instructions' && typeof loadInstructions === 'function') loadInstructions();
            } else {
                if (statusEl) statusEl.textContent = `Restore failed: ${data.error || data.message || 'unknown'}`;
            }
        } catch (err) {
            const statusEl = document.getElementById('backup-restore-status');
            if (statusEl) statusEl.textContent = 'Error restoring backup';
        }
    }

    async function loadMaintenanceStatus() {
        try {
            const response = await fetch('/api/admin/maintenance');
            const data = await response.json();

            if (data.success) {
                if (typeof displayMaintenanceStatus === 'function') displayMaintenanceStatus(data.maintenance);
            } else {
                if (typeof showError === 'function') showError('Failed to load maintenance status');
            }
        } catch (error) {
            console.error('Error loading maintenance status:', error);
            if (typeof showError === 'function') showError('Failed to load maintenance status');
        }
    }

    function displayMaintenanceStatus(maintenance) {
        const statusClass = maintenance.maintenanceMode ? 'maintenance-enabled' : 'maintenance-disabled';
        const statusText = maintenance.maintenanceMode ? 'MAINTENANCE MODE ENABLED' : 'NORMAL OPERATION';
        let html = `
            <div class="maintenance-status ${statusClass}">
                ${statusText}
            </div>
            <div class="stat-row">
                <span class="stat-label">Last Backup</span>
                <span class="stat-value">${maintenance.lastBackup ? new Date(maintenance.lastBackup).toLocaleString() : 'Never'}</span>
            </div>
            <div style="margin-top:10px; font-weight:600; font-size:13px;">Backups</div>
                            <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:4px;">
                                <button class="action-btn" style="padding:4px 8px; font-size:11px;" onclick="selectLatestBackup()">Select Latest</button>
                                <button class="action-btn danger" style="padding:4px 8px; font-size:11px;" onclick="deleteSelectedBackup()">Delete Selected</button>
                                <button class="action-btn warning" style="padding:4px 8px; font-size:11px;" onclick="promptPruneBackups()">Prune…</button>
                                <input id="backup-search" type="text" placeholder="Filter (id / schema)" oninput="filterBackupRows()" style="flex:1; min-width:160px; padding:4px 6px; background:#1c1e22; border:1px solid #2d2f33; border-radius:4px; color:#d0d4d8; font-size:12px;" />
                                <span id="backup-filter-count" style="font-size:11px; opacity:.65;"></span>
                            </div>
                            <div id="backup-list-full" style="margin-top:6px; font-size:12px; line-height:1.25; max-height:260px; overflow:auto; border:1px solid #2d2f33; border-radius:4px; padding:6px; background:#1c1e22;">
                                Loading backups...
                            </div>
        `;

        if (!maintenance.maintenanceMode) {
            html += `<button class="action-btn warning" onclick="toggleMaintenanceMode(true)">Enable Maintenance Mode</button>`;
        } else {
            html += `<button class="action-btn" onclick="toggleMaintenanceMode(false)">Disable Maintenance Mode</button>`;
        }

        const target = document.getElementById('maintenance-control');
        if (target) target.innerHTML = html;

        // Async load & render full backup list (separate from restore dropdown)
        (async () => {
            const container = document.getElementById('backup-list-full');
            if(!container) return;
            try {
                const res = await fetch('/api/admin/maintenance/backups');
                if(!res.ok) throw new Error('request failed');
                const data = await res.json();
                const backups = Array.isArray(data.backups) ? data.backups : [];
                if(backups.length === 0){
                    container.innerHTML = '<div style="opacity:0.6;">(no backups)</div>';
                    return;
                }
                const fmtSize = (n) => {
                    if(!n) return '0 B';
                    const units = ['B','KB','MB','GB'];
                    let u=0, v=n;
                    while(v >= 1024 && u < units.length-1){ v/=1024; u++; }
                    return v.toFixed(v>=100||u===0?0:1)+' '+units[u];
                };
                let table = '<table id="backup-table" style="width:100%; border-collapse:collapse; font-size:11px;">';
                table += '<thead><tr style="text-align:left; background:#25272b;"><th style="padding:4px;">ID</th><th style="padding:4px;">Created</th><th style="padding:4px;">Files</th><th style="padding:4px;">Size</th><th style="padding:4px;">Schema</th></tr></thead><tbody>';
                backups.forEach(b => {
                    const created = b.createdAt ? new Date(b.createdAt).toLocaleString() : '—';
                    table += `<tr data-backup-id="${b.id}" style="cursor:pointer; border-top:1px solid #2d2f33;">
                        <td style="padding:4px; white-space:nowrap;">${b.id}</td>
                        <td style="padding:4px; white-space:nowrap;">${created}</td>
                        <td style="padding:4px;">${b.instructionCount ?? 0}</td>
                        <td style="padding:4px;">${fmtSize(b.sizeBytes||0)}</td>
                        <td style="padding:4px;">${b.schemaVersion || '—'}</td>
                    </tr>`;
                });
                table += '</tbody></table>';
                table += '<div style="margin-top:4px; opacity:0.55;">Click a row to select it for restore. Use filter box to narrow results.</div>';
                container.innerHTML = table;
                container.querySelectorAll('tr[data-backup-id]').forEach(row => {
                    row.addEventListener('click', () => {
                        const id = row.getAttribute('data-backup-id');
                        const sel = document.getElementById('backup-select');
                        if(sel){ sel.value = id; }
                        container.querySelectorAll('tr[data-backup-id]').forEach(r => r.style.background='');
                        row.style.background = '#2a3038';
                        window.__lastSelectedBackupId = id;
                    });
                });
                window.__allBackupRows = backups.map(b => ({ id: b.id, schema: b.schemaVersion || '', created: b.createdAt, count: b.instructionCount }));
                updateBackupFilterCount();
            } catch(err){
                container.innerHTML = '<div style="color:#e74c3c;">Error loading backups</div>';
            }
        })();
    }

    function selectLatestBackup(){
        const table = document.getElementById('backup-table');
        if(!table) return;
        const first = table.querySelector('tbody tr[data-backup-id]');
        if(first){ first.click(); }
    }

    async function deleteSelectedBackup(){
        const sel = document.getElementById('backup-select');
        const id = (sel && sel.value) || window.__lastSelectedBackupId;
        if(!id){ alert('Select a backup first'); return; }
        if(!confirm(`Delete backup ${id}? This cannot be undone.`)) return;
        try {
            const res = await fetch(`/api/admin/maintenance/backup/${encodeURIComponent(id)}`, { method:'DELETE' });
            const data = await res.json();
            if(data.success){ if (typeof showSuccess === 'function') showSuccess(`Deleted ${id}`); loadMaintenanceStatus(); loadBackups(); }
            else { if (typeof showError === 'function') showError(data.error || 'Delete failed'); }
        } catch(e){ if (typeof showError === 'function') showError('Delete failed'); }
    }

    function promptPruneBackups(){
        const retainStr = prompt('Retain how many newest backups? (0 = delete all)', '10');
        if(retainStr == null) return;
        const retain = parseInt(retainStr,10);
        if(isNaN(retain) || retain < 0){ alert('Enter a non-negative number'); return; }
        pruneBackups(retain);
    }

    async function pruneBackups(retain){
        try {
            const res = await fetch('/api/admin/maintenance/backups/prune', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ retain })});
            const data = await res.json();
            if(data.success){ if (typeof showSuccess === 'function') showSuccess(data.message || 'Pruned'); loadMaintenanceStatus(); loadBackups(); }
            else { if (typeof showError === 'function') showError(data.error || 'Prune failed'); }
        } catch(e){ if (typeof showError === 'function') showError('Prune failed'); }
    }

    function filterBackupRows(){
        const q = (document.getElementById('backup-search')||{value:''}).value.trim().toLowerCase();
        const table = document.getElementById('backup-table');
        if(!table){ return; }
        let visible = 0, total = 0;
        table.querySelectorAll('tbody tr[data-backup-id]').forEach(tr => {
            total++;
            const id = tr.getAttribute('data-backup-id') || '';
            const schema = (tr.cells[4]?.textContent||'');
            const match = !q || id.toLowerCase().includes(q) || schema.toLowerCase().includes(q);
            tr.style.display = match ? '' : 'none';
            if(match) visible++;
        });
        updateBackupFilterCount(visible, total);
    }

    function updateBackupFilterCount(visible, total){
        const el = document.getElementById('backup-filter-count');
        if(!el) return;
        if(visible == null || total == null){
            const table = document.getElementById('backup-table');
            if(!table){ el.textContent=''; return; }
            const rows = table.querySelectorAll('tbody tr[data-backup-id]');
            total = rows.length; visible = Array.from(rows).filter(r=>r.style.display!=='none').length;
        }
        el.textContent = `${visible}/${total}`;
    }

    async function toggleMaintenanceMode(enable) {
        try {
            const response = await fetch('/api/admin/maintenance/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    enabled: enable, 
                    message: enable ? 'Admin panel maintenance' : undefined 
                })
            });

            const data = await response.json();
            if (data.success) {
                if (typeof showSuccess === 'function') showSuccess(data.message);
                loadMaintenanceStatus();
            } else {
                if (typeof showError === 'function') showError('Failed to toggle maintenance mode');
            }
        } catch (error) {
            console.error('Error toggling maintenance mode:', error);
            if (typeof showError === 'function') showError('Failed to toggle maintenance mode');
        }
    }

    // Expose to global for staged migration
    window.loadBackups = loadBackups;
    window.restoreSelectedBackup = restoreSelectedBackup;
    window.loadMaintenanceStatus = loadMaintenanceStatus;
    window.displayMaintenanceStatus = displayMaintenanceStatus;
    window.selectLatestBackup = selectLatestBackup;
    window.deleteSelectedBackup = deleteSelectedBackup;
    window.promptPruneBackups = promptPruneBackups;
    window.pruneBackups = pruneBackups;
    window.filterBackupRows = filterBackupRows;
    window.updateBackupFilterCount = updateBackupFilterCount;
    window.toggleMaintenanceMode = toggleMaintenanceMode;
})();
