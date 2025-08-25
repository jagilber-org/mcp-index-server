import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { InstructionEntry } from '../models/instruction';
import { atomicWriteJson } from './atomicFs';

export interface CatalogSnapshot { entries: InstructionEntry[]; hash: string; }

export class FileCatalogRepository {
  constructor(private baseDir: string) {}
  listFiles(){
    try { return fs.readdirSync(this.baseDir).filter(f=> f.endsWith('.json')); } catch { return []; }
  }
  load(): CatalogSnapshot {
    const files = this.listFiles();
    const entries: InstructionEntry[] = [];
    const hash = crypto.createHash('sha256');
    for(const f of files){
      const fp = path.join(this.baseDir, f);
      try {
        const raw = JSON.parse(fs.readFileSync(fp,'utf8')) as InstructionEntry;
        entries.push(raw);
        hash.update(raw.id+':'+(raw.sourceHash||''),'utf8');
      } catch {/* skip */}
    }
    return { entries, hash: hash.digest('hex') };
  }
  save(entry: InstructionEntry){
    const fp = path.join(this.baseDir, `${entry.id}.json`);
    atomicWriteJson(fp, entry);
  }
  remove(id:string){
    const fp = path.join(this.baseDir, `${id}.json`);
    try { if(fs.existsSync(fp)) fs.unlinkSync(fp); } catch {/* ignore */}
  }
}
