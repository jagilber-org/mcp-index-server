/**
 * @file crudPortableBaseline.spec.ts
 * Baseline portable MCP client tests establishing a "golden" reference
 * for MCP protocol behavior (initialize, tool discovery, tool call success & formatting).
 *
 * PURPOSE:
 *   1. Provide a guaranteed-healthy MCP implementation to contrast with
 *      potential CRUD persistence issues in the main index server.
 *   2. Capture deterministic expectations (100% tool success, consistent structure)
 *      that downstream CRUD comparison tests can rely on without re-running
 *      smoke logic each time.
 *   3. Serve as an early-fail sentinel: if THIS baseline ever breaks, all
 *      comparative CRUD diagnostics should be aborted (they would misattribute issues).
 *
 * NEXT STEPS (follow‑on files to be added):
 *   - crudPortableComparison.spec.ts : Compare baseline vs index server list/add behavior
 *   - crudPortablePersistenceGap.spec.ts : Detect silent persistence drops vs reported success
 *   - crudPortableBatchImportGap.spec.ts : Detect partial import mismatch (reported vs actual)
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

interface PortableSmokeJsonSummary {
  toolCount: number;
  tools: string[];
  echo: string; // JSON string
  math: string; // JSON string
  system: string; // JSON string
  ok: boolean;
  [k: string]: unknown;
}

// Reusable helper (kept local to avoid cross‑test coupling for now)
async function runPortable(command: string, timeoutMs = 15000): Promise<{ exitCode: number; stdout: string; stderr: string; summary?: PortableSmokeJsonSummary; }> {
  return new Promise(resolve => {
    const portableDir = path.resolve(process.cwd(), 'portable');
    const [cmd, ...args] = command.split(' ');
    const child = spawn(cmd, args, {
      cwd: portableDir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    let finished = false;
    const done = (code: number|null) => {
      if (finished) return; finished = true;
      // Attempt to extract JSON line for smoke:json runs
      let summary: PortableSmokeJsonSummary|undefined;
      const lines = stdout.split(/\r?\n/).map(l=> l.trim()).filter(Boolean);
      const jsonLine = lines.find(l => l.startsWith('{') && l.includes('toolCount'));
      if (jsonLine) {
        try { summary = JSON.parse(jsonLine) as PortableSmokeJsonSummary; } catch { /* ignore */ }
      }
      resolve({ exitCode: code ?? 0, stdout, stderr, summary });
    };

    child.on('error', () => done(-1));
    child.on('close', code => done(code));

    setTimeout(() => {
      child.kill();
      stderr += '\n[TIMEOUT]';
      done(-1);
    }, timeoutMs).unref();
  });
}

// Provide a cached baseline snapshot (filled by first test) for later suites.
// (If later suites import this file, they could read globalThis.__PORTABLE_BASELINE__.)
// We intentionally keep this internal until comparative suites are added.
declare global {
  // Augment globalThis with our baseline snapshot cache
  // eslint-disable-next-line no-var
  var __PORTABLE_BASELINE__: PortableSmokeJsonSummary | undefined;
}

// NOTE: The smoke summary uses 'system' (not 'system_info') as the JSON key containing the tool response
// even though the tool name returned by listTools() is 'system_info'. We treat this as intentional
// for the portable baseline and map toolNames -> summary field names below.
const SUMMARY_KEY_MAP: Record<string,string> = { echo:'echo', math:'math', system_info:'system' };

describe('Portable MCP Baseline', () => {
  it('runs smoke:json and records golden baseline', async () => {
    const run = await runPortable('npm run smoke:json');
    expect(run.exitCode).toBe(0);
    expect(run.summary, 'Expected JSON summary line in smoke:json output').toBeDefined();
    const s = run.summary!;

    // Golden structural expectations
    expect(s.ok).toBe(true);
    expect(s.toolCount).toBe(3);
    expect(Array.isArray(s.tools)).toBe(true);
    expect(s.tools.sort()).toEqual(['echo','math','system_info'].sort());

    // Parse tool sub-responses (they are JSON strings)
    const echoObj = JSON.parse(s.echo);
    const mathObj = JSON.parse(s.math);
    const systemObj = JSON.parse(s.system);

    expect(echoObj.message).toMatch(/hello portable/i);
    expect(mathObj.result).toBe(7);
    expect(systemObj.platform).toBeDefined();

    // Stash baseline for potential reuse by downstream comparison suites
    global.__PORTABLE_BASELINE__ = s;
  }, 20000);

  it('is stable across multiple executions (2 additional runs)', async () => {
    // We rely on first test having stored baseline
    const baseline = global.__PORTABLE_BASELINE__;
    expect(baseline, 'baseline must be established by first test').toBeDefined();

    const repeatRuns = 2;
    for (let i = 0; i < repeatRuns; i++) {
      const run = await runPortable('npm run smoke:json');
      expect(run.exitCode).toBe(0);
      const s = run.summary!;
      expect(s.ok).toBe(true);
      expect(s.toolCount).toBe(baseline!.toolCount);
      expect(s.tools.sort()).toEqual(baseline!.tools.slice().sort());

      // Ensure result JSON still decodes & core math invariant stable
      const mathObj = JSON.parse(s.math);
      expect(mathObj.result).toBe(7);
    }
  }, 40000);

  it('produces no silent partial failures (heuristic integrity check)', async () => {
    // A silent failure would typically manifest as ok:true but missing one of the expected tool fields
    const run = await runPortable('npm run smoke:json');
    const s = run.summary!;
    const missing: string[] = [];
    for (const tool of ['echo','math','system_info']) {
      const key = SUMMARY_KEY_MAP[tool];
      if (!(key in s)) missing.push(tool);
    }
    expect(missing, 'No tool fields missing under ok:true').toHaveLength(0);
  }, 15000);
});
