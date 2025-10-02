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
import path from 'path';
import { getBooleanEnv, parseBooleanEnv } from '../utils/envUtils';
import { DEFAULT_SESSION_PERSISTENCE_CONFIG, SESSION_PERSISTENCE_ENV_VARS } from '../models/SessionPersistence.js';

export type CatalogMode = 'normal' | 'memoize' | 'memoize+hash' | 'reload' | 'reload+memo';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

interface TimingMap { [key: string]: number; }

interface BufferRingConfig { append: boolean; preload: boolean; }

interface CoverageConfig {
  hardMin?: number;
  target?: number;
  fastMode: boolean;
  strictMode: boolean;
}

interface DashboardHttpConfig {
  enable: boolean;
  port: number;
  host: string;
  maxPortTries: number;
  enableHttpMetrics: boolean;
  requestTimeoutMs: number;
  maxConnections: number;
  verboseLogging: boolean;
  mutationEnabled: boolean;
}

interface DashboardAdminConfig {
  maxSessionHistory: number;
  backupsDir: string;
  instructionsDir: string;
}

interface DashboardSessionPersistenceConfig {
  enabled: boolean;
  persistenceDir: string;
  backupIntegration: boolean;
  retention: {
    maxHistoryEntries: number;
    maxHistoryDays: number;
    maxConnectionHistoryDays: number;
  };
  persistenceIntervalMs: number;
  deduplicationEnabled: boolean;
}

interface DashboardConfig {
  http: DashboardHttpConfig;
  admin: DashboardAdminConfig;
  sessionPersistence: DashboardSessionPersistenceConfig;
}

interface ServerBootstrapConfig {
  autoconfirm: boolean;
  tokenTtlSec: number;
  referenceMode: boolean;
}

interface ServerCatalogPollingConfig {
  enabled: boolean;
  proactive: boolean;
  intervalMs: number;
}

interface ServerConfig {
  disableEarlyStdinBuffer: boolean;
  fatalExitDelayMs: number;
  idleKeepaliveMs: number;
  sharedSentinel?: string;
  bootstrap: ServerBootstrapConfig;
  catalogPolling: ServerCatalogPollingConfig;
  multicoreTrace: boolean;
}

interface LoggingConfig {
  level: LogLevel;
  verbose: boolean;
  json: boolean;
  sync: boolean;
  diagnostics: boolean;
  protocol: boolean;
  file?: string;
  rawFileValue?: string;
  sentinelRequested: boolean;
}

interface MetricsToolcallConfig {
  chunkSize: number;
  flushMs: number;
  compactMs: number;
  appendLogEnabled: boolean;
}

interface MetricsHealthConfig {
  memoryThreshold: number;
  errorRateThreshold: number;
  minUptimeMs: number;
}

interface MetricsConfig {
  dir: string;
  resourceCapacity: number;
  sampleIntervalMs: number;
  toolcall: MetricsToolcallConfig;
  health: MetricsHealthConfig;
  fileStorage: boolean;
}

interface CatalogReadRetriesConfig {
  attempts: number;
  backoffMs: number;
}

interface CatalogGovernanceConfig {
  trailingNewline: boolean;
  hashHardeningEnabled: boolean;
  hashCanonVariants: number;
  hashImportSetSize: number;
}

interface CatalogConfig {
  mode: CatalogMode;
  baseDir: string;
  reloadAlways: boolean;
  memoize: boolean;
  memoizeDisabledExplicitly: boolean;
  memoizeHash: boolean;
  normalizationLog?: string | boolean;
  fileTrace: boolean;
  eventSilent: boolean;
  readRetries: CatalogReadRetriesConfig;
  usageFlushMs: number;
  disableUsageClamp: boolean;
  govHash: CatalogGovernanceConfig;
  maxFiles?: number; // Optional limit on catalog size for performance
  loadWarningThreshold?: number; // Warn if load time exceeds this (ms)
}

interface InstructionsManifestConfig {
  writeEnabled: boolean;
  fastload: boolean;
}

interface InstructionsCIContextConfig {
  inCI: boolean;
  githubActions: boolean;
  tfBuild: boolean;
}

interface InstructionsAuditLogConfig {
  enabled: boolean;
  file?: string;
  rawValue?: string;
  usesDefault: boolean;
}

interface InstructionsListValidationConfig {
  forceFullScan: boolean;
  allowSampling: boolean;
  effectiveSampleSize?: number;
  sampleSeed?: number;
  concurrency: number;
  maxDurationMs: number;
}

