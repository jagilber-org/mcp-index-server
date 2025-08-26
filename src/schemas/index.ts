// JSON Schemas for tool response contracts. These are used in tests to lock interfaces.
// Increment version in docs/TOOLS.md when changing any stable schema.

export const instructionEntry = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id','title','body','priority','audience','requirement','categories','sourceHash','schemaVersion','createdAt','updatedAt',
    'version','status','owner','priorityTier','classification','lastReviewedAt','nextReviewDue','changeLog','semanticSummary'
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    title: { type: 'string' },
    body: { type: 'string' },
    rationale: { type: 'string' },
    priority: { type: 'number' },
    audience: { enum: ['individual','group','all'] },
    requirement: { enum: ['mandatory','critical','recommended','optional','deprecated'] },
    categories: { type: 'array', items: { type: 'string' } },
    sourceHash: { type: 'string' },
    schemaVersion: { type: 'string' },
    deprecatedBy: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  usageCount: { type: 'number' },
  firstSeenTs: { type: 'string' },
    lastUsedAt: { type: 'string' },
    riskScore: { type: 'number' }
  ,workspaceId: { type: 'string' }
  ,userId: { type: 'string' }
  ,teamIds: { type: 'array', items: { type: 'string' } }
  ,version: { type: 'string' }
  ,status: { enum: ['draft','review','approved','deprecated'] }
  ,owner: { type: 'string' }
  ,priorityTier: { enum: ['P1','P2','P3','P4'] }
  ,classification: { enum: ['public','internal','restricted'] }
  ,lastReviewedAt: { type: 'string' }
  ,nextReviewDue: { type: 'string' }
  ,changeLog: { type: 'array', items: { type: 'object', required: ['version','changedAt','summary'], additionalProperties: false, properties: { version: { type: 'string' }, changedAt: { type: 'string' }, summary: { type: 'string' } } } }
  ,supersedes: { type: 'string' }
  ,semanticSummary: { type: 'string' }
  ,createdByAgent: { type: 'string' }
  ,sourceWorkspace: { type: 'string' }
  }
} as const;

const listLike = {
  type: 'object',
  additionalProperties: false,
  required: ['hash','count','items'],
  properties: {
    hash: { type: 'string' },
    count: { type: 'number', minimum: 0 },
    items: { type: 'array', items: instructionEntry }
  }
} as const;

