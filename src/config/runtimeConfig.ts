/**
 * Unified runtime configuration loader.
 *
 * Goals:
 *  - Provide a single parsed, typed surface for environment driven behavior.
 *  - Reduce proliferation of one-off process.env reads scattered through code/tests.
 *  - Offer consolidation variables (MCP_TRACE, MCP_CATALOG_MODE, MCP_TIMING_JSON, MCP_LOG_LEVEL, MCP_PROFILE, MCP_INIT_FEATURES, MCP_MUTATION, MCP_BUFFER_RING, MCP_METRICS, MCP_TEST_MODE).
 *  - Maintain backward compatibility with existing legacy flags (FAST_COVERAGE, MANIFEST_TEST_WAIT_DISABLED_MS, etc.).
 *  - Emit one-time deprecation notices when legacy flags are used without their consolidated replacement.
 *
 * Non-goals:
 *  - Hard removal of old flags (handled in future deprecation phases).
 *  - Deep validation of JSON timing schema beyond basic type checks.
 */
import fs from 'fs';

export type CatalogMode = 'normal' | 'memoize' | 'memoize+hash' | 'reload' | 'reload+memo';
export type LogLevel = 'error'|'warn'|'info'|'debug'|'trace';

interface TimingMap { [key: string]: number; }

interface BufferRingConfig { append: boolean; preload: boolean; }

export interface RuntimeConfig {
  profile: string;
  testMode: string | undefined;
  catalog: { mode: CatalogMode };
  mutationEnabled: boolean;
  logLevel: LogLevel;
  trace: Set<string>;
  initFeatures: Set<string>;
  bufferRing: BufferRingConfig;
  timing: (key: string, fallback?: number) => number | undefined;
  rawTiming: TimingMap;
  coverage: { hardMin?: number; target?: number; fastMode: boolean };
}

const deprecationNotices = new Set<string>();
function warnOnce(msg: string){
  if(!deprecationNotices.has(msg)){
    deprecationNotices.add(msg);
    // eslint-disable-next-line no-console
    console.warn(`[config:deprecation] ${msg}`);
  }
}

function parseJSONMaybe<T=unknown>(src?: string): T | undefined {
  if(!src) return undefined;
  try { return JSON.parse(src) as T; } catch { return undefined; }
}

