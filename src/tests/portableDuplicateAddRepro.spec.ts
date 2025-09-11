import { describe, it, expect } from 'vitest';

// Reproduction: duplicate create should not yield a subsequent get -> notFound.
// Uses portable client abstraction only (per user directive).
// Precondition: instructions directory contains mcp-server-testing-patterns-2025.json
// copied from production before running this test. The test will:
// 1. Start client, list to confirm presence.
// 2. Attempt create with same id (expect created=false or skipped / overwritten=false unless overwrite specified).
// 3. Immediately read(id) and assert it is retrievable (no notFound).
// 4. Emit structured diagnostics if any anomaly occurs.

describe('Portable Duplicate Add Repro (mcp-server-testing-patterns-2025)', () => {
  it('duplicate add must not produce immediate notFound on get', async () => {
    process.env.MCP_ENABLE_MUTATION = '1';
    const targetId = 'mcp-server-testing-patterns-2025';
    // Isolation strategy: unless explicitly opting into repo-scale run (PORTABLE_HARNESS_USE_REPO_DIR=1),
    // create a temp instructions directory to eliminate large catalog scan cost.
    let instructionsDir = process.env.TEST_INSTRUCTIONS_DIR;
    if(!instructionsDir){
      if(process.env.PORTABLE_HARNESS_USE_REPO_DIR === '1'){
        instructionsDir = `${process.cwd()}\\instructions`;
      } else {
        const os = await import('os');
        const fs = await import('fs');
        const path = await import('path');
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-add-repro-'));
        instructionsDir = path.join(tmpBase, 'instructions');
        fs.mkdirSync(instructionsDir, { recursive:true });
      }
    }
    process.env.INSTRUCTIONS_DIR = instructionsDir;
  // Pre-seed the file with the EXACT payload user provided (full multi-section playbook) to ensure
  // this red test operates on the authoritative content, independent of prior imports.
  const fs = await import('fs');
  const path = await import('path');
  const filePath = path.join(instructionsDir, targetId + '.json');
  const providedBody = `# MCP Server Testing Patterns 2025 - Structured Validation Playbook\n\n## Purpose\nCodify repeatable patterns for validating MCP server functionality (capabilities, mutations, governance, performance) to ensure reliable multi-workspace usage and regression resilience.\n\n## Core Testing Pillars\n1. Capability Surface Verification\n2. Instruction CRUD & Persistence\n3. Governance & Metadata Integrity\n4. Performance & Resource Efficiency\n5. Drift & Integrity Detection\n6. Usage Analytics & Adoption\n\n## Pattern 1: Capability Surface Snapshot\n\n\`\`\`\nTools Enumerate -> Categorize -> Compare Baseline Hash -> Flag Deltas\n\`\`\`\nSteps:\n1. list/tools (capture names, categories)\n2. hash baseline (store with timestamp)\n3. diff against last known manifest\n4. alert on additions/removals (breaking risk score)\n\n## Pattern 2: Instruction Lifecycle Roundtrip\n| Step | Action | Expected | Metric |\n|------|--------|----------|--------|\n| 1 | add test-instruction-X | hash changes | add latency |\n| 2 | get test-instruction-X | body exact | retrieval ms |\n| 3 | list | entry present | catalog size |\n| 4 | restart server | entry persists | persistence OK |\n| 5 | delete (optional) | hash changes | cleanup latency |\n\n## Pattern 3: Governance Field Validation\nRequired fields: id, title, body, status, owner (if mandated), priorityTier, reviewIntervalDays. Test:\n- Add with missing optional fields -> auto-populate defaults\n- Attempt add missing required -> expect validation error\n- Edit owner -> verify changeLog + updatedAt mutate\n\n## Pattern 4: Performance Budget Checks\nThreshold examples (adjust per environment):\n- list: < 150ms\n- get: < 100ms\n- add(import): < 300ms (median)\n- diff/groom: < 400ms\nRecord 10-sample rolling median; raise warning above 1.5x baseline.\n\n## Pattern 5: Drift & Integrity Cycle\n1. list (catalog snapshot)\n2. usage/track for sentinel instruction\n3. groom (normalize)\n4. diff (no-op expectation)\n5. integrity/verify (when implemented) -> expect PASS\n\n## Pattern 6: High-Risk Change Guardrails\n| Change Type | Risk | Extra Step |\n|-------------|------|-----------|\n| Tool Removal | High | require manual approval hash |\n| Schema Field Add | High | run migration dry-run |\n| Instruction Overwrite | Medium | capture pre-image snapshot |\n| Owner Reassignment | Medium | log governance event |\n| Review Interval Change | Low | ensure nextReviewDue recalculated |\n\n## Pattern 7: Usage Analytics Sanity\n- Track 3 distinct instructions\n- usage/hotset includes them within N events\n- usage/flush persists & clears ephemeral counters (if available)\n\n## Pattern 8: Edge Content Stress (Reference)\nLeverage: complex-edge-cases-instruction-2025 & complex-test-instruction-persistence-2025 as canonical stress objects.\n\n## Pattern 9: Backup & Restore Drill\n1. Export instructions directory snapshot\n2. Simulate deletion of one test instruction on disk\n3. Restart with ALWAYS_RELOAD -> absence confirmed\n4. Re-import snapshot -> integrity restored\n\n## Pattern 10: Hash Determinism\n- Add instruction A\n- Re-import identical A -> no hash change (idempotent)\n- Modify single char -> new hash != old hash\n\n## Metrics Schema (Suggested)\n\n\`\`\`json\n{\n  "timestamp": "2025-08-31T00:00:00Z",\n  "operation": "add",\n  "latencyMs": 123,\n  "catalogHash": "...",\n  "catalogCount": 42,\n  "anomalies": []\n}\n\`\`\`\n\n## Failure Triage Quick Table\n| Symptom | Likely Cause | First Action | Deep Dive |\n|---------|-------------|--------------|-----------|\n| Add claims success, not listed | Write bypassed or filter skip | Enable verbose logging | Inspect disk, check write path |\n| Hash unchanged after add | No mutation persisted | Compare pre/post snapshots | Force reload & diff |\n| Slow list (>500ms) | I/O or large body parse | Capture profiler sample | Segment large instructions |\n| Missing governance fields | Validation gap | Enforce schema at add | Add server-side check |\n| Drift after groom | Non-idempotent normalization | Inspect changed fields | Add deterministic ordering |\n\n## Daily Test Cadence (Light)\n1. Capability snapshot\n2. Add/get/delete sentinel (optional)\n3. Hash compare vs prior day\n\n## Weekly Extended Cadence\n1. Full lifecycle roundtrip\n2. Drift + groom verification\n3. Performance budget re-baseline\n4. Backup/restore simulation\n\n## Risk Mitigation\n- Maintain sentinel instructions (test-add-functionality-2025, complex-edge-cases-instruction-2025)\n- Log structured metrics for longitudinal trends\n- Alert on riskScore spikes or owner=unowned above threshold percentage\n\n## Adoption Metrics\nTrack: distinct instructions retrieved per day, add vs overwrite ratio, catalog growth trend (slope). Target stable growth without orphaned unowned entries > 30%.\n\n## Next Evolution\n- Integrate integrity/verify endpoint once server supports\n- Add semantic diff classification (content vs metadata)\n- Introduce automatic rollback on failed overwrite anomaly\n\n*End of playbook.*`;
  // Ensure directory exists
  if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir,{recursive:true});
  const crypto = await import('crypto');
  const bodyHash = crypto.createHash('sha256').update(providedBody.trim(),'utf8').digest('hex');
  let needWrite = true;
  if(fs.existsSync(filePath)){
    try {
      const existing = JSON.parse(fs.readFileSync(filePath,'utf8')) as { body?:string };
      if(existing.body === providedBody) needWrite = false;
    } catch { /* ignore parse */ }
  }
  if(needWrite){
    const now = new Date().toISOString();
    const record = {
      id: targetId,
      title: 'MCP Server Testing Patterns 2025 - Structured Validation Playbook',
      body: providedBody,
      priority: 58,
      audience: 'all',
      requirement: 'recommended',
      categories: ['testing','patterns','governance','validation','performance'],
      sourceHash: bodyHash,
      schemaVersion: '2',
      createdAt: now,
      updatedAt: now,
      riskScore: 62,
      version: '1.0.0',
      status: 'approved',
      owner: 'quality-engineering',
      priorityTier: 'P2',
      classification: 'internal',
      lastReviewedAt: now,
      nextReviewDue: now,
      reviewIntervalDays: 60,
      changeLog: [ { version:'1.0.0', changedAt: now, summary:'initial import' } ],
      semanticSummary: '# MCP Server Testing Patterns and Validation'
    };
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
  }
  const { createInstructionClient } = await import('../portableClientShim.js');
  // Cast to any to access extended portable client surface (list/create/remove) not declared in shim interface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = await createInstructionClient({ forceMutation:true, instructionsDir });

  const list1 = await client.list();
    const present = (list1.items || []).some((i:any)=> i.id === targetId);
    // We allow either present (preferred) or absent (will create) but record state.

    // Baseline read to assert seeded body present (diagnostic guard)
    const baseline:any = await client.read(targetId).catch(()=>null);
    if(!baseline?.item?.body?.startsWith('# MCP Server Testing Patterns 2025 - Structured Validation Playbook')){
      // eslint-disable-next-line no-console
      console.error('[duplicate-add-repro][seed-mismatch]', { hasBaseline: !!baseline, snippet: baseline?.item?.body?.slice(0,80) });
    }

    const createResp = await client.create({ id: targetId, body: '# TEMP BODY FOR DUPLICATE REPRO\nOriginal body intentionally overwritten attempt.' }, { overwrite:false });

    // Acceptable outcomes: created=true, or skipped=true (or created=false with overwritten=false).
    const created = !!createResp?.created;
    const skipped = (createResp as any)?.skipped === true || (!created && !createResp?.overwritten);

    // Immediate read
    const readResp:any = await client.read(targetId);
    const notFound = readResp && readResp.notFound === true;

    if (notFound) {
      // Gather deep diagnostics: list again, attempt overwrite true, read again.
	const list2 = await client.list();
      const secondPresent = (list2.items || []).some((i:any)=> i.id === targetId);
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.join(instructionsDir, targetId + '.json');
      const fileExists = fs.existsSync(filePath);
      let snippet: string | undefined;
      if(fileExists){ try { snippet = fs.readFileSync(filePath,'utf8').slice(0,200); } catch { /* ignore */ } }
      const overwriteResp = await client.create({ id: targetId, body: '# OVERWRITE ATTEMPT\nFollow-up overwrite to surface visibility repair.' }, { overwrite:true });
      const postOverwriteRead:any = await client.read(targetId);
      // eslint-disable-next-line no-console
      console.error('[duplicate-add-repro][anomaly]', JSON.stringify({
        initialPresent: present,
        createResp,
        skipped,
        created,
        listCount1: list1.items?.length,
        notFoundAfterDuplicate: true,
        listCount2: list2.items?.length,
        secondPresent,
        fileExists,
        snippet,
        overwriteResp,
        postOverwriteRead,
      }, null, 2));
    }

    await client.close();
    expect(notFound, 'Duplicate add followed by get returned notFound (anomaly) - see anomaly diagnostics above').toBe(false);
  }, 20000);
});
