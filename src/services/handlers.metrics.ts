import { registerHandler, getMetricsRaw } from '../server/registry';
import { getCatalogState } from '../services/catalogContext';
import { featureStatus } from '../services/features';
import fs from 'fs';
import path from 'path';

import { getValidationMetrics } from './validationService';
registerHandler('metrics/snapshot', ()=>{ const raw=getMetricsRaw(); const methods=Object.entries(raw).map(([method, rec])=>({ method, count: rec.count, avgMs: rec.count? +(rec.totalMs/rec.count).toFixed(2):0, maxMs:+rec.maxMs.toFixed(2) })).sort((a,b)=> a.method.localeCompare(b.method)); const features = featureStatus(); const validation = getValidationMetrics(); return { generatedAt: new Date().toISOString(), methods, features, validation }; });
// health/check retained here (meta/tools provided by shim for rich output)
// Resolve version locally (mirrors transport logic) to avoid import cycles
let VERSION = '0.0.0';
try {
	const pkgPath = path.join(process.cwd(),'package.json');
	if(fs.existsSync(pkgPath)){
		const raw = JSON.parse(fs.readFileSync(pkgPath,'utf8')); if(raw.version) VERSION = raw.version;
	}
} catch { /* ignore */ }
interface HealthCatalogSummary { scanned: number; accepted: number; skipped: number; reasons: Record<string,number>; salvage?: Record<string,number>; softWarnings?: Record<string,number>; }
registerHandler('health/check', ()=>{
	let summary: HealthCatalogSummary | undefined;
	try {
		const st = getCatalogState() as unknown as { loadSummary?: HealthCatalogSummary };
		if(st.loadSummary){
			const s = st.loadSummary;
			summary = { scanned: s.scanned, accepted: s.accepted, skipped: s.skipped, reasons: s.reasons, salvage: s.salvage, softWarnings: s.softWarnings };
		}
	} catch { /* swallow to keep health resilient */ }
	return { status:'ok', timestamp:new Date().toISOString(), version: VERSION, catalog: summary };
});

export {};
