/**
 * Minimal ambient module declarations for the external portable MCP client library.
 *
 * Purpose:
 *  - Silence TS7016 (missing declaration) without importing the full upstream types.
 *  - Keep surface intentionally narrow and structurally typed to avoid churn.
 *  - Safe for both test and build contexts; excluded from typed ESLint via overrides.
 */
declare module '../portable-mcp-client/client-lib.mjs' {
  export interface InstructionEntry {
    id: string;
    body: string;
    title?: string;
    priority?: number;
    [k: string]: any; // flexible for evolving fields
  }

  export interface RunCrudResult {
    id: string;
    ok: boolean;
    failures: string[];
    dir?: string;
  }

  export function createInstructionClient(options?: Record<string, unknown>): any;
  export function runCrudSequence(options?: Record<string, unknown>): Promise<RunCrudResult>;
}
