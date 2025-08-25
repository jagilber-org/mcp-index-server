import { InstructionEntry, RequirementLevel } from '../models/instruction';
import crypto from 'crypto';

export interface NormalizedInstruction extends InstructionEntry {}

export class ClassificationService {
  normalize(entry: InstructionEntry): NormalizedInstruction {
    const now = new Date().toISOString();
    const norm: NormalizedInstruction = {
      ...entry,
      title: entry.title.trim(),
      body: entry.body.trim(),
      categories: Array.from(new Set(entry.categories.map(c => c.toLowerCase()))).sort(),
      updatedAt: entry.updatedAt || now,
      createdAt: entry.createdAt || now,
      sourceHash: this.computeHash(entry.body),
      riskScore: this.computeRisk(entry)
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
}
