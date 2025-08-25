import fs from 'fs';
import path from 'path';

export interface PromptRule {
  id: string; pattern?: string; mustContain?: string; severity: string; description: string;
}
export interface PromptCategory { id: string; rules: PromptRule[] }
export interface PromptCriteria { version: string; categories: PromptCategory[] }
export interface PromptIssue { ruleId: string; severity: string; description: string; match?: string }

export class PromptReviewService {
  private criteria: PromptCriteria;
  constructor(criteriaPath = path.join(process.cwd(),'docs','PROMPT-CRITERIA.json')){
    this.criteria = JSON.parse(fs.readFileSync(criteriaPath,'utf8')) as PromptCriteria;
  }
  review(prompt: string): PromptIssue[] {
    const issues: PromptIssue[] = [];
    for(const cat of this.criteria.categories){
      for(const rule of cat.rules){
        if(rule.pattern){
          // Apply global + case-insensitive flags for broader detection
          const regex = new RegExp(rule.pattern,'gi');
            const m = prompt.match(regex);
            if(m){
              issues.push({ ruleId: rule.id, severity: rule.severity, description: rule.description, match: m[0] });
            }
        }
        if(rule.mustContain){
          const mc = new RegExp(rule.mustContain,'i');
          if(!mc.test(prompt)){
            issues.push({ ruleId: rule.id, severity: rule.severity, description: 'Missing required token(s): ' + rule.description });
          }
        }
      }
    }
    return issues;
  }
}

export function summarizeIssues(issues: PromptIssue[]): { counts: Record<string, number>; highestSeverity: string } {
  const counts: Record<string, number> = {};
  const severityRank: Record<string, number> = { critical:4, high:3, medium:2, low:1, info:0 };
  let max = -1; let highest = 'info';
  for(const i of issues){
    counts[i.severity] = (counts[i.severity]||0)+1;
    const r = severityRank[i.severity] ?? 0;
    if(r>max){ max = r; highest = i.severity; }
  }
  return { counts, highestSeverity: highest };
}