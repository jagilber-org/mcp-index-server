#!/usr/bin/env node
// Enrich all instruction JSON files with governance + semanticSummary fields and write a canonical snapshot.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ClassificationService } from '../src/services/classificationService.js';

const root = process.cwd();
const instructionsDir = path.join(root,'instructions');
if(!fs.existsSync(instructionsDir)){
  console.error('instructions directory missing:', instructionsDir);
  process.exit(1);
}
const classifier = new ClassificationService();
const files = fs.readdirSync(instructionsDir).filter(f => f.endsWith('.json'));
const enriched = [];
for(const f of files){
  if(f === 'gates.json') continue;
  const full = path.join(instructionsDir,f);
  try {
    const raw = JSON.parse(fs.readFileSync(full,'utf8'));
    const norm = classifier.normalize(raw);
    fs.writeFileSync(full, JSON.stringify(norm,null,2));
    enriched.push(norm);
  } catch(e){
    console.error('failed', f, e.message || e);
  }
}
// Canonical snapshot
const snapshotDir = path.join(root,'snapshots');
if(!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir,{recursive:true});
const canonicalPath = path.join(snapshotDir, 'canonical-instructions.json');
fs.writeFileSync(canonicalPath, JSON.stringify({ generatedAt: new Date().toISOString(), count: enriched.length, items: enriched }, null, 2));
const hash = crypto.createHash('sha256').update(JSON.stringify(enriched.map(e => ({ id:e.id, sourceHash:e.sourceHash }))), 'utf8').digest('hex');
fs.writeFileSync(canonicalPath + '.sha256', hash + '\n');
console.error(`Enriched ${enriched.length} instructions. Canonical snapshot hash=${hash}`);