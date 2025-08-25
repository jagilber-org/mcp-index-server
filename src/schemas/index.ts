// JSON Schemas for tool response contracts. These are used in tests to lock interfaces.
// Increment version in docs/TOOLS.md when changing any stable schema.

export const instructionEntry = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id','title','body','priority','audience','requirement','categories','sourceHash','schemaVersion','createdAt','updatedAt'
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
    lastUsedAt: { type: 'string' },
    riskScore: { type: 'number' }
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
      { type: 'object', required: ['id','usageCount','lastUsedAt'], additionalProperties: false, properties: {
        id: { type: 'string' }, usageCount: { type: 'number' }, lastUsedAt: { type: 'string' }
      } }
    ]
  },
  'usage/hotset': {
    type: 'object', additionalProperties: false,
    required: ['hash','count','limit','items'],
    properties: {
      hash: { type: 'string' },
      count: { type: 'number' },
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
      } } }
    }
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
};

export type SchemaMap = typeof schemas;
