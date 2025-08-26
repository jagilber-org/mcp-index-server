// Feature flag & metrics infrastructure (Phase 0)
// INDEX_FEATURES=usage,window,hotness,drift,risk

const RAW = (process.env.INDEX_FEATURES||'').split(',').map(s=>s.trim()).filter(Boolean);
const SET = new Set(RAW);

export function hasFeature(name: string){ return SET.has(name); }

// Simple in-memory counters (could be exposed via metrics/snapshot already existing)
const counters: Record<string, number> = {};
export function incrementCounter(name: string, by=1){ counters[name] = (counters[name]||0)+by; }
export function getCounters(){ return { ...counters }; }

// Record activation counts once at module load
for(const f of SET){ incrementCounter(`featureActivated:${f}`); }

export function featureStatus(){
  return {
    features: Array.from(SET.values()).sort(),
    counters: getCounters(),
    env: RAW.length? RAW: [],
  };
}
