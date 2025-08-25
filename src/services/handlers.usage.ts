import { registerHandler } from '../server/registry';
import { ensureLoaded, incrementUsage } from './catalogContext';

registerHandler('usage/track', (p:{id:string})=>{ if(!p.id) return { error:'missing id' }; const r=incrementUsage(p.id); if(!r) return { notFound:true }; return r; });
registerHandler('usage/hotset', (p:{limit?:number})=>{ const st=ensureLoaded(); const limit=Math.max(1, Math.min(p.limit??10, 100)); const items=[...st.list].filter(e=> (e.usageCount??0)>0).sort((a,b)=>{ const ua=a.usageCount??0, ub=b.usageCount??0; if(ub!==ua) return ub-ua; return (b.lastUsedAt||'').localeCompare(a.lastUsedAt||''); }).slice(0,limit).map(e=>({ id:e.id, usageCount:e.usageCount, lastUsedAt:e.lastUsedAt })); return { hash: st.hash, count: items.length, items, limit }; });

export {};
