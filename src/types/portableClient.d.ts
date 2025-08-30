// Ambient module declarations for the portable MCP client ESM library.
// This keeps the core tsconfig "include" limited to src/** while satisfying
// imports like: import('../portable-mcp-client/client-lib.mjs') in test shims.
// We intentionally do not re-export the full external surface; only the
// minimal shapes consumed by the shim & tests. Mark everything as loose
// enough to avoid drift when the vendored client updates.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

declare module '../portable-mcp-client/client-lib.mjs' {
  // Crud sequence (portableCrudAtomic / harness tests)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface CrudSequenceResult { ok?: boolean; failures?: any[]; [k: string]: any }
  export interface RunCrudSequenceOptions { id: string; body?: string; updateBody?: string; categories?: string[] }
  export function runCrudSequence(opts: RunCrudSequenceOptions): Promise<CrudSequenceResult>;

  // Instruction client minimal surface
  export interface InstructionClient {
    read(id: string): Promise<AnyRecord>;
    create?(entry: AnyRecord, opts?: AnyRecord): Promise<AnyRecord>;
    update?(entry: AnyRecord): Promise<AnyRecord>;
    remove?(id: string): Promise<AnyRecord>;
    list?(): Promise<{ items: AnyRecord[]; count: number; hash?: string }>;
    close(): Promise<void>;
  }
  export interface CreateInstructionClientOptions { command?: string; args?: string[]; forceMutation?: boolean }
  export function createInstructionClient(options?: CreateInstructionClientOptions): Promise<InstructionClient>;
}

export {}; // ensure this file is a module
// Type declarations for portable MCP client library (client-lib.mjs)
// Provides minimal typings used by test harnesses so we can avoid ts-expect-error.

// Support importing client-lib.mjs from tests via relative path
declare module '*portable-mcp-client/client-lib.mjs' {
	export interface CrudSequenceResult {
		id: string;
		created?: unknown;
		read1?: unknown;
		updated?: unknown;
		read2?: unknown;
		removed?: unknown;
		failures: Array<{ phase: string; error?: string }>;
		ok?: boolean;
	}
	export function runCrudSequence(opts: {
		command?: string;
		args?: string[];
		id: string;
		body?: string;
		updateBody?: string;
		verbose?: boolean;
		forceMutation?: boolean;
		categories?: string[];
	}): Promise<CrudSequenceResult>;

	export interface InstructionClient {
		create(entry: { id: string; body: string; categories?: string[] }): Promise<unknown>;
		read(id: string): Promise<unknown>;
		update(entry: { id: string; body: string; categories?: string[] }): Promise<unknown>;
		remove(id: string): Promise<unknown>;
		list(): Promise<{ items?: unknown[]; count?: number; hash?: string }>;
		close(): Promise<void>;
		dispatcher: boolean;
	}
	export function createInstructionClient(opts?: {
		command?: string;
		args?: string[];
		forceMutation?: boolean;
		verbose?: boolean;
	}): Promise<InstructionClient>;
}