// Using unknown for schema values to avoid any and preserve flexibility
export const schemas: Record<string, unknown> = {
  'health/check': {
    type: 'object', additionalProperties: false,
    required: ['status','timestamp','version'],
    properties: {
      status: { const: 'ok' },
      timestamp: { type: 'string' },
      version: { type: 'string' }
    }
  },
  'instructions/list': listLike,
  'instructions/listScoped': {
    type: 'object', additionalProperties: false,
    required: ['hash','count','items','scope'],
    properties: {
      hash: { type: 'string' },
      count: { type: 'number', minimum: 0 },
      scope: { enum: ['user','workspace','team','all'] },
      items: { type: 'array', items: instructionEntry }
    }
  },
  'instructions/search': listLike,
  'instructions/get': {
    anyOf: [
      { type: 'object', additionalProperties: false, required: ['notFound'], properties: { notFound: { const: true } } },
      { type: 'object', additionalProperties: false, required: ['hash','item'], properties: { hash: { type: 'string' }, item: instructionEntry } }
    ]
  },
  'instructions/diff': {
    oneOf: [
      { type: 'object', required: ['upToDate','hash'], additionalProperties: false, properties: { upToDate: { const: true }, hash: { type: 'string' } } },
      { type: 'object', required: ['hash','added','updated','removed'], additionalProperties: false, properties: {
        hash: { type: 'string' },
        added: { type: 'array', items: instructionEntry },
        updated: { type: 'array', items: instructionEntry },
        removed: { type: 'array', items: { type: 'string' } }
      } },
      { type: 'object', required: ['hash','changed'], additionalProperties: false, properties: {
        hash: { type: 'string' },
        changed: { type: 'array', items: instructionEntry }
      } }
    ]
  },
  'instructions/export': listLike,
  'instructions/import': {
    anyOf: [
      { type: 'object', required: ['error'], properties: { error: { type: 'string' } }, additionalProperties: true },
      { type: 'object', required: ['hash','imported','skipped','overwritten','errors','total'], additionalProperties: false, properties: {
        hash: { type: 'string' }, imported: { type: 'number' }, skipped: { type: 'number' }, overwritten: { type: 'number' }, total: { type: 'number' }, errors: { type: 'array', items: { type: 'object', required: ['id','error'], properties: { id: { type: 'string' }, error: { type: 'string' } }, additionalProperties: false } }
      } }
    ]
  },
  'instructions/repair': { type: 'object', required: ['repaired','updated'], additionalProperties: false, properties: { repaired: { type: 'number' }, updated: { type: 'array', items: { type: 'string' } } } },
  'prompt/review': {
    anyOf: [
      { type: 'object', required: ['truncated','message','max'], additionalProperties: false, properties: {
        truncated: { const: true },
        message: { type: 'string' },
        max: { type: 'number' }
      } },
      { type: 'object', required: ['issues','summary','length'], additionalProperties: false, properties: {
        issues: { type: 'array', items: { type: 'object' } },
        summary: { type: 'object' },
        length: { type: 'number' }
      } }
    ]
  },
  'integrity/verify': {
    type: 'object', additionalProperties: false,
    required: ['hash','count','issues','issueCount'],
    properties: {
      hash: { type: 'string' },
      count: { type: 'number' },
      issues: { type: 'array', items: { type: 'object', required: ['id','expected','actual'], properties: { id: { type: 'string' }, expected: { type: 'string' }, actual: { type: 'string' } }, additionalProperties: false } },
      issueCount: { type: 'number' }
    }
  },
  'usage/track': {
    anyOf: [
      { type: 'object', required: ['error'], properties: { error: { type: 'string' } }, additionalProperties: true },
      { type: 'object', required: ['notFound'], properties: { notFound: { const: true } }, additionalProperties: true },
  { type: 'object', required: ['featureDisabled'], properties: { featureDisabled: { const: true } }, additionalProperties: true },
      { type: 'object', required: ['id','usageCount','lastUsedAt'], additionalProperties: false, properties: {
        id: { type: 'string' }, usageCount: { type: 'number' }, firstSeenTs: { type: 'string' }, lastUsedAt: { type: 'string' }
      } }
    ]
  },
  'usage/hotset': {
    type: 'object', additionalProperties: false,
    required: ['hash','count','limit','items'],
    properties: {
      hash: { type: 'string' },
      count: { type: 'number' },
    'feature/status': {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
      limit: { type: 'number' },
      items: { type: 'array', items: { type: 'object', required: ['id','usageCount'], additionalProperties: false, properties: {
        id: { type: 'string' }, usageCount: { type: 'number' }, lastUsedAt: { type: 'string' }
      } } }
    }
  },
  'metrics/snapshot': {
    type: 'object', additionalProperties: false,
    required: ['generatedAt','methods'],
    properties: {
      generatedAt: { type: 'string' },
      methods: { type: 'array', items: { type: 'object', required: ['method','count','avgMs','maxMs'], additionalProperties: false, properties: {
        method: { type: 'string' }, count: { type: 'number' }, avgMs: { type: 'number' }, maxMs: { type: 'number' }
      } } },
      features: { type: 'object', additionalProperties: true }
    }
  },
  'instructions/governanceHash': {
    type: 'object', additionalProperties: false,
    required: ['count','governanceHash','items'],
    properties: {
      count: { type: 'number' },
      governanceHash: { type: 'string' },
      items: { type: 'array', items: { type: 'object', required: ['id','title','version','owner','priorityTier','nextReviewDue','semanticSummarySha256','changeLogLength'], additionalProperties: false, properties: {
        id: { type: 'string' }, title: { type: 'string' }, version: { type: 'string' }, owner: { type: 'string' }, priorityTier: { type: 'string' }, nextReviewDue: { type: 'string' }, semanticSummarySha256: { type: 'string' }, changeLogLength: { type: 'number' }
      } } }
    }
  },
  'instructions/health': {
    anyOf: [
      { type: 'object', required: ['snapshot','hash','count'], additionalProperties: true, properties: { snapshot: { const: 'missing' }, hash: { type: 'string' }, count: { type: 'number' } } },
      { type: 'object', required: ['snapshot','hash','count','missing','changed','extra','drift'], additionalProperties: true, properties: {
        snapshot: { const: 'present' }, hash: { type: 'string' }, count: { type: 'number' },
        missing: { type: 'array', items: { type: 'string' } },
        changed: { type: 'array', items: { type: 'string' } },
        extra: { type: 'array', items: { type: 'string' } },
        drift: { type: 'number' }
      } },
      { type: 'object', required: ['snapshot','hash','error'], additionalProperties: true, properties: { snapshot: { const: 'error' }, hash: { type: 'string' }, error: { type: 'string' } } }
    ]
  },
  'gates/evaluate': {
    anyOf: [
      { type: 'object', required: ['notConfigured'], properties: { notConfigured: { const: true } }, additionalProperties: true },
      { type: 'object', required: ['error'], properties: { error: { type: 'string' } }, additionalProperties: true },
      { type: 'object', required: ['generatedAt','results','summary'], additionalProperties: false, properties: {
        generatedAt: { type: 'string' },
        results: { type: 'array', items: { type: 'object', required: ['id','passed','count','op','value','severity'], additionalProperties: true, properties: {
          id: { type: 'string' }, passed: { type: 'boolean' }, count: { type: 'number' }, op: { type: 'string' }, value: { type: 'number' }, severity: { type: 'string' }, description: { type: 'string' }
        } } },
        summary: { type: 'object', required: ['errors','warnings','total'], properties: { errors: { type: 'number' }, warnings: { type: 'number' }, total: { type: 'number' } }, additionalProperties: false }
      } }
    ]
  }
  ,
  'meta/tools': {
    type: 'object', additionalProperties: true,
    required: ['stable','dynamic','tools'],
    properties: {
      // Legacy flat list (includes disabled flag)
      tools: { type: 'array', items: { type: 'object', required: ['method'], additionalProperties: true, properties: {
        method: { type: 'string' }, stable: { type: 'boolean' }, mutation: { type: 'boolean' }, disabled: { type: 'boolean' }
      } } },
      stable: {
        type: 'object', additionalProperties: false,
        required: ['tools'],
        properties: {
          tools: { type: 'array', items: { type: 'object', required: ['method','stable','mutation'], additionalProperties: true, properties: {
            method: { type: 'string' },
            stable: { type: 'boolean' },
            mutation: { type: 'boolean' }
          } } }
        }
      },
      dynamic: {
        type: 'object', additionalProperties: true,
        required: ['generatedAt','mutationEnabled','disabled'],
        properties: {
          generatedAt: { type: 'string' },
          mutationEnabled: { type: 'boolean' },
          disabled: { type: 'array', items: { type: 'object', required: ['method'], additionalProperties: false, properties: { method: { type: 'string' } } } }
        }
      },
      // New MCP style registry (optional for now)
      mcp: {
        type: 'object', additionalProperties: true,
        required: ['registryVersion','tools'],
        properties: {
          registryVersion: { type: 'string' },
          tools: { type: 'array', items: { type: 'object', required: ['name','description','stable','mutation','inputSchema'], additionalProperties: false, properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            stable: { type: 'boolean' },
            mutation: { type: 'boolean' },
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' }
          } } }
        }
      }
    }
  },
  'usage/flush': { type: 'object', required: ['flushed'], additionalProperties: false, properties: { flushed: { const: true } } },
  'instructions/reload': { type: 'object', required: ['reloaded','hash','count'], additionalProperties: false, properties: { reloaded: { const: true }, hash: { type: 'string' }, count: { type: 'number' } } },
  'instructions/remove': { type: 'object', required: ['removed','removedIds','missing','errorCount','errors'], additionalProperties: false, properties: {
    removed: { type: 'number' },
    removedIds: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
    errorCount: { type: 'number' },
    errors: { type: 'array', items: { type: 'object', required: ['id','error'], additionalProperties: false, properties: { id: { type: 'string' }, error: { type: 'string' } } } }
  } },
  'instructions/enrich': { type: 'object', required: ['rewritten','updated','skipped'], additionalProperties: false, properties: {
    rewritten: { type: 'number' },
    updated: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } }
  } },
  'instructions/add': {
    anyOf: [
      { type: 'object', required: ['error'], properties: { error: { type: 'string' }, id: { type: 'string' } }, additionalProperties: true },
      { type: 'object', required: ['id','hash','skipped','created','overwritten'], additionalProperties: false, properties: {
        id: { type: 'string' }, hash: { type: 'string' }, skipped: { type: 'boolean' }, created: { type: 'boolean' }, overwritten: { type: 'boolean' }
      } }
    ]
  },
  'instructions/groom': {
    type: 'object', additionalProperties: false,
    required: ['previousHash','hash','scanned','repairedHashes','normalizedCategories','deprecatedRemoved','duplicatesMerged','usagePruned','filesRewritten','purgedScopes','dryRun','notes'],
    properties: {
      previousHash: { type: 'string' },
      hash: { type: 'string' },
      scanned: { type: 'number' },
      repairedHashes: { type: 'number' },
      normalizedCategories: { type: 'number' },
      deprecatedRemoved: { type: 'number' },
      duplicatesMerged: { type: 'number' },
      usagePruned: { type: 'number' },
      filesRewritten: { type: 'number' },
      purgedScopes: { type: 'number' },
      dryRun: { type: 'boolean' },
      notes: { type: 'array', items: { type: 'string' } }
    }
  }
};

export type SchemaMap = typeof schemas;
