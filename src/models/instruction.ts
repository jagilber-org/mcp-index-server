export type AudienceScope = 'individual' | 'group' | 'all';
export type RequirementLevel = 'mandatory' | 'critical' | 'recommended' | 'optional' | 'deprecated';
export interface InstructionEntry {
  id: string;
  title: string;
  body: string;
  rationale?: string;
  priority: number; // 1 (highest) .. 100 (lowest)
  audience: AudienceScope;
  requirement: RequirementLevel;
  categories: string[];
  sourceHash: string; // content hash for integrity
  schemaVersion: string;
  deprecatedBy?: string;
  createdAt: string;
  updatedAt: string;
  usageCount?: number;
  lastUsedAt?: string;
  riskScore?: number; // derived metric
}
