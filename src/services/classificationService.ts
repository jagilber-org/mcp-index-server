import { InstructionEntry, RequirementLevel } from '../models/instruction';
import crypto from 'crypto';

export interface NormalizedInstruction extends InstructionEntry {}

export class ClassificationService {
  normalize(entry: InstructionEntry): NormalizedInstruction {
    const now = new Date().toISOString();
    // Derive structured scope fields from legacy category prefixes if not already present
    let workspaceId = entry.workspaceId;
    let userId = entry.userId;
  const teamIds = entry.teamIds ? [...entry.teamIds] : [];
    const otherCats: string[] = [];
    for(const cRaw of entry.categories){
      const c = cRaw.toLowerCase();
      if(c.startsWith('scope:workspace:')){ if(!workspaceId) workspaceId = c.substring('scope:workspace:'.length); continue; }
      if(c.startsWith('scope:user:')){ if(!userId) userId = c.substring('scope:user:'.length); continue; }
      if(c.startsWith('scope:team:')){ const tid = c.substring('scope:team:'.length); if(tid && !teamIds.includes(tid)) teamIds.push(tid); continue; }
      otherCats.push(cRaw);
    }
    // Governance defaults
    const version = entry.version || '1.0.0';
    const status = entry.status || (entry.requirement === 'deprecated' ? 'deprecated' : 'approved');
    const owner = entry.owner || 'unowned';
    const priorityTier = this.computePriorityTier(entry.priority, entry.requirement);
    const classification = entry.classification || 'internal';
    const lastReviewedAt = entry.lastReviewedAt || now;
    const reviewIntervalDays = this.reviewIntervalDays(priorityTier, entry.requirement);
    const nextReviewDue = entry.nextReviewDue || new Date(Date.now() + reviewIntervalDays*86400_000).toISOString();
    const changeLog = entry.changeLog && entry.changeLog.length ? entry.changeLog : [{ version, changedAt: entry.createdAt || now, summary: 'initial import' }];
    const norm: NormalizedInstruction = {
      ...entry,
      title: entry.title.trim(),
      body: entry.body.trim(),
      categories: Array.from(new Set(otherCats.map(c => c.toLowerCase()))).sort(),
      updatedAt: entry.updatedAt || now,
      createdAt: entry.createdAt || now,
      sourceHash: this.computeHash(entry.body),
      riskScore: this.computeRisk(entry),
      workspaceId,
      userId,
      teamIds: teamIds.length ? teamIds : undefined,
      version,
      status,
      owner,
      priorityTier,
      classification,
      lastReviewedAt,
      nextReviewDue,
      changeLog: changeLog,
      supersedes: entry.supersedes
    };
    return norm;
  }

  validate(entry: InstructionEntry): string[] {
    const issues: string[] = [];
    if(!entry.id) issues.push('missing id');
    if(!entry.title) issues.push('missing title');
    if(!entry.body) issues.push('missing body');
    if(entry.requirement === 'deprecated' && !entry.deprecatedBy) issues.push('deprecated requires deprecatedBy');
    return issues;
  }

  computeRisk(entry: InstructionEntry): number {
    const base = 100 - Math.min(Math.max(entry.priority,1),100);
    const reqWeight = this.requirementWeight(entry.requirement);
    return base + reqWeight;
  }

  private requirementWeight(r: RequirementLevel): number {
    switch(r){
      case 'mandatory': return 50;
      case 'critical': return 60;
      case 'recommended': return 20;
      case 'optional': return 5;
      case 'deprecated': return -30;
      default: return 0;
    }
  }

  computeHash(content: string): string { return crypto.createHash('sha256').update(content,'utf8').digest('hex'); }

  private computePriorityTier(priority: number, requirement: RequirementLevel): 'P1'|'P2'|'P3'|'P4' {
    // Lower numeric is higher importance
    if(priority <= 20 || requirement === 'mandatory' || requirement === 'critical') return 'P1';
    if(priority <= 40) return 'P2';
    if(priority <= 70) return 'P3';
    return 'P4';
  }

  private reviewIntervalDays(tier: 'P1'|'P2'|'P3'|'P4', requirement: RequirementLevel): number {
    // Shorter intervals for higher criticality
    if(tier === 'P1' || requirement === 'mandatory' || requirement === 'critical') return 30;
    if(tier === 'P2') return 60;
    if(tier === 'P3') return 90;
    return 120;
  }
}