interface InstructionsConfig {
  workspaceId?: string;
  agentId?: string;
  canonicalDisable: boolean;
  strictVisibility: boolean;
  strictCreate: boolean;
  strictRemove: boolean;
  requireCategory: boolean;
  traceQueryDiag: boolean;
  manifest: InstructionsManifestConfig;
  mutationEnabledLegacy: boolean;
  ciContext: InstructionsCIContextConfig;
  auditLog: InstructionsAuditLogConfig;
  listValidation: InstructionsListValidationConfig;
}

interface TracingBufferConfig {
  file?: string;
  sizeBytes: number;
  dumpOnExit: boolean;
}

interface TracingConfig {
  level: LogLevel | 'verbose';
  categories: Set<string>;
  buffer: TracingBufferConfig;
  file?: string;
  persist: boolean;
  dir: string;
  fsync: boolean;
  maxFileSizeBytes: number;
  sessionId?: string;
  callsite: boolean;
}

interface MutationConfig {
  enabled: boolean;
  legacyEnable: boolean;
  dispatcherTiming: boolean;
}

interface FeatureFlagsConfig {
  file: string;
  envNamespace: Record<string, string>;
  indexFeatures: Set<string>;
}

interface FeedbackConfig {
  dir: string;
  maxEntries: number;
}

interface MinimalConfig {
  debugOrdering: boolean;
}

interface BootstrapSeedConfig {
  autoSeed: boolean;
  verbose: boolean;
}

interface AtomicFsConfig {
  retries: number;
  backoffMs: number;
}

interface PreflightConfig {
  modules: string[];
  strict: boolean;
}

interface ValidationConfig {
  mode: string;
}

interface DynamicConfig {
  dashboardConfig: Record<string, string>;
  apiIntegration: Record<string, string>;
}

interface GraphConfig {
  includePrimaryEdges: boolean;
  largeCategoryCap: number;
  explicitIncludePrimaryEnv: boolean;
  explicitLargeCategoryEnv: boolean;
  signature: string;
}

export interface RuntimeConfig {
  profile: string;
  testMode: string | undefined;
  catalog: CatalogConfig;
  mutationEnabled: boolean;
  logLevel: LogLevel;
  trace: Set<string>;
  initFeatures: Set<string>;
  bufferRing: BufferRingConfig;
  timing: (key: string, fallback?: number) => number | undefined;
  rawTiming: TimingMap;
  coverage: CoverageConfig;
  dashboard: DashboardConfig;
  server: ServerConfig;
  logging: LoggingConfig;
  metrics: MetricsConfig;
  instructions: InstructionsConfig;
  tracing: TracingConfig;
  mutation: MutationConfig;
  featureFlags: FeatureFlagsConfig;
  feedback: FeedbackConfig;
  minimal: MinimalConfig;
  bootstrapSeed: BootstrapSeedConfig;
  atomicFs: AtomicFsConfig;
  preflight: PreflightConfig;
  validation: ValidationConfig;
  dynamic: DynamicConfig;
  graph: GraphConfig;
}

const deprecationNotices = new Set<string>();
function warnOnce(msg: string){
  if(!deprecationNotices.has(msg)){
    deprecationNotices.add(msg);
    // eslint-disable-next-line no-console
    console.warn(`[config:deprecation] ${msg}`);
  }
}

const CWD = process.cwd();

function toAbsolute(raw: string | undefined, fallback?: string): string {
  if(raw && raw.trim().length){
    return path.isAbsolute(raw) ? raw : path.resolve(CWD, raw);
  }
  if(fallback && fallback.trim().length){
    return path.isAbsolute(fallback) ? fallback : path.resolve(CWD, fallback);
  }
  return CWD;
}

function numberFromEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if(!raw) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

function optionalNumberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if(raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function floatFromEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if(!raw) return defaultValue;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

function optionalIntFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if(raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  if(value < min) return min;
  if(value > max) return max;
  return value;
}

function stringFromEnv(name: string, defaultValue: string): string {
  const raw = process.env[name];
  if(raw && raw.trim().length) return raw;
  return defaultValue;
}

function parseCsvEnv(name: string): string[] {
  const raw = process.env[name];
  if(!raw) return [];
    return raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

function parseJSONMaybe<T=unknown>(src?: string): T | undefined {
  if(!src) return undefined;
  try { return JSON.parse(src) as T; } catch { return undefined; }
}

function parseTiming(): TimingMap {
  const map: TimingMap = {};
  const timingSrc = process.env.MCP_TIMING_JSON;
  if(timingSrc){
    let obj: Record<string, unknown> | undefined;
    if(timingSrc.startsWith('{')) obj = parseJSONMaybe<Record<string, unknown>>(timingSrc);
    else if(fs.existsSync(timingSrc)) obj = parseJSONMaybe<Record<string, unknown>>(fs.readFileSync(timingSrc,'utf8'));
    if(obj && typeof obj === 'object'){
      for(const [k,v] of Object.entries(obj)){
        if(typeof v === 'number' && Number.isFinite(v)) map[k]=v;
      }
    }
  }
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
  if(process.env.SYN_ACTIVITY_READY_MS && map['synthetic.ready']===undefined){
    map['synthetic.ready']=Number(process.env.SYN_ACTIVITY_READY_MS);
    warnOnce('Use MCP_TIMING_JSON synthetic.ready instead of SYN_ACTIVITY_READY_MS');
  }
  if(process.env.SYN_ACTIVITY_DEADLINE_MS && map['synthetic.deadline']===undefined){
    map['synthetic.deadline']=Number(process.env.SYN_ACTIVITY_DEADLINE_MS);
    warnOnce('Use MCP_TIMING_JSON synthetic.deadline instead of SYN_ACTIVITY_DEADLINE_MS');
  }
  if(process.env.SYN_ACTIVITY_ITERATIONS && map['synthetic.iterations']===undefined){
    map['synthetic.iterations']=Number(process.env.SYN_ACTIVITY_ITERATIONS);
    warnOnce('Use MCP_TIMING_JSON synthetic.iterations instead of SYN_ACTIVITY_ITERATIONS');
  }
  if(process.env.SYN_ACTIVITY_CONCURRENCY && map['synthetic.concurrency']===undefined){
    map['synthetic.concurrency']=Number(process.env.SYN_ACTIVITY_CONCURRENCY);
    warnOnce('Use MCP_TIMING_JSON synthetic.concurrency instead of SYN_ACTIVITY_CONCURRENCY');
  }
  if(process.env.SMOKE_WAIT_ID_TIMEOUT_MS && map['smoke.waitId']===undefined){
    map['smoke.waitId']=Number(process.env.SMOKE_WAIT_ID_TIMEOUT_MS);
    warnOnce('Use MCP_TIMING_JSON smoke.waitId instead of SMOKE_WAIT_ID_TIMEOUT_MS');
  }
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
  const raw = process.env.MCP_TRACE;
  if(raw){
    raw.split(',').map(s=>s.trim()).filter(Boolean).forEach(v=>set.add(v));
  }
  const legacyMap: Record<string,string[]> = {
    MCP_HANDSHAKE_TRACE:['handshake'],
    MCP_INIT_FRAME_DIAG:['initFrame'],
    MCP_HEALTH_MIXED_DIAG:['healthMixed'],
    PORTABLE_HANDSHAKE_TRACE:['portableHandshake'],
    PORTABLE_CONNECT_TRACE:['portableConnect'],
    MCP_TRACE_DISPATCH_DIAG:['dispatchDiag'],
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
  const raw = process.env.MCP_INIT_FEATURES;
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
  if(process.env.MCP_ENABLE_MUTATION === '1'){
    warnOnce('Use MCP_MUTATION=1 instead of MCP_ENABLE_MUTATION');
    return true;
  }
  return false;
}

function parseCoverage(): CoverageConfig {
  const fast = process.env.FAST_COVERAGE === '1' || process.env.MCP_TEST_MODE === 'coverage-fast';
  const hardMin = process.env.COVERAGE_HARD_MIN ? Number(process.env.COVERAGE_HARD_MIN) : undefined;
  const target = process.env.COVERAGE_TARGET ? Number(process.env.COVERAGE_TARGET) : undefined;
  const strictMode = parseBooleanEnv(process.env.COVERAGE_STRICT, process.env.MCP_TEST_MODE === 'coverage-strict');
  return { hardMin, target, fastMode: fast, strictMode };
}

function resolveInstructionsAuditLog(): InstructionsAuditLogConfig {
  const defaultPath = toAbsolute(path.join('logs', 'instruction-transactions.log.jsonl'));
  const raw = process.env.INSTRUCTIONS_AUDIT_LOG;
  if(raw === undefined || raw.trim().length === 0){
    return { enabled: true, file: defaultPath, rawValue: undefined, usesDefault: true };
  }
  const trimmed = raw.trim();
  const normalized = trimmed.toLowerCase();
  if(['0','false','no','off','disabled','none'].includes(normalized)){
    return { enabled: false, rawValue: raw, usesDefault: false };
  }
  const defaultRequested = trimmed === '1' || ['true','on','yes','default'].includes(normalized);
  return {
    enabled: true,
    file: defaultRequested ? defaultPath : toAbsolute(trimmed),
    rawValue: raw,
    usesDefault: defaultRequested || trimmed.length === 0,
  };
}

function resolveInstructionsDir(): string {
  const raw = process.env.MCP_INSTRUCTIONS_DIR || process.env.INSTRUCTIONS_DIR;
  const fallback = path.join(CWD, 'instructions');
  return toAbsolute(raw, fallback);
}

function parseCatalogConfig(): CatalogConfig {
  const baseDir = resolveInstructionsDir();
  const normalizationRaw = process.env.MCP_CATALOG_NORMALIZATION_LOG;
  let normalizationLog: string | boolean | undefined;
  if(normalizationRaw){
    const lowered = normalizationRaw.toLowerCase();
    if(['0','false','no','off'].includes(lowered)) normalizationLog = false;
    else if(['1','true','yes','on'].includes(lowered)) normalizationLog = toAbsolute(path.join('logs','catalog-normalization.log'));
    else normalizationLog = toAbsolute(normalizationRaw);
  }
  const memoizeRaw = process.env.MCP_CATALOG_MEMOIZE;
  const attempts = numberFromEnv('MCP_READ_RETRIES', 3);
  const backoffMs = numberFromEnv('MCP_READ_BACKOFF_MS', 8);
  const usageFlushMs = numberFromEnv('MCP_USAGE_FLUSH_MS', 75);
  const hashHardeningEnabled = parseBooleanEnv(process.env.MCP_GOV_HASH_HARDENING, true);
  const canonVariantsRaw = optionalIntFromEnv('MCP_GOV_HASH_CANON_VARIANTS');
  const importSetSizeRaw = optionalIntFromEnv('MCP_GOV_HASH_IMPORT_SET_SIZE');
  const hashCanonVariants = clamp(canonVariantsRaw ?? 1, 1, 8);
  const hashImportSetSize = clamp(importSetSizeRaw ?? 2, 2, 5);
  const maxFiles = optionalIntFromEnv('MCP_CATALOG_MAX_FILES'); // undefined = no limit
  const loadWarningThreshold = optionalIntFromEnv('MCP_CATALOG_LOAD_WARN_MS'); // undefined = no warning
  return {
    mode: deriveCatalogMode(),
    baseDir,
    reloadAlways: getBooleanEnv('INSTRUCTIONS_ALWAYS_RELOAD'),
    memoize: getBooleanEnv('MCP_CATALOG_MEMOIZE'),
    memoizeDisabledExplicitly: memoizeRaw !== undefined ? ['0','false','no','off'].includes(memoizeRaw.toLowerCase().trim()) : false,
    memoizeHash: getBooleanEnv('MCP_CATALOG_MEMOIZE_HASH'),
    normalizationLog,
    fileTrace: getBooleanEnv('MCP_CATALOG_FILE_TRACE'),
    eventSilent: getBooleanEnv('MCP_CATALOG_EVENT_SILENT'),
    readRetries: { attempts, backoffMs },
    usageFlushMs,
    disableUsageClamp: getBooleanEnv('MCP_DISABLE_USAGE_CLAMP'),
    govHash: {
      trailingNewline: getBooleanEnv('GOV_HASH_TRAILING_NEWLINE'),
      hashHardeningEnabled,
      hashCanonVariants,
      hashImportSetSize,
    },
    maxFiles,
    loadWarningThreshold,
  };
}

function parseDashboardConfig(mutationEnabled: boolean, catalogConfig: CatalogConfig): DashboardConfig {
  const persistenceDefaults = DEFAULT_SESSION_PERSISTENCE_CONFIG;
  const persistenceEnv = SESSION_PERSISTENCE_ENV_VARS;
  const persistenceEnabled = parseBooleanEnv(process.env[persistenceEnv.ENABLED], persistenceDefaults.enabled);
  const persistenceDir = toAbsolute(process.env[persistenceEnv.PERSISTENCE_DIR], persistenceDefaults.persistenceDir);
  const persistenceInterval = numberFromEnv(persistenceEnv.PERSISTENCE_INTERVAL_MS, persistenceDefaults.persistence.intervalMs);
  const backupsDir = toAbsolute(process.env.MCP_BACKUPS_DIR, path.join(CWD, 'backups'));
  return {
    http: {
      enable: getBooleanEnv('MCP_DASHBOARD'),
      port: numberFromEnv('MCP_DASHBOARD_PORT', 8787),
      host: stringFromEnv('MCP_DASHBOARD_HOST', '127.0.0.1'),
      maxPortTries: Math.max(1, numberFromEnv('MCP_DASHBOARD_TRIES', 10)),
      enableHttpMetrics: getBooleanEnv('MCP_HTTP_METRICS', true),
      requestTimeoutMs: numberFromEnv('MCP_REQUEST_TIMEOUT', 30000),
      maxConnections: numberFromEnv('MCP_MAX_CONNECTIONS', 100),
      verboseLogging: getBooleanEnv('MCP_VERBOSE_LOGGING') || getBooleanEnv('MCP_LOG_VERBOSE'),
      mutationEnabled,
    },
    admin: {
      maxSessionHistory: numberFromEnv('MCP_ADMIN_MAX_SESSION_HISTORY', 200),
      backupsDir,
      instructionsDir: catalogConfig.baseDir,
    },
    sessionPersistence: {
      enabled: persistenceEnabled,
      persistenceDir,
      backupIntegration: parseBooleanEnv(process.env[persistenceEnv.BACKUP_INTEGRATION], persistenceDefaults.backupIntegration),
      retention: {
        maxHistoryEntries: numberFromEnv(persistenceEnv.MAX_HISTORY_ENTRIES, persistenceDefaults.retention.maxHistoryEntries),
        maxHistoryDays: numberFromEnv(persistenceEnv.MAX_HISTORY_DAYS, persistenceDefaults.retention.maxHistoryDays),
        maxConnectionHistoryDays: numberFromEnv(persistenceEnv.MAX_CONNECTION_HISTORY_DAYS, persistenceDefaults.retention.maxConnectionHistoryDays),
      },
      persistenceIntervalMs: persistenceInterval,
      deduplicationEnabled: parseBooleanEnv(process.env[persistenceEnv.DEDUPLICATION_ENABLED], persistenceDefaults.deduplication.enabled),
    },
  };
}

function parseServerConfig(): ServerConfig {
  const sharedSentinel = process.env.MCP_SHARED_SERVER_SENTINEL;
  return {
    disableEarlyStdinBuffer: getBooleanEnv('MCP_DISABLE_EARLY_STDIN_BUFFER'),
    fatalExitDelayMs: numberFromEnv('MCP_FATAL_EXIT_DELAY_MS', 15),
    idleKeepaliveMs: numberFromEnv('MCP_IDLE_KEEPALIVE_MS', 30000),
    sharedSentinel: sharedSentinel && sharedSentinel.trim().length ? sharedSentinel : undefined,
    bootstrap: {
      autoconfirm: getBooleanEnv('MCP_BOOTSTRAP_AUTOCONFIRM'),
      tokenTtlSec: numberFromEnv('MCP_BOOTSTRAP_TOKEN_TTL_SEC', 900),
      referenceMode: getBooleanEnv('MCP_REFERENCE_MODE'),
    },
    catalogPolling: {
      enabled: getBooleanEnv('MCP_ENABLE_CATALOG_POLLER'),
      proactive: getBooleanEnv('MCP_CATALOG_POLL_PROACTIVE'),
      intervalMs: numberFromEnv('MCP_CATALOG_POLL_MS', 10000),
    },
    multicoreTrace: getBooleanEnv('MULTICLIENT_TRACE'),
  };
}

function resolveLogFile(): { file?: string; raw?: string; sentinelRequested: boolean } {
  const raw = process.env.MCP_LOG_FILE;
  if(!raw) return { raw: undefined, sentinelRequested: false };
  const normalized = raw.trim().toLowerCase();
  const isSentinel = raw === '1' || ['true','yes','on'].includes(normalized);
  if(isSentinel){
    return {
      file: toAbsolute(path.join('logs','mcp-server.log')),
      raw,
      sentinelRequested: true,
    };
  }
  return { file: toAbsolute(raw), raw, sentinelRequested: false };
}

function parseLoggingConfig(level: LogLevel): LoggingConfig {
  const fileInfo = resolveLogFile();
  return {
    level,
    verbose: getBooleanEnv('MCP_VERBOSE_LOGGING') || getBooleanEnv('MCP_LOG_VERBOSE') || getBooleanEnv('MCP_DEBUG'),
    json: getBooleanEnv('MCP_LOG_JSON'),
    sync: getBooleanEnv('MCP_LOG_SYNC'),
    diagnostics: getBooleanEnv('MCP_LOG_DIAG'),
    protocol: getBooleanEnv('MCP_LOG_PROTOCOL'),
    file: fileInfo.file,
    rawFileValue: fileInfo.raw,
    sentinelRequested: fileInfo.sentinelRequested,
  };
}

function parseMetricsConfig(): MetricsConfig {
  return {
    dir: toAbsolute(process.env.MCP_METRICS_DIR, path.join(CWD, 'metrics')),
    resourceCapacity: numberFromEnv('MCP_RESOURCE_CAPACITY', 720),
    sampleIntervalMs: numberFromEnv('MCP_RESOURCE_SAMPLE_INTERVAL_MS', 5000),
    toolcall: {
      chunkSize: numberFromEnv('MCP_TOOLCALL_CHUNK_SIZE', 250),
      flushMs: numberFromEnv('MCP_TOOLCALL_FLUSH_MS', 5000),
      compactMs: numberFromEnv('MCP_TOOLCALL_COMPACT_MS', 300000),
      appendLogEnabled: getBooleanEnv('MCP_TOOLCALL_APPEND_LOG'),
    },
    health: {
      memoryThreshold: floatFromEnv('MCP_HEALTH_MEMORY_THRESHOLD', 0.95),
      errorRateThreshold: floatFromEnv('MCP_HEALTH_ERROR_THRESHOLD', 10),
      minUptimeMs: numberFromEnv('MCP_HEALTH_MIN_UPTIME', 1000),
    },
    fileStorage: getBooleanEnv('MCP_METRICS_FILE_STORAGE'),
  };
}

function parseInstructionsConfig(mutationEnabled: boolean): InstructionsConfig {
  const auditLog = resolveInstructionsAuditLog();
  const workspaceId = process.env.WORKSPACE_ID || process.env.INSTRUCTIONS_WORKSPACE;
  const manifestWriteRaw = process.env.MCP_MANIFEST_WRITE;
  const manifestWriteEnabled = manifestWriteRaw === undefined ? true : !['0','false','no','off'].includes(manifestWriteRaw.toLowerCase());
  const forceFullList = getBooleanEnv('FULL_LIST_GET') || getBooleanEnv('MCP_STRESS_MODE');
  const legacyMaxValidate = optionalIntFromEnv('LIST_GET_MAX_VALIDATE');
  const sampleOverride = optionalIntFromEnv('LIST_GET_SAMPLE_SIZE');
  const effectiveSampleSize = legacyMaxValidate ?? sampleOverride;
  const sampleSeed = optionalIntFromEnv('LIST_GET_SAMPLE_SEED');
  const concurrency = clamp(optionalIntFromEnv('LIST_GET_CONCURRENCY') ?? 8, 1, 64);
  const maxDurationMs = Math.max(500, optionalIntFromEnv('LIST_GET_MAX_DURATION_MS') ?? 7000);
  return {
    workspaceId: workspaceId && workspaceId.trim().length ? workspaceId : undefined,
    agentId: process.env.MCP_AGENT_ID || undefined,
    canonicalDisable: getBooleanEnv('MCP_CANONICAL_DISABLE'),
    strictVisibility: getBooleanEnv('MCP_TEST_STRICT_VISIBILITY'),
    strictCreate: getBooleanEnv('MCP_INSTRUCTIONS_STRICT_CREATE'),
    strictRemove: getBooleanEnv('MCP_INSTRUCTIONS_STRICT_REMOVE'),
    requireCategory: getBooleanEnv('MCP_REQUIRE_CATEGORY'),
    traceQueryDiag: getBooleanEnv('MCP_TRACE_QUERY_DIAG'),
    manifest: {
      writeEnabled: manifestWriteEnabled,
      fastload: getBooleanEnv('MCP_MANIFEST_FASTLOAD'),
    },
    mutationEnabledLegacy: getBooleanEnv('MCP_ENABLE_MUTATION') || mutationEnabled,
    ciContext: {
      inCI: !!process.env.CI,
      githubActions: !!process.env.GITHUB_ACTIONS,
      tfBuild: !!process.env.TF_BUILD,
    },
    auditLog,
    listValidation: {
      forceFullScan: forceFullList,
      allowSampling: !forceFullList,
      effectiveSampleSize,
      sampleSeed,
      concurrency,
      maxDurationMs,
    },
  };
}

function resolveTraceLevel(traceSet: Set<string>, fallbackLevel: LogLevel): LogLevel | 'verbose' {
  const raw = process.env.MCP_TRACE_LEVEL?.toLowerCase();
  switch(raw){
    case 'verbose': return 'verbose';
    case 'trace':
    case 'files':
    case 'perf':
      return 'trace';
    case 'debug':
    case 'core':
      return 'debug';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    default:
      if(traceSet.has('verbose')) return 'verbose';
      if(traceSet.size > 0) return 'trace';
      return fallbackLevel;
  }
}

function resolveTracingBuffer(): TracingBufferConfig {
  const rawFile = process.env.MCP_TRACE_BUFFER_FILE;
  const trimmed = rawFile?.trim();
  const file = trimmed && trimmed.length ? toAbsolute(trimmed) : undefined;
  const sizeBytes = optionalNumberFromEnv('MCP_TRACE_BUFFER_SIZE') ?? 0;
  const dumpOnExit = getBooleanEnv('MCP_TRACE_BUFFER_DUMP_ON_EXIT');
  return { file, sizeBytes, dumpOnExit };
}

function parseTracingConfig(traceSet: Set<string>, fallbackLevel: LogLevel): TracingConfig {
  const categories = new Set(parseCsvEnv('MCP_TRACE_CATEGORIES'));
  const buffer = resolveTracingBuffer();
  const filePath = (() => {
    const raw = process.env.MCP_TRACE_FILE;
    if(!raw) return undefined;
    const trimmed = raw.trim();
    return trimmed.length ? toAbsolute(trimmed) : undefined;
  })();
  return {
    level: resolveTraceLevel(traceSet, fallbackLevel),
    categories,
    buffer,
    file: filePath,
    persist: parseBooleanEnv(process.env.MCP_TRACE_PERSIST, !!filePath),
    dir: toAbsolute(process.env.MCP_TRACE_DIR, path.join(CWD, 'logs', 'trace')),
    fsync: getBooleanEnv('MCP_TRACE_FSYNC'),
    maxFileSizeBytes: optionalIntFromEnv('MCP_TRACE_MAX_FILE_SIZE') ?? 0,
    sessionId: process.env.MCP_TRACE_SESSION || process.env.MCP_TRACE_SESSION_ID || undefined,
    callsite: getBooleanEnv('MCP_TRACE_CALLSITE'),
  };
}

function parseMutationConfig(mutationEnabled: boolean): MutationConfig {
  return {
    enabled: mutationEnabled,
    legacyEnable: getBooleanEnv('MCP_ENABLE_MUTATION'),
    dispatcherTiming: getBooleanEnv('MCP_ADD_TIMING'),
  };
}

function parseFeatureFlagsConfig(): FeatureFlagsConfig {
  const envNamespace: Record<string, string> = {};
  for(const [key, value] of Object.entries(process.env)){
    if(key.startsWith('MCP_FLAG_') && typeof value === 'string'){
      envNamespace[key.substring('MCP_FLAG_'.length).toLowerCase()] = value;
    }
  }
  return {
    file: toAbsolute(process.env.MCP_FLAGS_FILE, path.join(CWD, 'flags.json')),
    envNamespace,
    indexFeatures: new Set(parseCsvEnv('INDEX_FEATURES')),
  };
}

function parseFeedbackConfig(): FeedbackConfig {
  return {
    dir: toAbsolute(process.env.FEEDBACK_DIR, path.join(CWD, 'feedback')),
    maxEntries: numberFromEnv('FEEDBACK_MAX_ENTRIES', 1000),
  };
}

function parseMinimalConfig(): MinimalConfig {
  return {
    debugOrdering: getBooleanEnv('MCP_MINIMAL_DEBUG'),
  };
}

function parseBootstrapSeedConfig(): BootstrapSeedConfig {
  return {
    autoSeed: process.env.MCP_AUTO_SEED === undefined ? true : process.env.MCP_AUTO_SEED !== '0',
    verbose: getBooleanEnv('MCP_SEED_VERBOSE'),
  };
}

function parseAtomicFsConfig(): AtomicFsConfig {
  return {
    retries: numberFromEnv('MCP_ATOMIC_WRITE_RETRIES', 5),
    backoffMs: numberFromEnv('MCP_ATOMIC_WRITE_BACKOFF_MS', 10),
  };
}

function parsePreflightConfig(): PreflightConfig {
  const modules = parseCsvEnv('MCP_PREFLIGHT_MODULES');
  return {
    modules: modules.length ? modules : ['mime-db','ajv','ajv-formats'],
    strict: getBooleanEnv('MCP_PREFLIGHT_STRICT'),
  };
}

function parseValidationConfig(): ValidationConfig {
  return {
    mode: (process.env.MCP_VALIDATION_MODE || 'zod').toLowerCase(),
  };
}

function parseDynamicConfig(): DynamicConfig {
  return {
    dashboardConfig: {},
    apiIntegration: {},
  };
}

function parseGraphConfig(): GraphConfig {
  const includeRaw = process.env.GRAPH_INCLUDE_PRIMARY_EDGES;
  const includePrimaryEdges = includeRaw === undefined ? true : parseBooleanEnv(includeRaw, true);
  const largeRaw = process.env.GRAPH_LARGE_CATEGORY_CAP;
  let largeCategoryCap = Number.POSITIVE_INFINITY;
  let explicitLargeCategoryEnv = false;
  if(largeRaw && largeRaw.trim().length){
    const parsed = Number.parseInt(largeRaw, 10);
    if(Number.isFinite(parsed) && parsed >= 0){
      largeCategoryCap = parsed;
    }
    explicitLargeCategoryEnv = true;
  }
  const explicitIncludePrimaryEnv = includeRaw !== undefined;
  const signature = `${includePrimaryEdges ? 'P1' : 'P0'}:${explicitLargeCategoryEnv ? largeCategoryCap : 'INF'}`;
  return {
    includePrimaryEdges,
    largeCategoryCap,
    explicitIncludePrimaryEnv,
    explicitLargeCategoryEnv,
    signature,
  };
}

export function loadRuntimeConfig(): RuntimeConfig {
  const profile = process.env.MCP_PROFILE || 'default';
  const testMode = process.env.MCP_TEST_MODE;
  const rawTiming = parseTiming();
  const trace = parseTrace();
  const initFeatures = parseInitFeatures();
  const logLevel = parseLogLevel(trace);
  const mutationEnabled = parseMutation();
  const catalog = parseCatalogConfig();
  const dashboard = parseDashboardConfig(mutationEnabled, catalog);
  const server = parseServerConfig();
  const logging = parseLoggingConfig(logLevel);
  const metrics = parseMetricsConfig();
  const instructions = parseInstructionsConfig(mutationEnabled);
  const tracing = parseTracingConfig(trace, logLevel);
  const mutation = parseMutationConfig(mutationEnabled);
  const featureFlags = parseFeatureFlagsConfig();
  const feedback = parseFeedbackConfig();
  const minimal = parseMinimalConfig();
  const bootstrapSeed = parseBootstrapSeedConfig();
  const atomicFs = parseAtomicFsConfig();
  const preflight = parsePreflightConfig();
  const validation = parseValidationConfig();
  const dynamic = parseDynamicConfig();
  const graph = parseGraphConfig();
  return {
    profile,
    testMode,
    catalog,
    mutationEnabled: mutation.enabled,
    logLevel,
    trace,
    initFeatures,
    bufferRing: parseBufferRing(),
    timing: (key: string, fallback?: number) => rawTiming[key] ?? fallback,
    rawTiming,
    coverage: parseCoverage(),
    dashboard,
    server,
    logging,
    metrics,
    instructions,
    tracing,
    mutation,
    featureFlags,
    feedback,
    minimal,
    bootstrapSeed,
    atomicFs,
    preflight,
    validation,
    dynamic,
    graph,
  };
}

let _cached: RuntimeConfig | undefined;
export function getRuntimeConfig(): RuntimeConfig {
  if(!_cached) _cached = loadRuntimeConfig();
  return _cached;
}

export function reloadRuntimeConfig(): RuntimeConfig {
  _cached = loadRuntimeConfig();
  return _cached;
}

if(require.main === module){
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(getRuntimeConfig(), null, 2));
}
