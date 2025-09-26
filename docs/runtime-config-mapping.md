# Runtime Configuration Migration Map

This document captures the proposed shape for expanding `runtimeConfig` so the remaining `process.env` reads in runtime code can be consolidated behind a single typed surface. The intent is to provide a reference for both implementation and code reviews while the migration proceeds.

## Design principles

1. **Single source of truth** – all runtime code imports configuration through `getRuntimeConfig()` (or a typed helper) instead of touching `process.env` directly.
2. **Stable namespaces** – group related concerns (dashboard, catalog, tracing, etc.) under nested objects so call sites stay expressive.
3. **Typed defaults** – each entry specifies type, default value, and whether the default mirrors current behavior.
4. **Graceful legacy handling** – retain compatibility by reading legacy variables when building the config, but emit `warnOnce` deprecations to encourage the new consolidated keys.
5. **Dynamic escape hatches** – for areas that intentionally need arbitrary environment reads (e.g., integrations), keep explicit allowlists and helper wrappers to avoid wholesale `process.env` access.

## Proposed `runtimeConfig` shape

```ts
export interface RuntimeConfig {
  // ...existing properties...
  dashboard: {
    http: {
      enable: boolean;
      port: number;
      host: string;
      maxPortTries: number;
      enableHttpMetrics: boolean;
      requestTimeoutMs: number;
      maxConnections: number;
      verboseLogging: boolean;
      mutationEnabled: boolean;
    };
    admin: {
      maxSessionHistory: number;
      backupsDir: string;
      instructionsDir: string;
    };
    sessionPersistence: {
      enabled: boolean;
      persistenceDir?: string;
      backupIntegration: boolean;
      retention: {
        maxHistoryEntries?: number;
        maxHistoryDays?: number;
        maxConnectionHistoryDays?: number;
      };
      persistenceIntervalMs?: number;
      deduplicationEnabled: boolean;
    };
  };
  server: {
    disableEarlyStdinBuffer: boolean;
    fatalExitDelayMs: number;
    idleKeepaliveMs: number;
    sharedSentinel?: string;
    bootstrap: {
      autoconfirm: boolean;
      tokenTtlSec: number;
      referenceMode: boolean;
    };
    catalogPolling: {
      enabled: boolean;
      proactive: boolean;
      intervalMs: number;
    };
    multicoreTrace: boolean;
  };
  logging: {
    fileTarget?: string | { path: string; sentinel: boolean };
    json: boolean;
    sync: boolean;
    diagnostics: boolean;
  };
  metrics: {
    resourceCapacity: number;
    sampleIntervalMs: number;
    toolcall: {
      chunkSize: number;
      flushMs: number;
      compactMs: number;
    };
    dir: string;
  };
  catalog: {
    baseDir: string;
    reloadAlways: boolean;
    memoize: boolean;
    memoizeHash: boolean;
    normalizationLog?: string | boolean;
    fileTrace: boolean;
    eventSilent: boolean;
    readRetries: {
      attempts: number;
      backoffMs: number;
    };
    usageFlushMs: number;
    disableUsageClamp: boolean;
    govHash: {
      trailingNewline: boolean;
    };
  };
  instructions: {
    workspaceId?: string;
    agentId?: string;
    strictVisibility: boolean;
    strictCreate: boolean;
    strictRemove: boolean;
    requireCategory: boolean;
    traceQueryDiag: boolean;
    manifest: {
      writeEnabled: boolean;
      fastload: boolean;
      canonicalDisable: boolean;
    };
    canonicalDisable: boolean;
    mutationEnabledLegacy: boolean;
    ciContext: {
      inCI: boolean;
      githubActions: boolean;
      tfBuild: boolean;
    };
  };
  tracing: {
    level: 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'verbose';
    categories: Set<string>;
    buffer: {
      file?: string;
      sizeBytes: number;
      dumpOnExit: boolean;
    };
    file?: string;
    persist: boolean;
    dir: string;
    fsync: boolean;
    maxFileSizeBytes: number;
    sessionId?: string;
    callsite: boolean;
  };
  mutation: {
    enabled: boolean;
    dispatcherTiming: boolean;
  };
  featureFlags: {
    file: string;
    envNamespace: Record<string, string | number | boolean>;
    indexFeatures: Set<string>;
  };
  feedback: {
    dir: string;
    maxEntries: number;
  };
  bootstrapSeed: {
    autoSeed: boolean;
    verbose: boolean;
  };
  bufferRing: {
    append: boolean;
    preload: boolean;
  };
  atomicFs: {
    retries: number;
    backoffMs: number;
  };
  preflight: {
    modules: string[];
    strict: boolean;
  };
  validation: {
    mode: 'zod' | 'ajv' | string;
  };
  dynamic: {
    /** Reserved spots for modules that accept runtime-provided env keys */
    dashboardConfig: Record<string, string>;
    apiIntegration: Record<string, string>;
  };
}
```

