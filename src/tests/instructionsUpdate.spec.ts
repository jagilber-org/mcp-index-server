import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { waitFor } from './testUtils';

// This suite covers "update" semantics accomplished today via instructions/add with overwrite=true.
// There is no dedicated instructions/update tool; overwrite retains version & changeLog unless explicitly supplied.

const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-update-'));

function startServer(mutation: boolean){
	return spawn('node', [path.join(__dirname, '../../dist/server/index.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, MCP_ENABLE_MUTATION: mutation? '1':'', INSTRUCTIONS_DIR: ISOLATED_DIR } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function collect(out:string[], id:number){ return out.filter(l=> { try { const o=JSON.parse(l); return o.id===id; } catch { return false; } }).pop(); }

describe('instructions/update via overwrite (behavioral)', () => {
	it('updates body without changing version or changeLog when no version provided', async () => {
		const id = 'update_body_retains_version';
		const file = path.join(ISOLATED_DIR, id + '.json');
		const server = startServer(true);
		const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
		await new Promise(r=> setTimeout(r,70));
		send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'update-test', version:'0' }, capabilities:{ tools:{} } } });
		await waitFor(()=> !!collect(out,1));
		// Create with explicit version + changeLog
		send(server,{ jsonrpc:'2.0', id:2, method:'instructions/add', params:{ entry:{ id, title:id, body:'Initial body', priority:10, audience:'all', requirement:'optional', categories:['upd'], version:'1.2.3', changeLog:[{ version:'1.2.3', changedAt:new Date().toISOString(), summary:'initial' }] }, overwrite:true, lax:true } });
		await waitFor(()=> !!collect(out,2));
		const first = JSON.parse(fs.readFileSync(file,'utf8')) as { version:string; changeLog?: unknown[]; sourceHash:string };
		expect(first.version).toBe('1.2.3');
		const firstHash = first.sourceHash;
		const firstChangeLen = (first.changeLog||[]).length;
		// Overwrite with new body, no version
		send(server,{ jsonrpc:'2.0', id:3, method:'instructions/add', params:{ entry:{ id, title:id, body:'Modified body once', priority:10, audience:'all', requirement:'optional', categories:['upd'] }, overwrite:true, lax:true } });
		await waitFor(()=> !!collect(out,3));
		const second = JSON.parse(fs.readFileSync(file,'utf8')) as { version:string; changeLog?: unknown[]; body:string; sourceHash:string };
		expect(second.body).toBe('Modified body once');
		expect(second.version).toBe('1.2.3'); // unchanged
		expect((second.changeLog||[]).length).toBe(firstChangeLen); // not auto bumped
		expect(second.sourceHash).not.toBe(firstHash); // body hash changed
		server.kill();
	}, 8000);

	it('produces diff updated entry after overwrite', async () => {
		const id = 'update_diff_detect';
		const file = path.join(ISOLATED_DIR, id + '.json');
		const server = startServer(true);
		const out:string[]=[]; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)) );
		await new Promise(r=> setTimeout(r,70));
		send(server,{ jsonrpc:'2.0', id:10, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'update-test', version:'0' }, capabilities:{ tools:{} } } });
		await waitFor(()=> !!collect(out,10));
		send(server,{ jsonrpc:'2.0', id:11, method:'instructions/add', params:{ entry:{ id, title:id, body:'Initial', priority:20, audience:'all', requirement:'optional', categories:['upd'] }, overwrite:true, lax:true } });
		await waitFor(()=> !!collect(out,11));
		// list to get current hash
		send(server,{ jsonrpc:'2.0', id:12, method:'instructions/list', params:{} });
		await waitFor(()=> !!collect(out,12));
		const listObj = JSON.parse(collect(out,12)!).result as { hash:string; items: { id:string; sourceHash:string }[] };
		const currentHash = listObj.hash;
		const entry = listObj.items.find(e=> e.id===id);
		expect(entry).toBeTruthy();
		const knownSourceHash = (entry as { sourceHash:string }).sourceHash;
		const fullKnown = listObj.items.map(i=> ({ id: i.id, sourceHash: i.sourceHash }));
		// diff upToDate using full known array
		send(server,{ jsonrpc:'2.0', id:13, method:'instructions/diff', params:{ clientHash: currentHash, known: fullKnown } });
		await waitFor(()=> !!collect(out,13));
		const diff1 = JSON.parse(collect(out,13)!).result;
		expect(diff1.upToDate || (Array.isArray(diff1.added)&&diff1.added.length===0)).toBeTruthy();
		// overwrite with modified body
		send(server,{ jsonrpc:'2.0', id:14, method:'instructions/add', params:{ entry:{ id, title:id, body:'Changed body', priority:20, audience:'all', requirement:'optional', categories:['upd'] }, overwrite:true, lax:true } });
		await waitFor(()=> !!collect(out,14));
		const after = JSON.parse(fs.readFileSync(file,'utf8')) as { sourceHash:string };
		expect(after.sourceHash).not.toBe(knownSourceHash);
		// diff again with old hash + known -> updated array should include id
		// Use previous known (still old hash for modified id) but full known for others (we just replace entry for id with old hash)
		const staleKnown = fullKnown.map(k=> k.id===id ? { id, sourceHash: knownSourceHash }: k);
		send(server,{ jsonrpc:'2.0', id:15, method:'instructions/diff', params:{ clientHash: currentHash, known: staleKnown } });
		await waitFor(()=> !!collect(out,15));
		const diff2 = JSON.parse(collect(out,15)!).result as { updated?: { id:string }[] };
		const updatedIds = (diff2.updated||[]).map(e=> e.id);
		expect(updatedIds).toContain(id);
		server.kill();
	}, 9000);
});

