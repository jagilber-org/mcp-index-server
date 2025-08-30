import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getAddContractRegistry, registerAddContract } from './testUtils';

function scanFile(file: string){
  const txt = fs.readFileSync(file,'utf8');
  if(!/action:'add'/.test(txt)) return;
  const idMatch = txt.match(/const\s+id\s*=\s*'([^'\n]+)';/);
  const idLit = idMatch ? idMatch[1] : undefined;
  const verifiedAsserted = /verified\)?.toBe\(true\)/.test(txt);
  const createdAsserted = /created\)?.toBe\(true\)/.test(txt);
  let visibility = false;
  if(idLit){
    visibility = new RegExp(`action:'get'`).test(txt) && new RegExp(idLit.replace(/[-/\\]/g,'\\$&')).test(txt);
  } else {
    visibility = /action:'get'/.test(txt) || /action:'list'/.test(txt);
  }
  registerAddContract({ file: path.basename(file), idLiteral: idLit, line: 0, verifiedAsserted, createdAsserted, visibilityQueried: visibility });
}

function collect(dir: string){
  const out: string[] = [];
  for(const e of fs.readdirSync(dir)){
    const full = path.join(dir,e);
    const s = fs.statSync(full);
    if(s.isDirectory()) out.push(...collect(full));
    else if(/\.spec\.ts$/.test(e) && e !== 'addContract.meta.spec.ts') out.push(full);
  }
  return out;
}

for(const f of collect(path.join(__dirname))) scanFile(f);

describe('Atomic Create Contract Meta-Test', () => {
  it('enforces verified/created + visibility after add', () => {
    const records = getAddContractRegistry();
    const failures = records.filter(r => (r.verifiedAsserted || r.createdAsserted) === false || r.visibilityQueried === false);
    if(failures.length){
      const detail = failures.map(f=> `${f.file} id=${f.idLiteral||'?'} verified=${f.verifiedAsserted} created=${f.createdAsserted} visibility=${f.visibilityQueried}`).join('\n');
      throw new Error(`Add contract violations detected:\n${detail}`);
    }
    expect(records.length).toBeGreaterThan(0);
  });
});
