// Central schema version constant for instruction JSON files.
// Bump this when making a backward-incompatible on-disk schema change that
// requires a migration rewrite. Migration logic should detect older versions
// and transform + persist them once.
export const SCHEMA_VERSION = '1';

export interface MigrationResult { changed: boolean; notes?: string[] }

// Placeholder future migration hook. Extend with case blocks when SCHEMA_VERSION advances.
export function migrateInstructionRecord(rec: Record<string, unknown>): MigrationResult {
  const notes: string[] = [];
  let changed = false;
  if(rec.schemaVersion !== SCHEMA_VERSION){
    rec.schemaVersion = SCHEMA_VERSION; changed = true; notes.push('schemaVersion updated');
  }
  return { changed, notes: notes.length? notes: undefined };
}
