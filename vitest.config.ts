import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
  // Global setup ensures dist readiness; run completion sentinel now handled by custom reporter.
  setupFiles: ['src/tests/setupDistReady.ts'],
  reporters: ['default', './src/tests/runSentinelReporter.ts', './src/tests/jsonResultsReporter.ts'],
  // Serialize tests in a single worker process to avoid concurrent production deploy races during Phase 4
  // (multiple workers were triggering overlapping deploy-local.ps1 executions causing file locks)
  pool: 'forks',
  maxWorkers: 1,
  include: ['src/tests/**/*.spec.ts'],
  // Adjust default timeouts: higher per-test and explicit hook timeout to accommodate multi-client spawn & coordination.
  testTimeout: 25000,
  hookTimeout: 60000,
    // Phase 4 isolation: exclude parked / legacy high-churn suites from discovery
    // Ensures only minimal invariant specs (createReadSmoke, portableCrudAtomic, instructionsAddPersistence,
    // plus governance directive spec) are executed during baseline restoration phases.
    exclude: [
      'src/tests._park/**',
      'src/tests._legacy/**'
  ,'dist/**'
  ,'node_modules/**'
    ],
    coverage: {
      // Ensure CI artifact presence: generate multiple reporters including cobertura (coverage.xml)
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'cobertura'],
      reportsDirectory: 'coverage',
      // Real fix: scope coverage to production-critical runtime code only.
      // This excludes dashboard assets, experimental/perf harnesses, portable client wrappers, and test helper scripts
      // so that the coverage percentage reflects server/service logic quality instead of UI & generated content weight.
      include: [
        'src/server/**',
        'src/services/**',
        'src/utils/**',
        'src/models/**',
        'src/versioning/**'
      ],
      // Vitest's cobertura reporter writes coverage/cobertura-coverage.xml; create a stable symlink/copy step externally if needed.
      exclude: [
        'scripts/**',
        'dist/**',
        'docs/**',
        'data/**',
        'snapshots/**',
        'tmp/**',
        'src/dashboard/**',
        'src/perf/**',
        'src/portableClient*',
        'portable/**',
        '**/*.d.ts'
      ]
    }
  }
});