function parseTiming(): TimingMap {
  const map: TimingMap = {};
  // Consolidated JSON or file path
  const timingSrc = process.env.MCP_TIMING_JSON;
  if(timingSrc){
    let obj: Record<string, unknown> | undefined;
    if(timingSrc.startsWith('{')) obj = parseJSONMaybe<Record<string, unknown>>(timingSrc);
    else if(fs.existsSync(timingSrc)) obj = parseJSONMaybe<Record<string, unknown>>(fs.readFileSync(timingSrc,'utf8'));
    if(obj && typeof obj === 'object'){
      for(const [k,v] of Object.entries(obj)){
        if(typeof v === 'number' && isFinite(v)) map[k]=v;
      }
    }
  }
  // Map legacy individual flags into structured keys if present and not overridden.
  // Manifest
  if(process.env.MANIFEST_TEST_WAIT_DISABLED_MS && map['manifest.waitDisabled']===undefined){
    map['manifest.waitDisabled']=Number(process.env.MANIFEST_TEST_WAIT_DISABLED_MS);
    warnOnce('Use MCP_TIMING_JSON manifest.waitDisabled instead of MANIFEST_TEST_WAIT_DISABLED_MS');
  }
  if(process.env.MANIFEST_TEST_WAIT_REPAIR_MS && map['manifest.waitRepair']===undefined){
    map['manifest.waitRepair']=Number(process.env.MANIFEST_TEST_WAIT_REPAIR_MS);
    warnOnce('Use MCP_TIMING_JSON manifest.waitRepair instead of MANIFEST_TEST_WAIT_REPAIR_MS');
  }
  if(process.env.MANIFEST_TEST_POST_KILL_MS && map['manifest.postKill']===undefined){
    map['manifest.postKill']=Number(process.env.MANIFEST_TEST_POST_KILL_MS);
    warnOnce('Use MCP_TIMING_JSON manifest.postKill instead of MANIFEST_TEST_POST_KILL_MS');
  }
  // Synthetic activity
  if(process.env.SYN_ACTIVITY_READY_MS && map['synthetic.ready']===undefined){
    map['synthetic.ready']=Number(process.env.SYN_ACTIVITY_READY_MS); warnOnce('Use MCP_TIMING_JSON synthetic.ready instead of SYN_ACTIVITY_READY_MS'); }
  if(process.env.SYN_ACTIVITY_DEADLINE_MS && map['synthetic.deadline']===undefined){
    map['synthetic.deadline']=Number(process.env.SYN_ACTIVITY_DEADLINE_MS); warnOnce('Use MCP_TIMING_JSON synthetic.deadline instead of SYN_ACTIVITY_DEADLINE_MS'); }
  if(process.env.SYN_ACTIVITY_ITERATIONS && map['synthetic.iterations']===undefined){
    map['synthetic.iterations']=Number(process.env.SYN_ACTIVITY_ITERATIONS); warnOnce('Use MCP_TIMING_JSON synthetic.iterations instead of SYN_ACTIVITY_ITERATIONS'); }
  if(process.env.SYN_ACTIVITY_CONCURRENCY && map['synthetic.concurrency']===undefined){
    map['synthetic.concurrency']=Number(process.env.SYN_ACTIVITY_CONCURRENCY); warnOnce('Use MCP_TIMING_JSON synthetic.concurrency instead of SYN_ACTIVITY_CONCURRENCY'); }
  // Smoke
  if(process.env.SMOKE_WAIT_ID_TIMEOUT_MS && map['smoke.waitId']===undefined){
    map['smoke.waitId']=Number(process.env.SMOKE_WAIT_ID_TIMEOUT_MS); warnOnce('Use MCP_TIMING_JSON smoke.waitId instead of SMOKE_WAIT_ID_TIMEOUT_MS'); }
  return map;
}

function deriveCatalogMode(): CatalogMode {
  const explicit = process.env.MCP_CATALOG_MODE as CatalogMode | undefined;
  if(explicit) return explicit;
  const memo = process.env.MCP_CATALOG_MEMOIZE === '1';
  const hash = process.env.MCP_CATALOG_MEMOIZE_HASH === '1';
  const reload = process.env.INSTRUCTIONS_ALWAYS_RELOAD === '1';
  if(reload && memo && hash) return 'reload+memo';
  if(reload && memo) return 'reload+memo';
  if(reload) return 'reload';
  if(memo && hash) return 'memoize+hash';
  if(memo) return 'memoize';
  return 'normal';
}

function parseTrace(): Set<string> {
  const set = new Set<string>();
  const raw = process.env.MCP_TRACE; // comma list
  if(raw){
    raw.split(',').map(s=>s.trim()).filter(Boolean).forEach(v=>set.add(v));
  }
  // Legacy flags mapping
  const legacyMap: Record<string,string[]> = {
    MCP_HANDSHAKE_TRACE:['handshake'],
    MCP_INIT_FRAME_DIAG:['initFrame'],
    MCP_HEALTH_MIXED_DIAG:['healthMixed'],
    PORTABLE_HANDSHAKE_TRACE:['portableHandshake'],
    PORTABLE_CONNECT_TRACE:['portableConnect'],
    MCP_LOG_VERBOSE:['verbose'],
  };
  for(const [flag,tokens] of Object.entries(legacyMap)){
    if(process.env[flag] === '1' && tokens.every(t=>!set.has(t))){
      tokens.forEach(t=>set.add(t));
      warnOnce(`Use MCP_TRACE (${tokens.join(',')}) instead of legacy ${flag}`);
    }
  }
  return set;
}

