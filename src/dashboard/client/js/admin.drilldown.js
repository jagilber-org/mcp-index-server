/* eslint-disable */
// Extracted drilldown helpers from admin.html
(function(){
  async function refreshDrillCategories(){
    const el = document.getElementById('drill-categories');
    if(!el) return;
    try{
      const res = await fetch('/api/graph/categories');
      const data = await res.json();
      el.innerHTML = '';
      if(Array.isArray(data?.categories)){
        data.categories.forEach(c=>{ const o = document.createElement('option'); o.value=c.id||c.name; o.textContent = c.name||c.id; el.appendChild(o); });
        // Auto-select first up to 3 categories to ensure graph renders without manual user action (improves test stability)
        let auto = 0; for(const opt of Array.from(el.options)){ if(auto<3){ opt.selected = true; auto++; } }
      }
      // If instructions list already present, attempt graph reload (admin.graph.js will pick up selection)
      if(typeof window.reloadGraphMermaid === 'function') { try { window.reloadGraphMermaid(); } catch(_){} }
    }catch(e){ console.warn('failed refreshDrillCategories',e); }
  }

  async function loadDrillInstructions(){
    const el = document.getElementById('drill-instructions');
    if(!el) return;
    try{
      const res = await fetch('/api/graph/instructions');
      const data = await res.json();
      el.innerHTML = '';
      if(Array.isArray(data?.instructions)){
        data.instructions.forEach(i=>{ const o = document.createElement('option'); o.value=i.id; o.textContent = `${i.title||i.id}`; el.appendChild(o); });
        // Auto-select none by default to keep initial scope primarily category-driven.
      }
    }catch(e){ console.warn('failed loadDrillInstructions',e); }
  }

  function toggleDrillSelection(){ const btn = document.getElementById('drill-refresh-btn'); if(btn) btn.disabled = false; }

  // Expose for admin.graph.js to call
  window.refreshDrillCategories = refreshDrillCategories;
  window.loadDrillInstructions = loadDrillInstructions;
  window.toggleDrillSelection = toggleDrillSelection;
})();
