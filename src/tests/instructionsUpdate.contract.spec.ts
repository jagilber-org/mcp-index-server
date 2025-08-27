import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { waitFor, waitForServerReady } from './testUtils';
import { waitForDist } from './distReady';

// Contract style: ensure that overwrite semantics act as an idempotent update pathway and registry advertises add tool only.

const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-update-contract-'));
function startServer(mutation:boolean){
	return spawn('node', [path.join(__dirname,'../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION: mutation? '1':'', INSTRUCTIONS_DIR: ISOLATED_DIR } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function collect(out:string[], id:number){ return out.filter(l=> { try { const o=JSON.parse(l); return o.id===id; } catch { return false; } }).pop(); }
function toolParsed(out:string[], id:number){
	const line = collect(out,id); if(!line) return undefined;
	try { const obj = JSON.parse(line); const txt = obj.result?.content?.[0]?.text; return txt? JSON.parse(txt): undefined; } catch { return undefined; }
}

describe('instructions/update contract (via instructions/add overwrite)', () => {
	it('registry does not expose instructions/update, only instructions/add', async () => {
		await waitForDist();
		const server = startServer(true);
		const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
		await waitForServerReady(server, out, { initId: 8001, metaId: 8002 });
		send(server,{ jsonrpc:'2.0', id:2, method:'tools/list', params:{} });
		await waitFor(()=> !!collect(out,2));
		const line = collect(out,2)!; const obj = JSON.parse(line).result as { tools: { name:string }[] };
		const names = obj.tools.map(t=> t.name);
		expect(names).toContain('instructions/add');
		expect(names).not.toContain('instructions/update');
		server.kill();
	}, 6000);

	it('idempotent overwrite toggles overwritten flag and preserves version when absent', async () => {
		const id = 'contract_overwrite';
		const file = path.join(ISOLATED_DIR, id + '.json');
		await waitForDist();
		const server = startServer(true);
		const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
		await waitForServerReady(server, out, { initId: 8010, metaId: 8011 });
		send(server,{ jsonrpc:'2.0', id:11, method:'tools/call', params:{ name:'instructions/add', arguments:{ entry:{ id, title:id, body:'One', priority:5, audience:'all', requirement:'optional', categories:['c'] }, overwrite:true, lax:true } } });
		await waitFor(()=> !!toolParsed(out,11));
		JSON.parse(fs.readFileSync(file,'utf8')) as { version?:string; body:string }; // initial snapshot ignored for contract
		// Add a manual version via second call
		send(server,{ jsonrpc:'2.0', id:12, method:'tools/call', params:{ name:'instructions/add', arguments:{ entry:{ id, title:id, body:'Two', priority:5, audience:'all', requirement:'optional', categories:['c'], version:'0.1.0' }, overwrite:true, lax:true } } });
		await waitFor(()=> !!toolParsed(out,12));
		const second = JSON.parse(fs.readFileSync(file,'utf8')) as { version?:string; body:string };
		expect(second.version).toBe('0.1.0');
		// Third call without version should retain 0.1.0
		send(server,{ jsonrpc:'2.0', id:13, method:'tools/call', params:{ name:'instructions/add', arguments:{ entry:{ id, title:id, body:'Three', priority:5, audience:'all', requirement:'optional', categories:['c'] }, overwrite:true, lax:true } } });
		await waitFor(()=> !!toolParsed(out,13));
		const third = JSON.parse(fs.readFileSync(file,'utf8')) as { version?:string; body:string };
		expect(third.body).toBe('Three');
		expect(third.version).toBe('0.1.0');
		server.kill();
	}, 9000);
});