> **Note:** The interface above illustrates the target namespace. We do not need to implement everything up front; the migration can proceed incrementally, populating each group as the associated module is refactored.

## Variable-by-module mapping

| Module | Environment variables | Proposed config path | Type / default | Notes |
| --- | --- | --- | --- | --- |
| `dashboard/server/AdminPanel.ts` | `MCP_ADMIN_MAX_SESSION_HISTORY`, `MCP_BACKUPS_DIR`, `MCP_INSTRUCTIONS_DIR`, `MCP_MAX_CONNECTIONS`, `MCP_REQUEST_TIMEOUT`, `MCP_VERBOSE_LOGGING`, `MCP_MUTATION`, `MCP_ENABLE_MUTATION` | `dashboard.admin.maxSessionHistory`, `dashboard.admin.backupsDir`, `catalog.baseDir`, `dashboard.http.maxConnections`, `dashboard.http.requestTimeoutMs`, `dashboard.http.verboseLogging`, `instructions.mutationEnabledLegacy` | numbers / booleans / strings with existing fallbacks | Ensure mutation toggle mirrors overall mutation enablement in `mutation.enabled`. |
| `dashboard/server/ApiRoutes.ts` | `MCP_HTTP_METRICS`, `MCP_HEALTH_MEMORY_THRESHOLD`, `MCP_HEALTH_ERROR_THRESHOLD`, `MCP_HEALTH_MIN_UPTIME`, `MCP_INSTRUCTIONS_DIR`, `MCP_LOG_FILE`, `MCP_DEBUG` | `dashboard.http.enableHttpMetrics`, `metrics.health.memoryThreshold`, `metrics.health.errorThreshold`, `metrics.health.minUptimeMs`, `catalog.baseDir`, `logging.fileTarget`, `logging.verbose` | types align with existing parse usage | Introduce new health-specific sub-object under `metrics` for clarity. |
| `dashboard/server/MetricsCollector.ts` | `MCP_RESOURCE_CAPACITY`, `MCP_RESOURCE_SAMPLE_INTERVAL_MS`, `MCP_METRICS_DIR`, `MCP_TOOLCALL_CHUNK_SIZE`, `MCP_TOOLCALL_FLUSH_MS`, `MCP_TOOLCALL_COMPACT_MS` | `metrics.resourceCapacity`, `metrics.sampleIntervalMs`, `metrics.dir`, `metrics.toolcall.chunkSize`, `metrics.toolcall.flushMs`, `metrics.toolcall.compactMs` | integers | Defaults continue to mirror hard-coded values. |
| `dashboard/server/SessionPersistenceManager.ts` | computed enum keys (e.g., `SESSION_PERSISTENCE_*`) | `dashboard.sessionPersistence.*` | boolean/number/string | Add helper to resolve keys from config rather than indexing into `process.env`. |
| `dashboard/server/WebSocketManager.ts` | `MCP_DEBUG`, `MCP_VERBOSE_LOGGING` | `logging.verbose` | boolean | Share with other verbose logging checks. |
| `server/index.ts` | `MCP_DISABLE_EARLY_STDIN_BUFFER`, `MCP_FATAL_EXIT_DELAY_MS`, `MCP_DASHBOARD`, `MCP_DASHBOARD_PORT`, `MCP_DASHBOARD_HOST`, `MCP_DASHBOARD_TRIES`, `MCP_MUTATION`, `MCP_ENABLE_MUTATION`, `MCP_BOOTSTRAP_AUTOCONFIRM`, `MCP_ENABLE_CATALOG_POLLER`, `MCP_CATALOG_POLL_PROACTIVE`, `MCP_IDLE_KEEPALIVE_MS`, `MCP_LOG_FILE`, `MCP_SHARED_SERVER_SENTINEL`, `MULTICLIENT_TRACE` | `server.disableEarlyStdinBuffer`, `server.fatalExitDelayMs`, `dashboard.http.enable`, `dashboard.http.port`, `dashboard.http.host`, `dashboard.http.maxPortTries`, `mutation.enabled`, `mutation.legacyEnable`, `server.bootstrap.autoconfirm`, `server.catalogPolling.enabled`, `server.catalogPolling.proactive`, `server.idleKeepaliveMs`, `logging.fileTarget`, `server.sharedSentinel`, `server.multicoreTrace` | boolean/number/string | `mutation.legacyEnable` feeds deprecation warning; prefer `mutation.enabled`. |
| `server/sdkServer.ts` | handshake / diag toggles (`MCP_HANDSHAKE_TRACE`, `MCP_HEALTH_MIXED_DIAG`, etc.) | `tracing.handshake`, `tracing.healthMixedDiag`, `tracing.initFallbackAllow`, `tracing.initFrameDiag` | boolean | Extend `tracing` group with feature-specific flags. |
| `services/catalogContext.ts` | `INSTRUCTIONS_DIR`, `MCP_CATALOG_POLL_MS`, `MCP_CATALOG_POLL_PROACTIVE`, `MCP_USAGE_FLUSH_MS`, `MCP_DISABLE_USAGE_CLAMP`, `GOV_HASH_TRAILING_NEWLINE` | `catalog.baseDir`, `server.catalogPolling.intervalMs`, `server.catalogPolling.proactive`, `catalog.usageFlushMs`, `catalog.disableUsageClamp`, `catalog.govHash.trailingNewline` | string/number/boolean | `catalog.baseDir` will be shared with dashboard/admin. |
| `services/catalogLoader.ts` | `INSTRUCTIONS_ALWAYS_RELOAD`, `MCP_CATALOG_MEMOIZE`, `MCP_CATALOG_MEMOIZE_HASH`, `MCP_CATALOG_NORMALIZATION_LOG`, `MCP_CATALOG_FILE_TRACE`, `MCP_CATALOG_EVENT_SILENT`, `MCP_READ_RETRIES`, `MCP_READ_BACKOFF_MS` | `catalog.reloadAlways`, `catalog.memoize`, `catalog.memoizeHash`, `catalog.normalizationLog`, `catalog.fileTrace`, `catalog.eventSilent`, `catalog.readRetries.attempts`, `catalog.readRetries.backoffMs` | boolean/string/number | Defaults align with status quo. |
| `services/featureFlags.ts` | `MCP_FLAGS_FILE` and generic `process.env` iteration | `featureFlags.file`, `featureFlags.envNamespace` | string / record | Provide filtered view of env for features rather than raw `process.env`. |
| `services/features.ts` | `INDEX_FEATURES` | `featureFlags.indexFeatures` | `Set<string>` | Align with configuration collection. |
| `services/handlers.feedback.ts` | `FEEDBACK_DIR`, `FEEDBACK_MAX_ENTRIES` | `feedback.dir`, `feedback.maxEntries` | string/number | Already consistent with new feedback subsystem. |
| `services/handlers.graph.ts` | `GRAPH_INCLUDE_PRIMARY_EDGES`, `GRAPH_LARGE_CATEGORY_CAP`, dynamic lookups | `graph.includePrimaryEdges`, `graph.largeCategoryCap`, `dynamic.dashboardConfig` | boolean/number | Provide targeted config group; dynamic map handles arbitrary overrides. |
| `services/handlers.instructions.ts` | `MCP_AGENT_ID`, `WORKSPACE_ID`, `INSTRUCTIONS_WORKSPACE`, `MCP_CANONICAL_DISABLE`, `MCP_REQUIRE_CATEGORY`, `MCP_INSTRUCTIONS_STRICT_*`, `MCP_TEST_STRICT_VISIBILITY`, `MCP_TRACE_QUERY_DIAG`, `MCP_MANIFEST_WRITE`, `CI`, `GITHUB_ACTIONS`, `TF_BUILD`, `MCP_ENABLE_MUTATION`, `MCP_MUTATION` | `instructions.agentId`, `instructions.workspaceId`, `instructions.canonicalDisable`, `instructions.requireCategory`, `instructions.strictCreate`, `instructions.strictRemove`, `instructions.strictVisibility`, `instructions.traceQueryDiag`, `instructions.manifest.writeEnabled`, `instructions.ciContext`, `mutation.enabled` | boolean/string | Provide aggregated `ciContext` structure and reuse `mutation.enabled`. |
| `services/instructions.dispatcher.ts` | `MCP_ENABLE_MUTATION`, `MCP_ADD_TIMING`, `MCP_LOG_VERBOSE`, `MCP_TRACE_DISPATCH_DIAG`, `npm_package_version` | `mutation.enabled`, `mutation.dispatcherTiming`, `logging.verbose`, `tracing.dispatchDiag`, `app.version` | boolean/string | `app.version` can come from package metadata once in config. |
| `services/logger.ts` | `MCP_LOG_FILE`, `MCP_LOG_JSON`, `MCP_LOG_SYNC` | `logging.fileTarget`, `logging.json`, `logging.sync` | string/boolean | Consolidated logging group shared across modules. |
| `services/manifestManager.ts` | `MCP_MANIFEST_WRITE`, `MCP_MANIFEST_FASTLOAD` | `instructions.manifest.writeEnabled`, `instructions.manifest.fastload` | boolean | Already conceptually grouped with instructions. |
| `services/preflight.ts` | `MCP_PREFLIGHT_MODULES`, `MCP_PREFLIGHT_STRICT` | `preflight.modules`, `preflight.strict` | string[]/boolean | Modules produced by splitting the comma list. |
| `services/seedBootstrap.ts` | `MCP_AUTO_SEED`, `MCP_SEED_VERBOSE` | `bootstrapSeed.autoSeed`, `bootstrapSeed.verbose` | boolean | Continue to drive automated seeding behavior. |
| `services/atomicFs.ts` | `MCP_ATOMIC_WRITE_RETRIES`, `MCP_ATOMIC_WRITE_BACKOFF_MS` | `atomicFs.retries`, `atomicFs.backoffMs` | number | Used by atomic write helper. |
| `services/tracing.ts` | `MCP_TRACE_*`, `MCP_TRACE_DIR`, `MCP_TRACE_FILE`, `MCP_TRACE_BUFFER_*`, `MCP_TRACE_LEVEL`, `MCP_TRACE_MAX_FILE_SIZE`, `MCP_TRACE_SESSION`, `MCP_TRACE_SESSION_ID`, `MCP_TRACE_CALLSITE`, `MCP_TRACE_PERSIST`, `MCP_TRACE_FSYNC` | `tracing.*` | mixed | Entire tracing subsystem collapses under the `tracing` object. |
| `utils/BufferRing.ts` | `BUFFER_RING_APPEND`, `BUFFER_RING_APPEND_PRELOAD` | `bufferRing.append`, `bufferRing.preload` | boolean | Already partially handled in existing config; ensure utilities consume it via config. |
| `utils/memoryMonitor.ts` | `MCP_DEBUG`, `MCP_VERBOSE_LOGGING` | `logging.verbose` | boolean | Maintain parity with other logging consumers. |
| `utils/envUtils.ts`, `dashboard/integration/APIIntegration.ts`, `handlers.dashboardConfig.ts` | dynamic string lookups | `dynamic.dashboardConfig`, `dynamic.apiIntegration` (string-to-string map) | object | Provide controlled map populated from explicit allowlists to retain flexibility without raw env access. |

