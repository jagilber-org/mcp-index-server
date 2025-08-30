import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
  setupFiles: ['src/tests/setupDistReady.ts'],
  // Serialize tests in a single worker process to avoid concurrent production deploy races during Phase 4
  // (multiple workers were triggering overlapping deploy-local.ps1 executions causing file locks)
  pool: 'forks',
  maxWorkers: 1,
    // Phase 4 isolation: exclude parked / legacy high-churn suites from discovery
    // Ensures only minimal invariant specs (createReadSmoke, portableCrudAtomic, instructionsAddPersistence,
    // plus governance directive spec) are executed during baseline restoration phases.
    exclude: [
      'src/tests._park/**',
      'src/tests._legacy/**'
    ],
    coverage: {
      exclude: [
        'scripts/**',
        'dist/**',
        'docs/**',
        'data/**',
        'snapshots/**',
        'tmp/**',
        '**/*.d.ts'
      ]
    }
  }
});
