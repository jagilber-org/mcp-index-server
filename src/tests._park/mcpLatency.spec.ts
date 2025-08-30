import { spawn } from 'child_process';
import path from 'path';
import { describe, it, expect } from 'vitest';

// Minimal latency measurement using ping tool (tools/call) to ensure suite not empty and
// provide basic regression signal for handshake timing.

function startServer(){
	const exe = process.execPath;
	const entry = path.join(process.cwd(),'dist','server','index.js');
	const child = spawn(exe, [entry], { stdio: ['pipe','pipe','pipe'] });
	return child;
}

describe('mcp latency smoke', () => {
	it('responds to ping within 1s', async () => {
		const child = startServer();
		const lines: string[] = [];
		child.stdout.on('data', d => {
			for(const line of d.toString().split(/\r?\n/)){ if(line.trim()) lines.push(line); }
		});
		// send initialize
		child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'latency-test', version:'0.0.0' } } })+'\n');
		// actively wait for explicit id:1 response instead of any protocolVersion substring (reduces race)
		const initStart = Date.now();
		let initLine: string | undefined;
		while(Date.now()-initStart < 1000 && !initLine){
			initLine = lines.find(l=>l.includes('"id":1') && l.includes('protocolVersion'));
			if(!initLine) await new Promise(r=>setTimeout(r,8));
		}
		expect(initLine, 'missing initialize result within 1s').toBeTruthy();
		// issue ping via direct method
		child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'ping', params:{} })+'\n');
		const pingStart = Date.now();
		while(Date.now()-pingStart < 1000 && !lines.some(l=>l.includes('"id":2') && l.includes('uptimeMs'))){
			await new Promise(r=>setTimeout(r,10));
		}
		const pingLine = lines.find(l=>l.includes('"id":2') && l.includes('uptimeMs'));
		expect(pingLine, 'missing ping response').toBeTruthy();
		try { child.kill(); } catch { /* ignore */ }
	});
});