## Handling dynamic access patterns

Some modules (notably `APIIntegration`, `SessionPersistenceManager`, and `handlers.dashboardConfig`) rely on dynamic environment variable keys determined at runtime.

To manage these safely:

- **Define allowlists**: Introduce arrays of supported keys within each module and populate the `dynamic.*` map during config loading. If a key is missing, the module receives `undefined` instead of querying `process.env` directly.
- **Expose helper getters**: Add utility functions such as `getDashboardEnv(key)` that read from `runtimeConfig.dynamic.dashboardConfig` so the guard script can exempt these access patterns.
- **Document extension points**: Update README/operations docs to clarify how operators can extend the allowlists when new dynamic keys are required.

## TODOs for implementation

1. Extend `RuntimeConfig` and its loader to include the proposed groups. Start with the highest-impact areas (dashboard + server core) to unblock the guard.
2. For each module, replace direct `process.env` reads with config consumption, adding `warnOnce` hooks where legacy variable names differ from the new config key.
3. Create shims (e.g., `getTracingConfig()`, `getCatalogConfig()`) in heavily used domains to keep call sites concise and typed.
4. Update tests to configure behavior via helper factories or temporary environment overrides that rebuild the config (using `reloadRuntimeConfig()` when needed).
5. Once migration is complete, tighten the guard allowlist again and document the supported configuration surface in `README.md` / `DEPLOYMENT.md`.

