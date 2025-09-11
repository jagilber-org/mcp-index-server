import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { callTool } from './testUtils';

function writeInstruction(id:string, body:string, categories:string[], primary?:string){
  const dir = process.env.INSTRUCTIONS_DIR || path.join(process.cwd(),'instructions');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const now = new Date().toISOString();
  const rec = { id, title:id, body, rationale:'', priority:50, audience:'all', requirement:'optional', categories: categories.map(c=>c.toLowerCase()), primaryCategory: (primary && categories.includes(primary))? primary: categories[0], sourceHash: 'hash-'+id, schemaVersion:'v3', createdAt:now, updatedAt:now, version:'1.0.0', status:'approved', owner:'owner', priorityTier:'P3', classification:'public', lastReviewedAt:now, nextReviewDue:now, changeLog:[], semanticSummary:'' };
  fs.writeFileSync(path.join(dir, id+'.json'), JSON.stringify(rec,null,2));
}

describe('graph/export mermaid format', () => {
  let dir:string; let invalidate: (()=>void)|null = null;
  beforeAll(async () => {
    dir = path.join(process.cwd(),'tmp', `graph-mermaid-${Date.now()}`);
    process.env.INSTRUCTIONS_DIR = dir;
    await import('../services/handlers.graph.js');
    await import('../services/handlers.instructions.js');
    const cat = await import('../services/catalogContext.js');
    invalidate = cat.invalidate;
  });
  beforeEach(async () => {
    if(fs.existsSync(dir)) for(const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir,f)); else fs.mkdirSync(dir,{recursive:true});
    writeInstruction('a-one','body a',['alpha','shared'],'alpha');
    writeInstruction('b-two','body b',['beta','shared'],'beta');
    writeInstruction('c-three','body c',['beta'],'beta');
    invalidate?.();
  try { const g:any = await import('../services/handlers.graph.js'); if(typeof g.__resetGraphCache==='function') g.__resetGraphCache(); } catch (_e) { /* ignore test helper failure */ }
  });

  it('emits valid mermaid flowchart with node + edge counts aligned', async () => {
    const res = await callTool<any>('graph/export', { format:'mermaid' });
    expect(typeof res.mermaid).toBe('string');
  const lines = res.mermaid.split(/\r?\n/).filter((l:string)=>l.trim().length);
    expect(lines[0].trim()).toBe('flowchart undirected');
  const nodeLines = lines.filter((l:string)=>/\[".+"\]$/.test(l.trim()));
  const edgeLines = lines.filter((l:string)=>/---\|.+\|/.test(l));
    expect(nodeLines.length).toBe(res.nodes.length);
    expect(edgeLines.length).toBe(res.edges.length);
  });

  it('respects enrichment flags and includes belongs edges + category nodes', async () => {
    const res = await callTool<any>('graph/export', { format:'mermaid', enrich:true, includeCategoryNodes:true, includeEdgeTypes:['belongs'] });
    expect(res.meta.graphSchemaVersion).toBe(2);
    expect(res.edges.every((e:any)=> e.type==='belongs')).toBe(true);
    expect(res.mermaid.startsWith('flowchart undirected')).toBe(true);
  });
});
