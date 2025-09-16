import { registerHandler } from '../server/registry';
import { getCatalogDiagnostics } from './catalogContext';

// Read-only diagnostics tool exposing loader acceptance vs rejection reasoning.
// Stable, side-effect free. Optional includeTrace param surfaces a capped trace sample.
registerHandler('instructions/diagnostics', (p: { includeTrace?: boolean } = {}) => {
  try {
    return getCatalogDiagnostics({ includeTrace: !!p.includeTrace });
  } catch (e) {
    return { error: (e as Error)?.message || 'diagnostics-failed' };
  }
});

export {}; // module scope