## Rollout plan

### Phase 0 – groundwork (1 PR)

- Add typed namespaces in `RuntimeConfig` and rework `loadRuntimeConfig()` to populate **read-only** structures without touching call sites yet.
- Introduce domain helpers (`getDashboardConfig()`, `getTracingConfig()`, etc.) that wrap `getRuntimeConfig()` so downstream files can migrate incrementally.
- Update guard allowlist to permit the new helper modules.
- Regression: `npm run build:verify` (guards still fail due to existing env reads – expected during this phase).

### Phase 1 – server + logging core (1–2 PRs)

- Refactor `src/server/index.ts`, `src/server/registry.ts`, `src/server/sdkServer.ts`, `src/server/transport.ts`, and `src/services/logger.ts` to consume the new helpers.
- Remove direct `process.env` reads in the server bootstrap path; reload config when mutation toggles flip.
- Adjust related unit tests (`serverIndex.p1`, `sdkServer.handshake`) to set config via environment setup + `reloadRuntimeConfig()`.
- Validate with `npm run build:verify`; guard count should drop significantly.

### Phase 2 – dashboard surface (1 PR)

- Migrate `dashboard/server/*` modules to the dashboard helper, including session persistence and admin panels.
- Replace dynamic env keys by explicit allowlists in `SessionPersistenceManager` and `dashboardConfig` handler, wiring through `runtimeConfig.dynamic.dashboardConfig`.
- Add targeted Vitest coverage for admin settings mutations.
- Run `npm run build:verify` and `npm run test -- dashboard/server` (subset) to confirm behavior.

