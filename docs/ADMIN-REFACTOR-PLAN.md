ADMIN UI refactor plan
======================

This document captures the plan to break up the large `admin.html` file in `src/dashboard/client` into smaller, maintainable assets (CSS + JS modules), an estimated effort, and a safe migration path.

1) Measurements (collected from repository)
-------------------------------------------
- `src/dashboard/client/admin.html` — total bytes: 219,389 bytes; lines: 3,663
- inline `<style>` block — bytes: 11,697; lines: 385
- inline `<script>` block — bytes: 175,133; lines: 2,845

Interpretation: the JS is the dominant part of the file (≈80% of HTML bytes). Extracting JS into focused modules and lazy-loading heavy parts (mermaid/ELK/drilldown) will improve maintainability and initial load performance.

2) Goals
--------
- Reduce cognitive surface area by extracting styles and JavaScript into logical modules.
- Keep the `admin.html` shell minimal and easy to read.
- Lazy-load heavy dependencies (mermaid, ELK, layout plugins) only when the user opens the Graph/Drilldown views.
- Preserve current behavior and provide a step-by-step, reversible migration.

3) Target file layout
---------------------
Files to create under `src/dashboard/client`:

- css/
  - `admin.css` — extracted CSS from the existing <style> block.

- js/
  - `admin.boot.js` — minimal initializer; attaches DOMContentLoaded handlers, tiny wiring.
  - `admin.utils.js` — shared utility helpers (escapeHtml, formatBytes, showError/showSuccess, wrappers, shared caches names used across modules).
  - `admin.overview.js` — overview rendering & displaySystemStats/displayToolMetrics/displaySystemHealth.
  - `admin.sessions.js` — session listing, createTestSession, terminateSession, history.
  - `admin.monitor.js` — monitoring, synthetic activity, log viewer and resource-trend polling.
  - `admin.instructions.js` — instruction catalog: load/save/edit/delete, pagination, diff helper.
  - `admin.maintenance.js` — maintenance, backup/restore UI.
  - `admin.graph.js` — mermaid integration, ensureMermaid, ensureMermaidElk, reloadGraphMermaid and renderings. Mark as lazy-load.
  - `admin.drilldown.js` — drilldown layered SVG + ELK layout (ensureElk, renderDrillSvg). Mark as lazy-load.

Optional:
- `vendor/mermaid-loader.js` — tiny wrapper for loading mermaid from CDN or local copy.

4) High-level split mapping (which functions move where)
-------------------------------------------------------
- CSS -> `admin.css` (entire inline <style> block).
- boot & light utilities -> `admin.boot.js`, `admin.utils.js`.
- Overview functions (loadOverviewData, displaySystemStats, displayToolMetrics, displaySystemHealth) -> `admin.overview.js`.
- Sessions -> `admin.sessions.js`.
- Monitoring + Synthetic -> `admin.monitor.js`.
- Instruction management (loadInstructions, renderInstructionList, editor helpers, saveInstruction) -> `admin.instructions.js`.
- Maintenance & backups -> `admin.maintenance.js`.
- Graph + mermaid + frontmatter handling and mermaid boot -> `admin.graph.js` (lazy). Keep ensureMermaid and ensureMermaidElk here.
- Drilldown SVG & ELK integration -> `admin.drilldown.js` (lazy). Keep ensureElk and renderDrillSvg.

5) Loading strategy
-------------------
- Keep small `admin.boot.js` and `admin.utils.js` loaded via <script defer> from `admin.html`.
- Load other modules via script tags (defer) or dynamic import. For heavy parts (`admin.graph.js`, `admin.drilldown.js`) use dynamic import() when the user opens the Graph tab or clicks Render. This avoids initial cost of mermaid/elk.

6) Estimated sizes after extraction (unminified, approximate)
-----------------------------------------------------------
- `admin.html` (shell only): 8–12 KB
- `css/admin.css`: ~11.7 KB (current inline style contents)
- `js/admin.boot.js`: 5–10 KB
- `js/admin.utils.js`: 5–8 KB
- `js/admin.overview.js`: 15–25 KB
- `js/admin.sessions.js`: 8–12 KB
- `js/admin.monitor.js`: 15–25 KB
- `js/admin.instructions.js`: 25–35 KB
- `js/admin.maintenance.js`: 8–12 KB
- `js/admin.graph.js`: 40–60 KB (major chunk; mermaid logic + dynamic loader)
- `js/admin.drilldown.js`: 40–60 KB (ELK + layout + svg rendering)

Total JS (sum): ~160–260 KB (unminified). Note: this is comparable to the original ~171KB, but splitting allows lazy-loading and easier maintenance. Minification + gzip will reduce delivered size significantly.

7) Effort estimate & risk
-------------------------
- Extract CSS and add `admin.boot.js` + `admin.utils.js`: 1–2 hours (low risk).
- Extract core feature modules (overview, sessions, monitoring, maintenance, instructions): 4–6 hours (medium risk for API wiring). Test each section as you go.
- Extract graph + mermaid (lazy): 3–5 hours (medium-high risk; watch mermaid/ELK registration ordering and dynamic import patterns).
- Extract drilldown/ELK: 3–5 hours (medium-high risk; ELK layout can be fragile—keep fallback lane layout).
- Testing/QA & cleanup: 2–4 hours.
- Total: 15–26 engineering hours for one developer (iterative delivery recommended).

8) Migration steps (safe, incremental)
------------------------------------
1. Add `css/admin.css` and update `admin.html` to link it. Test visuals.
2. Add `js/admin.utils.js` and `js/admin.boot.js`. Move small helpers and init wiring. Load them via `<script defer>` in `admin.html`.
3. Incrementally move feature groups (overview first, then sessions, monitoring, etc.) — after each move, run a smoke test for that feature.
4. For heavy features (graph/drilldown), move code into `admin.graph.js` and `admin.drilldown.js` and change event handlers to dynamic import those modules on demand. Keep the old code in place until the lazy-loading call is confirmed working, then remove the original.
5. Run full manual QA: Overview metrics, Graph rendering, Drilldown, Instruction create/edit/save/delete, Backup/restore, Synthetic activity, Log tailing, Sessions.
6. Optionally add a small build step (esbuild/rollup) or leave files as plain modules with dynamic import for simplicity.

9) Testing checklist
--------------------
- Overview: stats load, tool metrics render.
- Graph: load mermaid source, render with elk mode; test theme toggles and high-edge toggles.
- Drilldown: render SVG, test ELK fallback and membership connectors.
- Instructions: load list, create instruction, save, edit, diff, delete.
- Sessions: create test session and terminate.
- Maintenance: create backup, list backups, restore nominee (dry run where possible).
- Monitoring: run synthetic activity, see traces, log viewer tail.

10) Notes & recommendations
--------------------------
- Use dynamic import() for `admin.graph.js` and `admin.drilldown.js` so mermaid/elk are fetched only on demand.
- Consolidate duplicate helpers (there were two `escapeHtml` implementations) into `admin.utils.js` early in the migration.
- Consider a small bundler (esbuild) if you want minified single-file output for production. For quick wins, prefer simple modules + dynamic imports so no build step is required.
- Keep commits small and reversible. Use feature branches for each major extraction (e.g., `feat/admin-extract-css`, `feat/admin-split-overview`).

Appendix: quick example of lazy load wiring (in `admin.boot.js`):

```js
document.getElementById('graph-tab-button').addEventListener('click', async ()=>{
  // dynamically import heavy module only when needed
  const mod = await import('./js/admin.graph.js');
  if(mod && mod.initGraph) mod.initGraph();
});
```

-- End plan
