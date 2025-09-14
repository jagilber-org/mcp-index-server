import { describe, it, expect } from 'vitest';

// We use the portable client connect() helper directly so this path validates
// the higher-level SDK abstraction rather than raw JSON-RPC framing.
// Dynamic import keeps TypeScript ambient decl noise minimal (client-lib.mjs is ESM).

async function getPortable(){
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore - dynamic import of ESM portable helper
	return await import('../..//portable-mcp-client/client-lib.mjs');
}

function pick<T>(v: T | undefined | null, ...keys: string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {}; if(!v || typeof v !== 'object') return out;
	for(const k of keys){
		if(k in (v as Record<string, unknown>)) out[k] = (v as Record<string, unknown>)[k];
	}
	return out;
}

describe('portable help/overview & health parity', () => {
	it('retrieves help/overview with required structural fields via portable client', async () => {
		const { connect } = await getPortable();
		const command = 'node';
		const args = ['dist/server/index.js'];
			const c: any = await connect({ command, args });
			const client = c.client;
			const close = c.close || c.transport?.close?.bind(c.transport) || (async () => {});
		try {
			// Enumerate tools to ensure help/overview registered
			const toolsList = await client.listTools();
			const toolNames = (toolsList?.tools||[]).map((t: any)=> t.name);
			expect(toolNames).toContain('help/overview');
			// Call help/overview
			const resp = await client.callTool({ name: 'help/overview', arguments: {} });
			// Portable SDK wraps tool results into content[].text with JSON string typically
			let obj: any = undefined;
			if(Array.isArray(resp?.content)){
				for(const c of resp.content){
					if(c?.data && c.data.generatedAt) { obj = c.data; break; }
					if(typeof c?.text === 'string'){
						try { const parsed = JSON.parse(c.text); if(parsed && parsed.generatedAt && parsed.sections){ obj = parsed; break; } } catch { /* ignore */ }
					}
				}
			}
			if(!obj && resp && (resp.generatedAt || resp.sections)) obj = resp; // direct fallback
			expect(obj, 'extracted help object').toBeTruthy();
			expect(obj.generatedAt).toBeTruthy();
			expect(Array.isArray(obj.sections)).toBe(true);
			const ids = obj.sections.map((s: any)=> s.id);
			for(const required of ['intro','discovery','lifecycle','promotion','mutation-safety','recursion-safeguards','next-steps']){
				expect(ids).toContain(required);
			}
			expect(obj.lifecycleModel?.tiers?.length).toBeGreaterThan(0);
			expect(obj.lifecycleModel?.promotionChecklist?.length).toBeGreaterThan(3);
		} finally { await close(); }
	}, 20000);

	it('retrieves instructions/health and validates recursionRisk none via portable client', async () => {
		const { connect } = await getPortable();
			const c: any = await connect({ command: 'node', args: ['dist/server/index.js'] });
			const client = c.client;
			const close = c.close || c.transport?.close?.bind(c.transport) || (async () => {});
		try {
			const resp = await client.callTool({ name: 'instructions/health', arguments: {} });
			let obj: any = undefined;
			if(resp?.data && (resp.data as any).recursionRisk) obj = resp.data;
			if(!obj && Array.isArray(resp?.content)){
				for(const c of resp.content){
					if(c?.data && c.data.recursionRisk){ obj = c.data; break; }
					if(typeof c?.text === 'string'){
						try { const parsed = JSON.parse(c.text); if(parsed && parsed.recursionRisk){ obj = parsed; break; } } catch { /* ignore */ }
					}
				}
			}
			if(!obj && resp && resp.recursionRisk) obj = resp;
			expect(obj, 'extracted health object').toBeTruthy();
			expect(obj.recursionRisk).toBe('none');
			expect(obj.leakage).toBeTruthy();
			expect(typeof obj.leakage.leakageRatio).toBe('number');
			// Provide a concise debug print if unexpected fields missing (does not fail test itself)
			if(!obj.hash || !obj.count){
				// eslint-disable-next-line no-console
				console.log('[portable-health][debug]', pick(obj,'hash','count','snapshot','governanceHash'));
			}
		} finally { await close(); }
	}, 20000);
});


