import { describe, it, expect } from 'vitest';
import { ClassificationService } from '../services/classificationService';
import { SCHEMA_VERSION } from '../versioning/schemaVersion';

// This test documents (and lightly future-proofs) enrichment expectations for
// enterprise category sets. Currently enrichment is limited to normalization &
// scope extraction; if semantic enrichment (deriving categories from body) is
// introduced later, this file is the natural extension point.

describe('classification enrichment (enterprise categories)', () => {
  it('normalizes mixed-case + duplicate enterprise categories deterministically', () => {
    const cs = new ClassificationService();
    const entry = cs.normalize({
      id:'enrich-demo',
      title:'Demo',
      body:'Body about Service Fabric & Azure Bicep',
      priority:25,
      audience:'all',
      requirement:'optional',
      categories:[
        'Development-Tools',
        'troubleshooting',
        'Troubleshooting',
        'ENTERPRISE-PATTERNS',
        'automation',
        'Monitoring',
        'big-data',
        'AI',
        'ai'
      ],
      // Required InstructionEntry fields that classification service will override / preserve
      sourceHash:'',
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    // Expect lowercase, deduped, sorted
    expect(entry.categories).toEqual([...entry.categories].slice().sort());
    const set = new Set(entry.categories);
    expect(set.size).toBe(entry.categories.length);
    // Future hook: if semantic body-derived enrichment is added, assert presence here.
  });
});
