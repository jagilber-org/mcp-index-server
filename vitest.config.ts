import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
  setupFiles: ['src/tests/setupDistReady.ts'],
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
