#!/usr/bin/env node
/**
 * Guard script: enforces single portable client declaration policy.
 * Fails (exit 1) if unexpected portable client *.d.ts files reappear.
 */
import { readdirSync } from 'fs';
import { join } from 'path';

const typesDir = join(process.cwd(), 'src', 'types');
let ok = true;
const allowList = new Set(['portableClient.consolidated.d.ts','sdk-shim.d.ts']);

try {
  const entries = readdirSync(typesDir).filter(f=>f.endsWith('.d.ts'));
  const offenders = entries.filter(f=>!allowList.has(f));
  if(offenders.length){
    console.error('[guard-declarations] Unexpected declaration files found:', offenders.join(', '));
    ok = false;
  } else {
    console.log('[guard-declarations] OK: only consolidated declarations present');
  }
} catch (e){
  console.error('[guard-declarations] Error reading types directory', e);
  ok = false;
}

process.exit(ok ? 0 : 1);
