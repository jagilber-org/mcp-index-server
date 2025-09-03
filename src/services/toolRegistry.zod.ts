import { z } from 'zod';
import { getToolRegistry, ToolRegistryEntry } from './toolRegistry';

/**
 * Progressive Zod schema mapping.
 * We attach Zod validators for a subset of tools (core plus feedback) to enable
 * richer type inference & early migration away from Ajv for internal validation.
 * JSON Schemas in the base registry remain the external contract.
 */

// Core simple schemas
const zEmpty = z.object({}).strict().partial(); // accepts empty object / no required props
const zStringId = z.object({ id: z.string().min(1) }).strict();

// Dispatcher (requires action string)
const zDispatch = z.object({ action: z.string().min(1) }).passthrough();

// Governance update (subset reflecting allowed patch fields)
const zGovernanceUpdate = z.object({
  id: z.string().min(1),
  owner: z.string().min(1).optional(),
  status: z.enum(['approved','draft','deprecated']).optional(),
  lastReviewedAt: z.string().optional(),
  nextReviewDue: z.string().optional(),
  bump: z.enum(['patch','minor','major','none']).optional()
}).strict();

// Instructions add
const zInstructionEntry = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  body: z.string().min(1),
  rationale: z.string().optional(),
  priority: z.number().int().min(1).max(100).optional(),
  audience: z.string().optional(),
  requirement: z.string().optional(),
  categories: z.array(z.string()).max(50).optional(),
  deprecatedBy: z.string().optional(),
  riskScore: z.number().optional()
}).strict();

const zAdd = z.object({
  entry: zInstructionEntry,
  overwrite: z.boolean().optional(),
  lax: z.boolean().optional()
}).strict();

// Feedback submit
const zFeedbackSubmit = z.object({
  type: z.enum(['issue', 'status', 'security', 'feature-request', 'bug-report', 'performance', 'usability', 'other']),
  severity: z.enum(['low','medium','high','critical']),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  context: z.object({}).passthrough().optional(),
  metadata: z.object({}).passthrough().optional(),
  tags: z.array(z.string()).max(10).optional()
}).strict();

const zFeedbackList = z.object({
  type: z.enum(['issue', 'status', 'security', 'feature-request', 'bug-report', 'performance', 'usability', 'other']).optional(),
  severity: z.enum(['low','medium','high','critical']).optional(),
  status: z.enum(['new', 'acknowledged', 'in-progress', 'resolved', 'closed']).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
  since: z.string().optional(),
  tags: z.array(z.string()).optional()
}).strict();

const zFeedbackGet = zStringId;
const zFeedbackUpdate = z.object({
  id: z.string().min(1),
  status: z.enum(['new', 'acknowledged', 'in-progress', 'resolved', 'closed']).optional(),
  metadata: z.object({}).passthrough().optional()
}).strict();

// Usage
const zUsageTrack = zStringId;
const zHotset = z.object({ limit: z.number().int().min(1).max(100).optional() }).strict();

// Map tool name to zod schema
const zodMap: Record<string, z.ZodTypeAny> = {
  'health/check': zEmpty,
  'instructions/dispatch': zDispatch,
  'instructions/governanceHash': zEmpty,
  'instructions/governanceUpdate': zGovernanceUpdate,
  'instructions/add': zAdd,
  'usage/track': zUsageTrack,
  'usage/hotset': zHotset,
  'feedback/submit': zFeedbackSubmit,
  'feedback/list': zFeedbackList,
  'feedback/get': zFeedbackGet,
  'feedback/update': zFeedbackUpdate,
  'feedback/stats': z.object({ since: z.string().optional() }).strict(),
  'feedback/health': zEmpty,
};

export function getZodEnhancedRegistry(): ToolRegistryEntry[] {
  const base = getToolRegistry();
  for(const e of base){
    const zSchema = zodMap[e.name];
    if(zSchema){
      e.zodSchema = zSchema; // mutate in place (acceptable for current server lifecycle)
    }
  }
  return base;
}

export type ExtractParams<T extends string> = T extends keyof typeof zodMap ? z.infer<(typeof zodMap)[T]> : unknown;
