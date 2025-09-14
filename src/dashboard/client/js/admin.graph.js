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
    const themeSel = document.getElementById('graph-theme');
  // Default enrich & categories to true if element not yet bound so initial meta shows enriched schema
  const enrich = enrichEl && 'checked' in enrichEl ? enrichEl.checked : true;
  const categories = categoriesEl && 'checked' in categoriesEl ? categoriesEl.checked : true;
    const usage = usageEl && 'checked' in usageEl ? usageEl.checked : false;
    const edgeTypesRaw = edgeTypesEl && 'value' in edgeTypesEl ? (edgeTypesEl.value || '').trim() : '';
    let layout = (layoutSel && 'value' in layoutSel) ? layoutSel.value : 'elk';
    const theme = (themeSel && 'value' in themeSel) ? themeSel.value : 'dark';
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
        const configLines = [];
        if(theme) configLines.push(`  theme: ${theme}`);
        if(effectiveLayout === 'elk') configLines.push('  layout: elk');
        if(configLines.length) mermaidSource = `---\nconfig:\n${configLines.join('\n')}\n---\n` + mermaidSource;
        const ensured = ensureMermaidDirective(mermaidSource);
        if(manualOverride && persistedOverride){
          // Honor manual override: don't rebuild frontmatter or replace content
          setGraphMetaProgress('manual-override');
          window.graphOriginalSource = persistedOverride;
          if(target) target.textContent = persistedOverride;
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
            const renderSource = (manualOverride && persistedOverride) ? persistedOverride : ensured;
            let svg; ({ svg } = await window.mermaid.render('graphMermaidSvg', renderSource));
            const host = document.getElementById('graph-mermaid-svg'); if(host) host.innerHTML = svg;
            setGraphMetaProgress('render-ok','a='+attemptId);
          } catch(rendErr){ setGraphMetaProgress('render-fail','a='+attemptId); }
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
      s.onload = ()=>{ try { const large = !!window.__MERMAID_LARGE_GRAPH_FLAG; let configuredMaxEdges; if(typeof window.__MERMAID_MAX_EDGES === 'number' && window.__MERMAID_MAX_EDGES>0){ configuredMaxEdges = window.__MERMAID_MAX_EDGES; } else { configuredMaxEdges = large ? 20000 : 3000; } const maxTextSize = large ? 10000000 : 1000000; window.mermaid.initialize({ startOnLoad:false, theme:'dark', maxEdges: configuredMaxEdges, maxTextSize }); window.__MERMAID_ACTIVE_MAX_EDGES = configuredMaxEdges; window.__MERMAID_ACTIVE_MAX_TEXT_SIZE = maxTextSize; resolve(null);} catch(e){ reject(e);} };
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

  // Theme insertion
  function insertGraphTheme(){
    const pre = document.getElementById('graph-mermaid'); if(!pre) return;
    const current = pre.textContent || '';
    const hasFrontmatter = /^---[\s\S]*?---/m.test(current);
    setGraphMetaProgress('theme-start');
    // Dynamically pull project CSS palette (falls back to hardcoded defaults if missing)
    let rootStyles; try { rootStyles = getComputedStyle(document.documentElement); } catch { rootStyles = null; }
    const css = (v, fb) => (rootStyles ? (rootStyles.getPropertyValue(v)||'').trim() : '') || fb;
    // Map Mermaid themeVariables to project palette / graph overrides
    const palette = {
      primaryColor: css('--admin-accent', '#667eea'),
      primaryBorderColor: '#6b8cff',
      primaryTextColor: css('--admin-text', '#e3ebf5'),
      lineColor: '#5479ff',
      secondaryColor: css('--admin-accent-alt', '#764ba2'),
      tertiaryColor: css('--admin-success', '#27ae60'),
      background: css('--admin-bg', '#0b0f19'),
      mainBkg: css('--admin-surface', '#101726'),
      secondBkg: css('--admin-surface-alt', '#141e30'),
      clusterBkg: '#273341',
      clusterBorder: '#6b8cff',
      edgeLabelBackground: '#2f3947',
      nodeBkg: '#3a4554',
      nodeBorder: '#6b8cff',
      fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif",
      fontSize: '14px',
      fontWeight: '600',
      clusterLabelFontSize: '16px',
      noteTextColor: css('--admin-text-dim', '#9fb5cc'),
      nodeTextColor: css('--admin-text', '#e3ebf5'),
      tertiaryBorderColor: css('--admin-success', '#27ae60'),
      secondaryBorderColor: css('--admin-accent-alt', '#764ba2'),
      secondaryTextColor: css('--admin-text', '#e3ebf5'),
      tertiaryTextColor: css('--admin-text', '#e3ebf5'),
      titleColor: css('--admin-text', '#e3ebf5')
    };
    // Build YAML block (only include known Mermaid variables)
    const kv = Object.entries(palette).map(([k,v])=>`    ${k}: "${v}"`).join('\n');
    const themeBlock = `---\nconfig:\n  theme: dark\n  themeVariables:\n${kv}\n  layout: elk\n---\n`;
    let updated = hasFrontmatter ? current.replace(/^---[\s\S]*?---\n?/, themeBlock) : themeBlock + current;
    pre.textContent = updated;
    persistGraphSource(updated);
    try { localStorage.setItem('mcp.graph.manualOverrideSource', updated); window.__GRAPH_MANUAL_OVERRIDE = true; } catch{}
    setGraphMetaProgress('theme-inserted');
    if(!graphEditing) toggleGraphEdit();
    // Immediately re-render with new theme block
    (async ()=>{ try { await ensureMermaid(); const { svg } = await window.mermaid.render('graphMermaidSvg', updated); const legacyHost = document.getElementById('graph-mermaid-svg'); if(legacyHost) legacyHost.innerHTML = svg; setGraphMetaProgress('theme-rendered'); } catch(e){ setGraphMetaProgress('theme-render-fail'); } })();
  }
  window.insertGraphTheme = insertGraphTheme;

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