### Phase 3 – catalog & instructions services (2 PRs)

- Refactor `catalogContext.ts`, `catalogLoader.ts`, `handlers.instructions.ts`, `instructions.dispatcher.ts`, and `manifestManager.ts` to use catalog/instructions namespaces.
- Implement structured `ciContext` detection to replace scattered `CI`/`TF_BUILD` checks.
- Update persistence/instructions tests (parked suites) to configure directories via config.
- Guards should be near-zero after this phase; any remaining direct env reads should be documented dynamic cases.

### Phase 4 – tracing, metrics, utilities (1 PR)

- Consolidate `services/tracing.ts`, `services/metricsCollector.ts`, `utils/BufferRing.ts`, and `utils/memoryMonitor.ts` onto the new config.
- Ensure tracing helpers emit deprecation warnings for legacy flags.
- Add small smoke test covering trace buffer configuration.
- `npm run build:verify` expected to pass without guard failures.

### Phase 5 – cleanup and documentation (1 PR)

- Tighten `scripts/enforce-config-usage.ts` allowlist to remove temporary exemptions.
- Update `README.md`, `DEPLOYMENT.md`, and example configuration files to highlight the new config surface.
- Remove any unused legacy env variables from CI workflows.
- Final run: `npm run build:verify`, `npm run test`, optional `npm run test:contracts`.

### Cross-cutting tasks

- Add a lightweight test helper to reset config between suites to avoid leakage.
- Provide migration guidance in `docs/DEPLOYMENT.md` for operators using the old environment flags.
- Monitor for performance regressions during each phase by comparing `npm run build:verify` durations and logs.

This mapping should give us a clear blueprint for the upcoming refactor work and provide traceability for reviewers verifying the guard passes.
