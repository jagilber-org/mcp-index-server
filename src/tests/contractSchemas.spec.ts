import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import Ajv, { ErrorObject } from 'ajv';
import { schemas } from '../schemas';

function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio: ['pipe','pipe','pipe'] });
}

type Child = ReturnType<typeof spawn>;
function send(proc: Child, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg) + '\n'); }

const ajv = new Ajv({ allErrors: true });
interface CompiledSchema { (data: unknown): boolean; errors?: ErrorObject[] | null }
const compiled: Record<string, CompiledSchema> = {};
for(const [k,v] of Object.entries(schemas)) compiled[k] = ajv.compile(v as object) as CompiledSchema;

describe('contract schemas', () => {
  const instructionsDir = path.join(process.cwd(), 'instructions');
  beforeAll(() => {
    if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir);
    const alphaPath = path.join(instructionsDir,'alpha.json');
    if(!fs.existsSync(alphaPath)){
      fs.writeFileSync(alphaPath, JSON.stringify({
        id:'alpha', title:'Alpha Instruction', body:'Do Alpha things', priority:10,
        audience:'all', requirement:'mandatory', categories:['general'], sourceHash:'', schemaVersion:'1', createdAt:'', updatedAt:''
      }, null, 2));
    }
  });

  it('validates responses against schemas', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r => setTimeout(r,150));

    let id = 1;
  const call = (method: string, params?: Record<string, unknown>) => {
      const currentId = id++;
      send(server, { jsonrpc:'2.0', id: currentId, method, params });
      return currentId;
    };

    const pending: Array<{ id: number; method: string }> = [];
  const methods: Array<[string, Record<string, unknown>?]> = [
      ['health/check'],
      ['instructions/list', {}],
      ['instructions/get', { id: 'alpha' }],
      ['instructions/search', { q: 'alpha' }],
      ['instructions/diff', { clientHash: 'bogus' }],
  ['instructions/export', {}],
      ['prompt/review', { prompt: 'simple test prompt' }],
      ['integrity/verify'],
  ['instructions/repair'],
      ['usage/track', { id: 'alpha' }],
      ['usage/hotset', { limit: 5 }],
  ['metrics/snapshot'],
      ['gates/evaluate']
  ,['meta/tools']
  ,['usage/flush']
  ,['instructions/reload']
  ,['instructions/import', { entries: [ { id:'gamma', title:'Gamma', body:'Gamma body', priority:50, audience:'all', requirement:'optional', categories:['misc'] } ], mode: 'overwrite' }]
    ];
    for(const [m,p] of methods){ pending.push({ id: call(m,p), method: m }); }
    await new Promise(r => setTimeout(r,300));

    for(const p of pending){
  const line = lines.find(l => new RegExp(`"id":${p.id}(?![0-9])`).test(l));
      expect(line, `missing response for ${p.method}`).toBeTruthy();
      const obj = JSON.parse(line!);
      expect(obj.error, `unexpected error for ${p.method}`).toBeFalsy();
      const validate = compiled[p.method];
      expect(validate, `no schema for ${p.method}`).toBeTruthy();
      const ok = validate(obj.result);
      if(!ok){
        console.error('Schema errors for', p.method, validate.errors);
      }
      expect(ok, `schema validation failed for ${p.method}`).toBe(true);
    }
    server.kill();
  }, 8000);

  it('detects contract drift (negative test)', async () => {
    const validate = compiled['instructions/list'];
    // Clone valid object and remove required hash
    const sample = { hash: 'x', count: 0, items: [] };
  delete (sample as { hash?: string }).hash;
    const ok = validate(sample);
    expect(ok).toBe(false);
  });
});
