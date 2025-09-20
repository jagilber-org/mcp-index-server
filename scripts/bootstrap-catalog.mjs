#!/usr/bin/env node
// Enrich all instruction JSON files with governance + semanticSummary fields and write a canonical snapshot.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
// Prefer compiled dist services (requires prior build). If dist missing fallback to src transpiled via ts-node register.
let ClassificationService, resolveOwner;
try {
  ({ ClassificationService } = await import('../dist/services/classificationService.js'));
  ({ resolveOwner } = await import('../dist/services/ownershipService.js'));
} catch {
  ({ ClassificationService } = await import('../src/services/classificationService.ts'));
  ({ resolveOwner } = await import('../src/services/ownershipService.ts'));
}

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
  // Skip metadata files that are not instructions
  if(f.startsWith('_') || f.startsWith('bootstrap.')) continue;
  // Skip governance denylist files (same as catalog loader)
  const lowerBase = f.toLowerCase();
  if(/^(000-bootstrapper|001-lifecycle-bootstrap)/.test(lowerBase)) continue;
  const full = path.join(instructionsDir,f);
  try {
    const raw = JSON.parse(fs.readFileSync(full,'utf8'));
    const norm = classifier.normalize(raw);
    if(norm.owner === 'unowned'){
      const auto = resolveOwner(norm.id);
      if(auto){ norm.owner = auto; norm.updatedAt = new Date().toISOString(); }
    }
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
// Also write a dated snapshot (retention: keep last 30, prune older)
try {
  const ts = new Date().toISOString().replace(/[-:]/g,'').replace(/\..+/,'Z');
  const dated = path.join(snapshotDir, `bootstrap-${ts}.json`);
  fs.writeFileSync(dated, JSON.stringify({ generatedAt: new Date().toISOString(), count: enriched.length, items: enriched }, null, 2));
  const all = fs.readdirSync(snapshotDir).filter(f => /^bootstrap-\d{8}T\d{6}Z\.json$/.test(f)).sort().reverse();
  const toPrune = all.slice(30);
  for(const f of toPrune){ try { fs.unlinkSync(path.join(snapshotDir,f)); } catch { /* ignore */ } }
} catch { /* ignore retention errors */ }
console.error(`Enriched ${enriched.length} instructions. Canonical snapshot hash=${hash}`);