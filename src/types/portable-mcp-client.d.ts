/**
 * Ambient module declaration for the portable MCP client when imported via relative path.
 * Consolidates earlier ad-hoc declarations and ensures both shim and tests resolve types.
 * Keep surface intentionally minimal to avoid churn; widen with 'any' where fidelity is non-critical.
 */
declare module '../portable-mcp-client/client-lib.mjs' {
  export interface InstructionResultItem { id: string; body: string; hash?: string; [k: string]: any }
  export interface InstructionAddResult { id: string; created?: boolean; overwritten?: boolean; verified?: boolean; body?: string; item?: InstructionResultItem; hash?: string; error?: string }
  export interface InstructionListResult { items: Array<{ id: string; body?: string; hash?: string }>; total?: number }
  export interface InstructionGetResult { item?: InstructionResultItem; body?: string; hash?: string; error?: string }
  export interface RunCrudResult { id: string; ok: boolean; failures: string[]; dir?: string }
  export function createInstructionClient(options?: Record<string, any>): any;
  export function runCrudSequence(options?: Record<string, any>): Promise<RunCrudResult>;
}
