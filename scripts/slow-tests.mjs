// Central authoritative list of slow / pre-push test files (relative to repo root)
// Keep this list small and high-signal. Used by test-slow and test-fast scripts.
export const slowTests = [
  'src/tests/feedbackReproduction.multiClient.spec.ts',
  'src/tests/feedbackReproduction.crudConsistency.spec.ts',
  'src/tests/instructionsPersistenceDivergence.red.spec.ts',
  'src/tests/instructionsPersistenceIsolated.red.spec.ts',
  'src/tests/importDuplicateAddVisibility.red.spec.ts'
];

export function isSlowTest(path) {
  return slowTests.includes(path.replace(/\\/g, '/'));
}
