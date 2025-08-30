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
