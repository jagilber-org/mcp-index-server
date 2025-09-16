import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getInstructionsDir } from './catalogContext';
import { logInfo } from './logger';

/**
 * Automatic bootstrap seeding (Option B: create only if missing).
 *
 * Creates the two canonical baseline instruction files when BOTH of these are true:
 *  - MCP_AUTO_SEED !== '0' (default on)
 *  - Target instructions directory is empty OR any of the seed files are missing
 *
 * Never overwrites existing files. Idempotent and safe under concurrent multi-process
 * startup (best‑effort). Creation uses write-to-temp + rename for atomicity to avoid
 * partially written JSON on crashes.
 */

export interface SeedSummary {
  dir: string;
  created: string[];       // file basenames created this invocation
  existing: string[];      // seeds already present
  skipped: string[];       // seeds skipped (already existed)
  disabled: boolean;       // seeding disabled by env
  reason?: string;         // explanatory note
  hash: string;            // hash of canonical content (determinism aid)
}

interface CanonicalSeed { file: string; id: string; json: Record<string, unknown>; }

// Canonical seed instruction objects (kept intentionally minimal – DO NOT add environment specific data)
const CANONICAL_SEEDS: CanonicalSeed[] = [
  {
    file: '000-bootstrapper.json',
    id: '000-bootstrapper',
    json: {
      id: '000-bootstrapper',
      title: 'Bootstrap: Initial Workspace Activation',
      body: 'Purpose: Provide a clean agent the first actionable steps to safely enable catalog mutation. See README bootstrap section for full flow.',
      audience: 'agents',
      requirement: 'required',
      priorityTier: 'p0',
      categories: ['bootstrap','lifecycle'],
      owner: 'system',
      version: 1,
      schemaVersion: '3',
      semanticSummary: 'Bootstrap activation steps with confirmation token gating mutations'
    }
  },
  {
    file: '001-lifecycle-bootstrap.json',
    id: '001-lifecycle-bootstrap',
    json: {
      id: '001-lifecycle-bootstrap',
      title: 'Lifecycle Bootstrap: Local-First Instruction Strategy',
      body: 'Purpose: Early lifecycle guidance after bootstrap confirmation. Keep catalog minimal; prefer local-first P0/P1 additions; promote only after stability.',
      audience: 'agents',
      requirement: 'recommended',
      priorityTier: 'p1',
      categories: ['bootstrap','lifecycle'],
      owner: 'system',
      version: 1,
      schemaVersion: '3',
      semanticSummary: 'Lifecycle and promotion guardrails after bootstrap confirmation',
      reviewIntervalDays: 120
    }
  }
];

function computeCanonicalHash(): string {
  const canonical = CANONICAL_SEEDS.map(s => ({ id: s.id, file: s.file, json: s.json })).sort((a,b)=>a.id.localeCompare(b.id));
  return crypto.createHash('sha256').update(JSON.stringify(canonical),'utf8').digest('hex');
}

export function autoSeedBootstrap(): SeedSummary {
  const disabled = process.env.MCP_AUTO_SEED === '0';
  const dir = safeInstructionsDir();
  const summary: SeedSummary = { dir, created: [], existing: [], skipped: [], disabled, hash: computeCanonicalHash() };
  if(disabled){ summary.reason = 'disabled_by_env'; return summary; }

  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  // Probe directory existence (previously stored entries unused; keep check for side effects)
  try { fs.readdirSync(dir); } catch { /* ignore */ }

  for(const seed of CANONICAL_SEEDS){
    const target = path.join(dir, seed.file);
    const exists = fs.existsSync(target);
    if(exists){
      summary.existing.push(seed.file);
      summary.skipped.push(seed.file);
      continue; // do not overwrite
    }
    // Directory empty OR missing seed triggers creation.
    try {
      const tmp = path.join(dir, `.${seed.file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      fs.writeFileSync(tmp, JSON.stringify(seed.json, null, 2), { encoding: 'utf8' });
      fs.renameSync(tmp, target);
      summary.created.push(seed.file);
    } catch (e){
      summary.reason = `partial_failure ${(e instanceof Error)? e.message: String(e)}`;
    }
  }

  if(process.env.MCP_SEED_VERBOSE === '1'){
    try { process.stderr.write(`[seed] dir="${dir}" created=${summary.created.length} existing=${summary.existing.length} disabled=${summary.disabled} hash=${summary.hash}\n`); } catch { /* ignore */ }
  }
  try { logInfo('seed_summary', summary); } catch { /* ignore */ }
  return summary;
}

function safeInstructionsDir(): string {
  try {
    return getInstructionsDir();
  } catch {
    return path.join(process.cwd(), 'instructions');
  }
}

// Test helper re-export for direct validation
export function _getCanonicalSeeds(){ return CANONICAL_SEEDS.map(s => ({ file: s.file, id: s.id })); }
