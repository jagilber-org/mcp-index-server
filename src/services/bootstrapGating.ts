import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getInstructionsDir, ensureLoaded } from './catalogContext';
import { getRuntimeConfig } from '../config/runtimeConfig';

/**
 * Bootstrap / confirmation gating logic.
 * States:
 *  - reference mode (MCP_REFERENCE_MODE=1): catalog is read-only, all mutation blocked permanently
 *  - new workspace: only bootstrap seed instructions present (000-bootstrapper / 001-lifecycle-bootstrap) → require confirmation
 *  - existing workspace: any non-bootstrap instruction present OR confirmation file exists → mutation allowed (subject to MCP_ENABLE_MUTATION rules)
 *  - confirmed: confirmation file created after successful finalize → persists across restarts
 */

const BOOTSTRAP_IDS = new Set(['000-bootstrapper','001-lifecycle-bootstrap']);
const CONFIRM_FILE = 'bootstrap.confirmed.json';
const PENDING_FILE = 'bootstrap.pending.json';

interface PendingRecord { hash: string; expiresAt: number; issuedAt: number; hint: string }
interface ConfirmRecord { confirmedAt: string; tokenHint: string }

let inMemoryPending: PendingRecord | null = null;
let confirmed = false;
let loaded = false;

function bootstrapConfig(){
  return getRuntimeConfig().server.bootstrap;
}

function instructionsDirSafe(){
  try { return getInstructionsDir(); } catch { return process.cwd(); }
}

function loadState(){
  if(loaded) return;
  loaded = true;
  if(isReferenceMode()) return; // nothing to load
  try {
    const dir = instructionsDirSafe();
    const file = path.join(dir, CONFIRM_FILE);
    if(fs.existsSync(file)){
      confirmed = true; // minimal persistence flag
    }
  } catch { /* ignore */ }
}

export function isReferenceMode(){ return bootstrapConfig().referenceMode; }

export function isBootstrapConfirmed(){ loadState(); return confirmed; }

export function hasNonBootstrapInstructions(){
  try {
    const st = ensureLoaded();
    for(const e of st.list){ if(!BOOTSTRAP_IDS.has(e.id)) return true; }
    return false;
  } catch { return false; }
}

export function shouldRequireConfirmation(){
  if(isReferenceMode()) return false; // immutable anyway
  if(isBootstrapConfirmed()) return false;
  if(hasNonBootstrapInstructions()) return false; // existing workspace
  return true; // only seeds present
}

export function mutationGatedReason(): string | null {
  if(isReferenceMode()) return 'reference_mode_read_only';
  if(shouldRequireConfirmation()) return 'bootstrap_confirmation_required';
  return null;
}

export function requestBootstrapToken(rationale?: string){
  if(isReferenceMode()) return { referenceMode:true, mutation:false } as const;
  if(isBootstrapConfirmed()) return { alreadyConfirmed:true } as const;
  // issue or reuse pending if still valid
  const now = Date.now();
  if(inMemoryPending && inMemoryPending.expiresAt > now){
    return { token: '(reissued)', hint: inMemoryPending.hint, expiresAt: inMemoryPending.expiresAt, pending:true } as const;
  }
  const raw = crypto.randomBytes(6).toString('hex');
  const hash = crypto.createHash('sha256').update(raw,'utf8').digest('hex');
  const expiresSec = Math.max(1, bootstrapConfig().tokenTtlSec);
  const rec: PendingRecord = { hash, expiresAt: now + (expiresSec*1000), issuedAt: now, hint: rationale || 'Human operator: review context, then provide token to bootstrap/confirmFinalize.' };
  inMemoryPending = rec;
  // Persist (best-effort): do not write the raw token, only its hash
  try {
    const dir = instructionsDirSafe();
    fs.writeFileSync(path.join(dir, PENDING_FILE), JSON.stringify({ issuedAt: rec.issuedAt, expiresAt: rec.expiresAt }, null, 2));
  } catch { /* ignore */ }
  return { token: raw, expiresAt: rec.expiresAt, hint: rec.hint } as const;
}

export function finalizeBootstrapToken(token: string){
  if(isReferenceMode()) return { referenceMode:true, mutation:false } as const;
  if(isBootstrapConfirmed()) return { alreadyConfirmed:true } as const;
  if(!inMemoryPending) return { error:'no_pending_token' } as const;
  const now = Date.now();
  if(inMemoryPending.expiresAt <= now){ inMemoryPending = null; return { error:'token_expired' } as const; }
  const hash = crypto.createHash('sha256').update(token,'utf8').digest('hex');
  if(hash !== inMemoryPending.hash) return { error:'invalid_token' } as const;
  confirmed = true;
  try {
    const dir = instructionsDirSafe();
    const rec: ConfirmRecord = { confirmedAt: new Date().toISOString(), tokenHint: inMemoryPending.hint };
    fs.writeFileSync(path.join(dir, CONFIRM_FILE), JSON.stringify(rec, null, 2));
  } catch { /* ignore */ }
  inMemoryPending = null;
  return { confirmed:true } as const;
}

export function getBootstrapStatus(){
  return {
    referenceMode: isReferenceMode(),
    confirmed: isBootstrapConfirmed(),
    requireConfirmation: shouldRequireConfirmation(),
    nonBootstrapInstructions: hasNonBootstrapInstructions()
  };
}

export const BOOTSTRAP_ALLOWLIST = BOOTSTRAP_IDS; // re-export for risk computation allowlist

// ----------------------------------------------------------------------------------
// Test Support: Optional force-confirm path (never used in production flows)
// ----------------------------------------------------------------------------------
// Some integration tests pre-date bootstrap confirmation and expect immediate
// mutation capability. To avoid invasive edits across dozens of tests we expose
// a narrow helper that marks the workspace as confirmed when an opt‑in
// environment variable (MCP_BOOTSTRAP_AUTOCONFIRM=1) is set. This writes the
// same confirmation artifact the manual token flow would create so subsequent
// real runs still observe the confirmed state. Reference mode intentionally
// bypasses any force confirmation.
//
// IMPORTANT: This function is intentionally not exported via tool surfaces and
// should only be invoked programmatically by the server on startup when the
// explicit test environment variable is present. It is safe because it requires
// direct code execution (cannot be triggered by an MCP client) and mirrors the
// final persisted shape of a legitimate confirmation.
export function forceBootstrapConfirmForTests(reason = 'auto-confirm (test)'){
  if(isReferenceMode()) return false;
  if(confirmed) return true;
  try {
    const dir = instructionsDirSafe();
    const rec: ConfirmRecord = { confirmedAt: new Date().toISOString(), tokenHint: reason };
    fs.writeFileSync(path.join(dir, CONFIRM_FILE), JSON.stringify(rec, null, 2));
    confirmed = true;
    return true;
  } catch { /* ignore */ }
  return false;
}
