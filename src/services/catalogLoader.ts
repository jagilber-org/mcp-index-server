import { InstructionEntry } from '../models/instruction';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ClassificationService } from './classificationService';

export interface CatalogLoadResult {
  entries: InstructionEntry[];
  errors: { file: string; error: string }[];
  hash: string; // combined catalog hash
}

export class CatalogLoader {
  constructor(private readonly baseDir: string, private readonly classifier = new ClassificationService()){}

  load(): CatalogLoadResult {
    const dir = path.resolve(this.baseDir);
    if(!fs.existsSync(dir)) return { entries: [], errors: [{ file: dir, error: 'missing directory'}], hash: '' };
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const entries: InstructionEntry[] = [];
    const errors: { file: string; error: string }[] = [];
    for(const f of files){
      const full = path.join(dir, f);
      try {
        const raw = JSON.parse(fs.readFileSync(full,'utf8')) as InstructionEntry;
        const issues = this.classifier.validate(raw);
        if(issues.length){
          errors.push({ file: f, error: issues.join(', ') });
          continue;
        }
        entries.push(this.classifier.normalize(raw));
      } catch(e: unknown){
        errors.push({ file: f, error: e instanceof Error ? e.message : 'unknown error' });
      }
    }
    const hash = this.computeCatalogHash(entries);
    return { entries, errors, hash };
  }

  private computeCatalogHash(entries: InstructionEntry[]): string {
    const h = crypto.createHash('sha256');
    const stable = entries
      .slice()
      .sort((a,b)=> a.id.localeCompare(b.id))
      .map(e => `${e.id}:${e.sourceHash}`)
      .join('|');
    h.update(stable,'utf8');
    return h.digest('hex');
  }
}