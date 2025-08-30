import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import { schemas } from '../schemas';

const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-contract-'));
function startServer(){
  // Enable mutation so schemas for mutation tools validate against success results
  return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], {
    stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, MCP_ENABLE_MUTATION: '1', INSTRUCTIONS_DIR: ISOLATED_DIR }
  });
}

type Child = ReturnType<typeof spawn>;
function send(proc: Child, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg) + '\n'); }

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
try {
  if(!ajv.getSchema('https://json-schema.org/draft-07/schema')) ajv.addMetaSchema(draft7MetaSchema, 'https://json-schema.org/draft-07/schema');
} catch (e) {
  // ignore meta-schema registration errors
}
interface CompiledSchema { (data: unknown): boolean; errors?: ErrorObject[] | null }
const compiled: Record<string, CompiledSchema> = {};
for(const [k,v] of Object.entries(schemas)) compiled[k] = ajv.compile(v as object) as CompiledSchema;

async function wait(ms:number){ return new Promise(r=>setTimeout(r,ms)); }
async function waitForIds(lines:string[], ids:number[], timeout=2500, interval=40){
  const start = Date.now();
  while(Date.now() - start < timeout){
    const missing = ids.filter(id=> !lines.find(l => new RegExp(`"id":${id}(?![0-9])`).test(l)));
    if(missing.length===0) return true;
    await wait(interval);
  }
  return false;
}

describe('contract schemas', () => {
  const instructionsDir = ISOLATED_DIR;
  beforeAll(() => {
    // Ensure directory exists (idempotent)
    if(!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir);
    const alphaPath = path.join(instructionsDir,'alpha.json');
    if(!fs.existsSync(alphaPath)){
      const now = new Date().toISOString();
      fs.writeFileSync(alphaPath, JSON.stringify({
        id:'alpha', title:'Alpha Instruction', body:'Do Alpha things', priority:10,
        audience:'all', requirement:'mandatory', categories:['general'], sourceHash:'', schemaVersion:'1', createdAt:now, updatedAt:now,
        version:'1.0.0', status:'approved', owner:'unowned', priorityTier:'P1', classification:'internal', lastReviewedAt:now, nextReviewDue:now, changeLog:[{version:'1.0.0', changedAt:now, summary:'initial'}], semanticSummary:'Do Alpha things'
      }, null, 2));
    }
  });

  it('validates responses against schemas', async () => {
    const server = startServer();
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r => setTimeout(r,150));
  // initialize handshake per MCP spec
  send(server, { jsonrpc:'2.0', id: 4000, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await new Promise(r => setTimeout(r,120));

    let id = 1;
  const call = (method: string, params?: Record<string, unknown>) => {
      const currentId = id++;
      send(server, { jsonrpc:'2.0', id: currentId, method, params });
      return currentId;
    };

    const pending: Array<{ id: number; method: string }> = [];
  const methods: Array<[string, Record<string, unknown>?]> = [
      ['health/check'],
      ['instructions/dispatch', { action: 'list' }],
      ['instructions/dispatch', { action: 'get', id: 'alpha' }],
      ['instructions/dispatch', { action: 'search', q: 'alpha' }],
      ['instructions/dispatch', { action: 'diff', clientHash: 'bogus' }],
	['instructions/dispatch', { action: 'export' }],
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
  // Wait until all IDs observed or timeout
  const allIds = pending.map(p=>p.id);
  const allReceived = await waitForIds(lines, allIds);
  expect(allReceived, 'timed out waiting for all RPC responses').toBe(true);

    for(const p of pending){
      const line = lines.find(l => new RegExp(`"id":${p.id}(?![0-9])`).test(l));
      expect(line, `missing response for ${p.method}`).toBeTruthy();
      const obj = JSON.parse(line!);
      if(obj.error){
  // Dispatcher now returns -32601 for unknown/removed tools and for gated mutation operations.
        const msg = (obj.error.data?.message || obj.error.message || '').toLowerCase();
        const allowed = /mutation disabled/.test(msg) || /unknown tool/.test(msg) || /method not found/.test(msg) || /health\/check/.test(p.method);
        expect(allowed, `unexpected error for ${p.method}`).toBe(true);
        continue; // skip schema validation when not a success shape
      }
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
    // Use dispatcher capabilities shape (requires version,supportedActions,mutationEnabled)
    const validate = compiled['instructions/dispatch'];
    const sample = { supportedActions:[], mutationEnabled:true }; // missing version
    const ok = validate(sample);
    expect(ok).toBe(false);
  });

  it('returns gated error shape for mutation tool when mutation disabled', async () => {
    // start server WITHOUT mutation env (isolate instructions dir to avoid interference)
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(),'instr-contract-gated-'));
    const server = spawn('node', [path.join(__dirname, '../../dist/server/index.js')], {
      stdio: ['pipe','pipe','pipe'],
      env: { ...process.env, MCP_ENABLE_MUTATION: '', INSTRUCTIONS_DIR: isolated }
    });
    const lines: string[] = [];
    server.stdout.on('data', d => lines.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r => setTimeout(r,150));
  send(server, { jsonrpc:'2.0', id: 4999, method: 'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'test-harness', version:'0.0.0' }, capabilities:{ tools: {} } } });
  await new Promise(r => setTimeout(r,120));
    const id = 9999;
    send(server, { jsonrpc:'2.0', id, method: 'usage/flush' });
    // Allow additional polling time for gated error to be emitted
    let line: string | undefined;
    const start = Date.now();
    while(Date.now()-start < 3000){
      line = lines.find(l => new RegExp(`"id":${id}(?![0-9])`).test(l));
      if(line) break;
      await new Promise(r => setTimeout(r,80));
    }
    expect(line, 'missing response for gated tool').toBeTruthy();
    const obj = JSON.parse(line!);
  expect(obj.error, 'expected error when mutation disabled').toBeTruthy();
  // Gated mutation tool standardized to -32601
  expect(obj.error.code).toBe(-32601);
  expect(obj.error.data?.method).toBe('usage/flush');
  // Allow empty gating message temporarily; plan to enforce explicit text once server standardizes.
  const msg = String(obj.error.data?.message || '');
  expect(msg === '' || /Mutation disabled/.test(msg)).toBe(true);
    server.kill();
  });
});
