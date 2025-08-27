// Central schema version constant for instruction JSON files.
// Bump this when making a backward-incompatible on-disk schema change that
// requires a migration rewrite. Migration logic should detect older versions
// and transform + persist them once.
export const SCHEMA_VERSION = '2';

import { RequirementLevel } from '../models/instruction';

export interface MigrationResult { changed: boolean; notes?: string[] }

// Helper function for review interval computation (matches ClassificationService logic)
function computeReviewIntervalDays(tier: 'P1'|'P2'|'P3'|'P4', requirement: RequirementLevel): number {
  // Shorter intervals for higher criticality
  if(tier === 'P1' || requirement === 'mandatory' || requirement === 'critical') return 30;
  if(tier === 'P2') return 60;
  if(tier === 'P3') return 90;
  return 120;
}

// Migration hook for schema version upgrades
export function migrateInstructionRecord(rec: Record<string, unknown>): MigrationResult {
  const notes: string[] = [];
  let changed = false;
  
  const prevVersion = rec.schemaVersion || '1';
  
  // v1 → v2 migration: Add reviewIntervalDays if missing
  if (prevVersion === '1' && !rec.reviewIntervalDays) {
    const tier = (rec.priorityTier as 'P1'|'P2'|'P3'|'P4') || 'P4';
    const requirement = (rec.requirement as RequirementLevel) || 'optional';
    rec.reviewIntervalDays = computeReviewIntervalDays(tier, requirement);
    changed = true;
    notes.push('added reviewIntervalDays from tier+requirement');
  }
  
  // Update schema version if changed
  if(rec.schemaVersion !== SCHEMA_VERSION){
    rec.schemaVersion = SCHEMA_VERSION; 
    changed = true; 
    notes.push(`schemaVersion updated ${prevVersion}→${SCHEMA_VERSION}`);
  }
  
  return { changed, notes: notes.length? notes: undefined };
}
