// Ambient minimal declarations for the external portable client ESM module.
// Purpose: Provide only the narrow surface exercised by tests & shim without
// importing the upstream full .d.ts (which previously caused typed-lint churn).
// Keep intentionally permissive to avoid fragile coupling.

declare module '../portable-mcp-client/client-lib.mjs' {
  export interface PortableRunCrudSequenceOptions { id: string; body: string; updateBody: string; categories?: string[]; }
  export interface PortableCrudSequenceResult { ok?: boolean; failures?: unknown[]; created?: unknown; read1?: unknown; read2?: unknown; [k: string]: unknown; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function runCrudSequence(opts: PortableRunCrudSequenceOptions): Promise<PortableCrudSequenceResult>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface PortableInstructionClient { read(id: string): Promise<unknown>; close(): Promise<void>; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createInstructionClient(config: Record<string, unknown>): Promise<PortableInstructionClient>;
}

// Support test code that may import client-lib through a sibling directory path variant.
declare module '../../portable-mcp-client/client-lib.mjs' {
  export interface PortableRunCrudSequenceOptions { id: string; body: string; updateBody: string; categories?: string[]; }
  export interface PortableCrudSequenceResult { ok?: boolean; failures?: unknown[]; created?: unknown; read1?: unknown; read2?: unknown; [k: string]: unknown; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function runCrudSequence(opts: PortableRunCrudSequenceOptions): Promise<PortableCrudSequenceResult>;
  export interface PortableInstructionClient { read(id: string): Promise<unknown>; close(): Promise<void>; }
  export function createInstructionClient(config: Record<string, unknown>): Promise<PortableInstructionClient>;
}
