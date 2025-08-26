// Simple feature flag loader: environment variables + optional JSON file.
// Precedence: explicit env var (MCP_FLAG_<UPPER>) > JSON file > default (false)
import fs from 'fs';
import path from 'path';

export type FeatureFlag = 'response_envelope_v1';

interface FlagConfig { [k: string]: boolean }

let cache: FlagConfig | null = null;

function loadFile(): FlagConfig {
  const file = process.env.MCP_FLAGS_FILE || path.join(process.cwd(), 'flags.json');
  if(!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file,'utf8'));
    if(raw && typeof raw === 'object'){
      const out: FlagConfig = {};
      for(const [k,v] of Object.entries(raw)){
        if(typeof v === 'boolean') out[k] = v;
      }
      return out;
    }
  } catch { /* ignore */ }
  return {};
}

function load(): FlagConfig {
  if(cache) return cache;
  const base = loadFile();
  // Overlay env vars: MCP_FLAG_<NAME>=1/true/yes/on enables
  for(const [envKey, value] of Object.entries(process.env)){
    if(envKey.startsWith('MCP_FLAG_')){
      const flagName = envKey.substring('MCP_FLAG_'.length).toLowerCase();
      const v = String(value).toLowerCase();
      if(['1','true','yes','on','enabled'].includes(v)) base[flagName] = true;
      else if(['0','false','no','off','disabled'].includes(v)) base[flagName] = false;
    }
  }
  cache = base;
  return cache;
}

export function flagEnabled(flag: FeatureFlag): boolean {
  const cfg = load();
  return !!cfg[flag];
}

export function dumpFlags(){ return { ...load() }; }