function parseInitFeatures(): Set<string> {
  const set = new Set<string>();
  const raw = process.env.MCP_INIT_FEATURES; // comma list
  if(raw){ raw.split(',').map(s=>s.trim()).filter(Boolean).forEach(v=>set.add(v)); }
  if(process.env.MCP_HANDSHAKE_FALLBACKS === '1'){ set.add('handshakeFallbacks'); warnOnce('Use MCP_INIT_FEATURES=handshakeFallbacks instead of MCP_HANDSHAKE_FALLBACKS'); }
  if(process.env.MCP_INIT_FALLBACK_ALLOW === '1'){ set.add('initFallback'); warnOnce('Use MCP_INIT_FEATURES=initFallback instead of MCP_INIT_FALLBACK_ALLOW'); }
  if(process.env.MCP_DISABLE_INIT_SNIFF === '1'){ set.add('disableSniff'); warnOnce('Use MCP_INIT_FEATURES=disableSniff instead of MCP_DISABLE_INIT_SNIFF'); }
  return set;
}

function parseLogLevel(traceSet: Set<string>): LogLevel {
  const raw = process.env.MCP_LOG_LEVEL?.toLowerCase();
  const valid: LogLevel[] = ['error','warn','info','debug','trace'];
  if(raw && (valid as string[]).includes(raw)) return raw as LogLevel;
  if(traceSet.has('verbose')) return 'trace';
  if(process.env.MCP_DEBUG === '1' || process.env.MCP_VERBOSE_LOGGING === '1') return 'debug';
  return 'info';
}

function parseBufferRing(): BufferRingConfig {
  // New consolidated var could be JSON or key=value pairs (future). For now derive from legacy flags.
  let append: boolean | undefined;
  let preload = false;
  if(process.env.BUFFER_RING_APPEND === '0') append = false;
  else if(process.env.BUFFER_RING_APPEND === '1') append = true;
  if(process.env.BUFFER_RING_APPEND_PRELOAD === '1') preload = true;
  return { append: append ?? true, preload };
}

function parseMutation(): boolean {
  if(process.env.MCP_MUTATION){
    if(process.env.MCP_MUTATION === '1' || process.env.MCP_MUTATION === 'true') return true;
    return false;
  }
  if(process.env.MCP_ENABLE_MUTATION === '1'){ warnOnce('Use MCP_MUTATION=1 instead of MCP_ENABLE_MUTATION'); return true; }
  return false;
}

function parseCoverage(): { hardMin?: number; target?: number; fastMode: boolean } {
  const fast = process.env.FAST_COVERAGE === '1' || process.env.MCP_TEST_MODE === 'coverage-fast';
  const hardMin = process.env.COVERAGE_HARD_MIN ? Number(process.env.COVERAGE_HARD_MIN) : undefined;
  const target = process.env.COVERAGE_TARGET ? Number(process.env.COVERAGE_TARGET) : undefined;
  return { hardMin, target, fastMode: fast };
}

/** Build and return the runtime configuration */
export function loadRuntimeConfig(): RuntimeConfig {
  const profile = process.env.MCP_PROFILE || 'default';
  const testMode = process.env.MCP_TEST_MODE;
  const rawTiming = parseTiming();
  const trace = parseTrace();
  const initFeatures = parseInitFeatures();
  const logLevel = parseLogLevel(trace);
  const cfg: RuntimeConfig = {
    profile,
    testMode,
    catalog: { mode: deriveCatalogMode() },
    mutationEnabled: parseMutation(),
    logLevel,
    trace,
    initFeatures,
    bufferRing: parseBufferRing(),
    rawTiming,
    timing: (key: string, fallback?: number) => rawTiming[key] ?? fallback,
    coverage: parseCoverage(),
  };
  return cfg;
}

// Singleton pattern: load once per process unless explicitly reloaded.
let _cached: RuntimeConfig | undefined;
export function getRuntimeConfig(): RuntimeConfig {
  if(!_cached) _cached = loadRuntimeConfig();
  return _cached;
}

export function reloadRuntimeConfig(): RuntimeConfig {
  _cached = loadRuntimeConfig();
  return _cached;
}

// Quick self-test when executed directly (optional developer utility)
if(require.main === module){
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(getRuntimeConfig(), null, 2));
}
