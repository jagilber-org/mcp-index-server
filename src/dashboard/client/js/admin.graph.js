/* eslint-disable */
// Extracted graph/mermaid logic from admin.html
(function(){
  // State
  window.graphOriginalSource = '';
  let graphEditing = false;

  let __graphReloadInFlight = false;
  let __graphReloadAttempt = 0;
  let __graphReloadWatchdog = null;
  function setGraphMetaProgress(stage, extra){
    try {
      const meta = document.getElementById('graph-meta2') || document.getElementById('graph-meta');
      if(meta){
        const ts = Date.now()%100000;
        const base = meta.textContent || '';
        const marker = `[stage:${stage}${extra?';'+extra:''};t=${ts}]`;
        if(!/\[stage:/.test(base)) meta.textContent = base + ' ' + marker; else meta.textContent = base.replace(/\[stage:[^\]]+\]/, marker);
      }
    } catch{}
  }

  async function reloadGraphMermaid(){
    if(__graphReloadInFlight){ setGraphMetaProgress('skip-concurrent'); return; }
    __graphReloadInFlight = true; __graphReloadAttempt++;
    const attemptId = __graphReloadAttempt;
    clearTimeout(__graphReloadWatchdog);
    __graphReloadWatchdog = setTimeout(()=>{
      setGraphMetaProgress('watchdog-expired','a='+attemptId);
      __graphReloadInFlight = false;
    }, 15000);
    setGraphMetaProgress('start','a='+attemptId);
    const enrichEl = document.getElementById('graph-enrich');
    const categoriesEl = document.getElementById('graph-categories');
    const usageEl = document.getElementById('graph-usage');
    const edgeTypesEl = document.getElementById('graph-edgeTypes');
  const layoutSel = document.getElementById('graph-layout');
  // Default enrich & categories to true if element not yet bound so initial meta shows enriched schema
  const enrich = enrichEl && 'checked' in enrichEl ? enrichEl.checked : true;
  const categories = categoriesEl && 'checked' in categoriesEl ? categoriesEl.checked : true;
    const usage = usageEl && 'checked' in usageEl ? usageEl.checked : false;
    const edgeTypesRaw = edgeTypesEl && 'value' in edgeTypesEl ? (edgeTypesEl.value || '').trim() : '';
    let layout = (layoutSel && 'value' in layoutSel) ? layoutSel.value : 'elk';
  const theme = 'base'; // fixed project-standard theme
    const params = new URLSearchParams();
    const selCatsEl = document.getElementById('drill-categories');
    const selInstEl = document.getElementById('drill-instructions');
    const selectedCategories = selCatsEl ? Array.from(selCatsEl.selectedOptions).map(o=>o.value).filter(Boolean) : [];
    const selectedIds = selInstEl ? Array.from(selInstEl.selectedOptions).map(o=>o.value).filter(Boolean) : [];
    const scopeFiltered = selectedCategories.length > 0 || selectedIds.length > 0;
    // Always include toggle flags irrespective of scope filtering so meta (schema version, categories)
    // remains accurate and tests expecting enrichment signals succeed.
    if(enrich) params.set('enrich','1');
    if(categories) params.set('categories','1');
    if(usage) params.set('usage','1');
    if(edgeTypesRaw) params.set('edgeTypes', edgeTypesRaw);
    if(selectedCategories.length) params.set('selectedCategories', selectedCategories.join(','));
    if(selectedIds.length) params.set('selectedIds', selectedIds.join(','));
    const target = document.getElementById('graph-mermaid');
    const metaEl = document.getElementById('graph-meta');
    const metaEl2 = document.getElementById('graph-meta2');
    if(target) target.textContent = '(loading graph...)';
    const manualOverride = window.__GRAPH_MANUAL_OVERRIDE === true;
    const persistedOverride = !manualOverride ? null : (function(){
      try { return localStorage.getItem('mcp.graph.manualOverrideSource') || null; } catch { return null; }
    })();
  setGraphMetaProgress('params', 'en='+(enrich?1:0)+';cat='+(categories?1:0)+';use='+(usage?1:0)+';selCats='+selectedCategories.length+';selIds='+selectedIds.length);
    let fetchOk = false; let data = null; let lastErr = null;
    try {
      setGraphMetaProgress('fetch','a='+attemptId);
      const res = await fetch('/api/graph/mermaid?'+params.toString());
      if(!res.ok) throw new Error('http '+res.status);
      data = await res.json();
      fetchOk = !!(data && data.success && data.mermaid);
      setGraphMetaProgress(fetchOk? 'fetch-ok':'fetch-empty','a='+attemptId);
    } catch(e){ lastErr = e; setGraphMetaProgress('fetch-error','a='+attemptId); }
    if(!fetchOk && attemptId === 1){
      // Retry once with ultra-minimal params
      try {
        setGraphMetaProgress('retry1');
        const res2 = await fetch('/api/graph/mermaid?enrich=1');
        if(res2.ok){ const d2 = await res2.json(); if(d2?.success && d2.mermaid){ data = d2; fetchOk = true; setGraphMetaProgress('retry-ok'); }}
      } catch{ setGraphMetaProgress('retry-fail'); }
    }
    if(fetchOk){
      try {
        let mermaidSource = data.mermaid;
        setGraphMetaProgress('fetched-bytes','len='+ (mermaidSource? mermaidSource.length:0));
        const effectiveLayout = layout === 'elk' ? 'elk' : 'default';
        if(effectiveLayout === 'elk') await ensureMermaidElk();
        // Merge or create frontmatter ensuring single config.theme + config.layout entries
        function mergeFrontmatter(src){
          const wantThemeLine = theme ? `  theme: ${theme}` : null;
          const wantLayoutLine = (effectiveLayout === 'elk') ? '  layout: elk' : null;
          const hasFrontmatter = src.startsWith('---\n');
          if(!hasFrontmatter){
            const lines = ['config:'];
            if(wantThemeLine) lines.push(wantThemeLine);
            if(wantLayoutLine) lines.push(wantLayoutLine);
            return `---\n${lines.join('\n')}\n---\n`+src;
          }
          // Split existing frontmatter header & body
          const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(src);
          if(!m) return src; // malformed, skip
          let header = m[1];
          const body = m[2];
          // Ensure config: section exists
          if(!/^config:/m.test(header)){
            header = 'config:\n'+header;
          }
            // Remove existing theme/layout lines inside config: top-level to avoid duplicates
          header = header.split(/\r?\n/).filter(l=>!(/(^\s*theme:\s)/.test(l)||/(^\s*layout:\s)/.test(l))).join('\n');
          // Reconstruct with desired lines appended after config:
          const rebuilt = header.split(/\r?\n/);
          // Find index of 'config:'
          let cfgIdx = rebuilt.findIndex(l=>/^config:/.test(l));
          if(cfgIdx === -1){ rebuilt.unshift('config:'); cfgIdx = 0; }
          const inject = [];
          if(wantThemeLine) inject.push(wantThemeLine);
          if(wantLayoutLine) inject.push(wantLayoutLine);
          rebuilt.splice(cfgIdx+1,0,...inject);
          return `---\n${rebuilt.join('\n')}\n---\n${body}`;
        }
        mermaidSource = mergeFrontmatter(mermaidSource);
        // Sanitize duplicated YAML mapping keys in frontmatter (e.g., accidental repeated darkMode)
        function sanitizeFrontmatter(src){
          if(!src || src.indexOf('---') !== 0) return src;
          try {
            const segMatch = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(src);
            if(!segMatch) return src; // not standard frontmatter pattern
            const header = segMatch[1];
            const body = segMatch[2];
            const lines = header.split(/\r?\n/);
            const seenAtIndent = {}; // key -> indent level signature
            const out = [];
            for(const line of lines){
              // Match YAML simple key: value OR key: (end) respecting indentation
              const m = /^(\s*)([A-Za-z0-9_-]+):/.exec(line);
              if(m){
                const indent = m[1].length;
                const key = m[2];
                const sig = indent+':'+key;
                if(seenAtIndent[sig]){
                  // Skip duplicate at same nesting level
                  continue;
                }
                seenAtIndent[sig] = true;
              }
              out.push(line);
            }
            return `---\n${out.join('\n')}\n---\n${body}`;
          } catch{ return src; }
        }
        let ensured = ensureMermaidDirective(mermaidSource);
        ensured = sanitizeFrontmatter(ensured);
        // If manual override is active, sanitize it too so duplicate keys (e.g. darkMode) don't break parse
        let sanitizedOverride = null;
        if(manualOverride && persistedOverride){
          sanitizedOverride = sanitizeFrontmatter(persistedOverride);
          setGraphMetaProgress('manual-override');
          window.graphOriginalSource = sanitizedOverride;
          if(target) target.textContent = sanitizedOverride;
        } else {
          window.graphOriginalSource = ensured;
          if(target) target.textContent = ensured;
        }
        if(metaEl) metaEl.textContent = `schema=v${data.meta?.graphSchemaVersion} nodes=${data.meta?.nodeCount} edges=${data.meta?.edgeCount}`;
        setGraphMetaProgress('render-prep','a='+attemptId);
        try { await ensureMermaid(); } catch{}
        try { if(effectiveLayout === 'elk' && !window.mermaid?.mcpElkRegistered) await ensureMermaidElk(); } catch{}
        if(window.mermaid){
          setGraphMetaProgress('render-run','a='+attemptId);
          try {
            const renderSource = (manualOverride && sanitizedOverride) ? sanitizedOverride : ensured;
            // Lightweight syntax validation before attempting full render (helps surface parse errors explicitly)
            try {
              if(window.mermaid.parse){
                await window.mermaid.parse(renderSource);
              }
            } catch(parseErr){
              setGraphMetaProgress('parse-fail','a='+attemptId);
              const hostParse = document.getElementById('graph-mermaid-svg');
              if(hostParse){
                hostParse.innerHTML = `<div style="color:#ff6b6b; font-family:monospace; white-space:pre;">Mermaid parse error:: ${(parseErr && parseErr.message) || parseErr}</div>`;
              }
              // Abort further render attempt
              throw parseErr;
            }
            let svg; ({ svg } = await window.mermaid.render('graphMermaidSvg', renderSource));
            const host = document.getElementById('graph-mermaid-svg'); if(host) host.innerHTML = svg;
            setGraphMetaProgress('render-ok','a='+attemptId);
          } catch(rendErr){
            setGraphMetaProgress('render-fail','a='+attemptId);
            const hostErr = document.getElementById('graph-mermaid-svg');
            if(hostErr && !/Mermaid parse error/.test(hostErr.textContent||'')){
              hostErr.innerHTML = `<div style="color:#ff6b6b; font-family:monospace; white-space:pre;">Mermaid render failed:: ${(rendErr && rendErr.message) || rendErr}</div>`;
            }
            try { console.warn('[mermaid render failed]', rendErr); } catch{}
          }
        }
      } catch(procErr){ setGraphMetaProgress('process-error','a='+attemptId); }
    } else {
      if(target) target.textContent = `(graph unavailable${lastErr?': '+(lastErr.message||lastErr):''})`;
      setGraphMetaProgress('unavailable','err='+(lastErr && (lastErr.message||String(lastErr))||'none'));
    }
    clearTimeout(__graphReloadWatchdog);
    __graphReloadInFlight = false;
  }

  function ensureMermaidDirective(src){
    if(!src) return 'flowchart TB';
    const hasDirective = /^(---[\s\S]*?---\s*)?(%%.*\n)*\s*(flowchart|graph)\b/m.test(src);
    if(hasDirective) return src;
    if(/^---/.test(src)){
      const parts = src.split(/---\s*\n/);
      if(parts.length>=3){ const rest = parts.slice(2).join('---\n'); return `---\n${parts[1]}---\nflowchart TB\n${rest}`; }
    }
    return 'flowchart TB\n'+src;
  }

  // Mermaid loader state (copied behavior)
  let mermaidLoading = null;
  let mermaidElkLoading = null;
  const MERMAID_VERSION_TARGET = '11';
  function mermaidNeedsReload(force){ if(force) return true; if(!window.mermaid) return true; const ver = window.mermaid.version || window.mermaid.mermaidAPI?.getConfig?.()?.version || ''; if(ver.startsWith('10.')) return true; return false; }
  async function ensureMermaid(force){
    if(mermaidNeedsReload(force)){
      if(window.mermaid && (force || !window.mermaid.registerLayoutLoaders)){
        try{ [...document.querySelectorAll('script[src*="mermaid"]')].forEach(s=>s.remove()); } catch{}
        try{ delete window.mermaid; } catch{}
        mermaidLoading = null;
      }
    }
    if(window.mermaid && !force) return;
    if(mermaidLoading) return mermaidLoading;
    mermaidLoading = new Promise((resolve,reject)=>{
      const s = document.createElement('script');
      const cb = Date.now().toString().slice(-7);
      s.src = `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION_TARGET}/dist/mermaid.min.js?cb=${cb}`;
      s.onload = ()=>{ try { const large = !!window.__MERMAID_LARGE_GRAPH_FLAG; let configuredMaxEdges; if(typeof window.__MERMAID_MAX_EDGES === 'number' && window.__MERMAID_MAX_EDGES>0){ configuredMaxEdges = window.__MERMAID_MAX_EDGES; } else { configuredMaxEdges = large ? 20000 : 3000; } const maxTextSize = large ? 10000000 : 1000000; // Standardize base theme (frontmatter may still override per-graph)
        window.mermaid.initialize({ startOnLoad:false, theme:'base', maxEdges: configuredMaxEdges, maxTextSize }); window.__MERMAID_ACTIVE_MAX_EDGES = configuredMaxEdges; window.__MERMAID_ACTIVE_MAX_TEXT_SIZE = maxTextSize; resolve(null);} catch(e){ reject(e);} };
      s.onerror = (e)=>reject(e instanceof Error? e : new Error('mermaid load failed'));
      document.head.appendChild(s);
    });
    return mermaidLoading;
  }

  async function ensureMermaidElk(){
    await ensureMermaid();
    if(window.mermaid && !window.mermaid.registerLayoutLoaders && !window.mermaid.__reloadedOnce){ window.mermaid.__reloadedOnce = true; await ensureMermaid(true); }
    if(window.mermaid?.mcpElkRegistered) return;
    if(mermaidElkLoading) return mermaidElkLoading;
    mermaidElkLoading = new Promise((resolve)=>{
      const localElk = './mermaid-layout-elk.esm.min.mjs';
      const urls = [ localElk, 'https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@0.2.0/dist/mermaid-layout-elk.esm.min.mjs', 'https://unpkg.com/@mermaid-js/layout-elk@0.2.0/dist/mermaid-layout-elk.esm.min.mjs', 'https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@latest/dist/mermaid-layout-elk.esm.min.mjs' ];
      let idx = 0;
      function tryNext(){ if(window.mermaid?.mcpElkRegistered) return resolve(null); if(idx >= urls.length) return resolve(null); const url = urls[idx++]; (async ()=>{ try{ const mod = await import(url); let descriptorArray = (mod && mod.default && Array.isArray(mod.default)) ? mod.default : (Array.isArray(mod) ? mod : null); if(!descriptorArray && typeof mod === 'object'){ const arr = Array.isArray(mod.default)? mod.default : null; descriptorArray = arr || null; } if(descriptorArray && window.mermaid?.registerLayoutLoaders){ try{ window.mermaid.registerLayoutLoaders(descriptorArray); window.mermaid.mcpElkRegistered = true; resolve(null); return; } catch(e){ /* try next */ } } } catch(e){ /* try next */ } tryNext(); })(); }
      tryNext();
    });
    return mermaidElkLoading;
  }

  function initGraphScopeDefaults(){
    const catSel = document.getElementById('drill-categories');
    const instSel = document.getElementById('drill-instructions');
    if(catSel && !catSel.options.length) refreshDrillCategories().catch(()=>{});
    if(instSel && !instSel.options.length) loadDrillInstructions().catch(()=>{});
    const mer = document.getElementById('graph-mermaid'); if(mer) mer.textContent='(no selection - choose categories and/or instructions then Refresh)';
  }

  function copyMermaidSource(){ const el = document.getElementById('graph-mermaid'); if(!el) return; const txt = el.textContent || ''; navigator.clipboard.writeText(txt).catch(()=>{}); }

  function toggleGraphEdit(){
    if(graphEditing){
      cancelGraphEdit();
      return;
    }
    const target = document.getElementById('graph-mermaid');
    if(!target) return;
    // Capture current content as restore baseline when entering edit mode
    window.graphOriginalSource = target.textContent || '';
    graphEditing = true;
    target.setAttribute('contenteditable','true');
    target.style.outline = '1px solid #3498db';
  window.__GRAPH_MANUAL_OVERRIDE = true; // enable manual override mode
    setGraphMetaProgress('edit-start');
    try { document.getElementById('graph-edit-btn').style.display='none'; } catch{}
    try { document.getElementById('graph-apply-btn').style.display='inline-block'; } catch{}
    try { document.getElementById('graph-cancel-btn').style.display='inline-block'; } catch{}
  }

  function applyGraphEdit(){
    const target = document.getElementById('graph-mermaid');
    if(!target) return;
    const code = target.textContent || '';
    // Promote edited content to new baseline so subsequent cancel doesn't revert it
    window.graphOriginalSource = code;
  persistGraphSource(code);
  try { localStorage.setItem('mcp.graph.manualOverrideSource', code); } catch{}
    setGraphMetaProgress('apply');
    (async ()=>{
      try {
        await ensureMermaid();
        const { svg } = await window.mermaid.render('graphMermaidSvg', code);
        const legacyHost = document.getElementById('graph-mermaid-svg'); if(legacyHost) legacyHost.innerHTML = svg;
        setGraphMetaProgress('apply-ok');
      } catch(e){
        setGraphMetaProgress('apply-fail');
        try { alert('Render failed: '+ (e && e.message || e)); } catch{}
      }
    })();
    cancelGraphEdit(true); // keep edited content visible
  }

  function cancelGraphEdit(keep){
  if(!graphEditing) return;
    const target = document.getElementById('graph-mermaid');
    if(target){
      target.removeAttribute('contenteditable');
      target.style.outline='none';
      if(!keep){
        // Restore baseline content
        target.textContent = window.graphOriginalSource;
      }
    }
  graphEditing=false;
    setGraphMetaProgress('edit-end');
    try { document.getElementById('graph-edit-btn').style.display='inline-block'; } catch{}
    try { document.getElementById('graph-apply-btn').style.display='none'; } catch{}
    try { document.getElementById('graph-cancel-btn').style.display='none'; } catch{}
  }

  // Drilldown helper placeholders (real functions live in admin.drilldown.js but we provide async-safe calls)
  async function refreshDrillCategories(){ if(typeof window.refreshDrillCategories === 'function') return window.refreshDrillCategories(); }
  async function loadDrillInstructions(){ if(typeof window.loadDrillInstructions === 'function') return window.loadDrillInstructions(); }

  // Expose
  window.reloadGraphMermaid = reloadGraphMermaid;
  window.reloadGraphMermaidForce = function(){
    try { clearTimeout(__graphReloadWatchdog); } catch{}
    __graphReloadInFlight = false; // clear guard
    reloadGraphMermaid();
  };
  window.ensureMermaid = ensureMermaid;
  window.ensureMermaidElk = ensureMermaidElk;
  window.initGraphScopeDefaults = initGraphScopeDefaults;
  window.ensureMermaidDirective = ensureMermaidDirective;
  window.copyMermaidSource = copyMermaidSource;
  window.toggleGraphEdit = toggleGraphEdit;
  window.applyGraphEdit = applyGraphEdit;
  window.cancelGraphEdit = cancelGraphEdit;

  // Local persistence helpers
  const LS_KEY = 'mcp.graph.lastSource';
  function persistGraphSource(src){ try { if(src && src.trim().length) localStorage.setItem(LS_KEY, src); } catch{} }
  function loadPersistedGraphSource(){ try { return localStorage.getItem(LS_KEY) || ''; } catch { return ''; } }
  window.__persistGraphSource = persistGraphSource;

  // Auto render on content edits when checkbox enabled
  function bindAutoRender(){
    const pre = document.getElementById('graph-mermaid');
    if(!pre) return;
    pre.addEventListener('input', ()=>{
      const auto = (document.getElementById('graph-auto-render')||{}).checked;
      if(auto && graphEditing){
        const code = pre.textContent || '';
        persistGraphSource(code);
        // Debounced lightweight render (cancel previous if still pending)
        clearTimeout(window.__graphAutoRenderTimer);
        window.__graphAutoRenderTimer = setTimeout(()=>{
          (async ()=>{ try { await ensureMermaid(); const { svg } = await window.mermaid.render('graphMermaidSvg', code); const legacyHost = document.getElementById('graph-mermaid-svg'); if(legacyHost) legacyHost.innerHTML = svg; } catch{} })();
        }, 400);
      }
    });
  }

  // Theme insertion removed (fixed theme configuration)

  document.addEventListener('DOMContentLoaded', ()=>{
    bindAutoRender();
    // If we have a persisted manual edit, restore it (but allow fresh reload to overwrite when refreshed)
    const persisted = loadPersistedGraphSource();
    if(persisted){
      const target = document.getElementById('graph-mermaid');
      if(target && target.textContent && !/\(loading graph/.test(target.textContent)){
        // Only restore if existing content is a real graph
        target.textContent = persisted;
      }
    }
    // Restore manual override source if present
    try {
      const mo = localStorage.getItem('mcp.graph.manualOverrideSource');
      if(mo){ window.__GRAPH_MANUAL_OVERRIDE = true; const t = document.getElementById('graph-mermaid'); if(t) t.textContent = mo; }
    } catch{}
  });

  let __graphInitialAutoReload = false;
  async function graphEnsureReadyAndReload(){
    // Avoid multiple concurrent auto reloads
    if(__graphInitialAutoReload) return; __graphInitialAutoReload = true;
    try {
      // Ensure categories then instructions then mermaid libs before reload
      if(typeof window.refreshDrillCategories === 'function') {
        try { await window.refreshDrillCategories(); } catch {}
      }
      if(typeof window.loadDrillInstructions === 'function') {
        try { await window.loadDrillInstructions(); } catch {}
      }
      // Ensure mermaid (and elk) prior to first fetch so meta elements ready quickly
      try { await ensureMermaid(); } catch {}
      try { await ensureMermaidElk(); } catch {}
      await reloadGraphMermaid();
    } catch(e){
      try { console.warn('[graphEnsureReadyAndReload] failed', e); } catch{}
    }
  }
  window.graphEnsureReadyAndReload = graphEnsureReadyAndReload;

  // Attach refresh button listener (id added in admin.html)
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = document.getElementById('graph-refresh-btn');
    if(btn){ btn.addEventListener('click', ()=> window.reloadGraphMermaidForce()); }
  });
})();
