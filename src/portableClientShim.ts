// Lightweight TypeScript shim around the ESM portable client (client-lib.mjs).
// We intentionally avoid importing the .d.ts (which is outside the included
// TS project scope to keep lint noise down). Instead, declare minimal types
// used by tests so typecheck passes without full surface area.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any; // Simplified for test harness purposes.

export interface CrudSequenceResult {
	ok?: boolean;
	failures?: unknown[];
	created?: JsonValue;
	read1?: JsonValue;
	read2?: JsonValue;
	// Allow any extra properties passed through
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[k: string]: any;
}

export interface RunCrudSequenceOptions {
	id: string; body: string; updateBody: string; categories?: string[];
}

// Dynamic import wrapper so callers can use static imports from this shim.
export async function runCrudSequence(opts: RunCrudSequenceOptions): Promise<CrudSequenceResult> {
	// Use relative path with explicit .mjs; ambient declaration supplies typing.
	// @ts-expect-error Temporary: dynamic ESM import lacks direct .d.ts pairing (guarded separately)
	const mod = await import('../portable-mcp-client/client-lib.mjs');
	return (mod as unknown as { runCrudSequence(o: RunCrudSequenceOptions): Promise<CrudSequenceResult> })
		.runCrudSequence(opts);
}

export interface InstructionClient {
	read(id: string): Promise<JsonValue>;
	close(): Promise<void>;
}

export async function createInstructionClient(config: Record<string, unknown>): Promise<InstructionClient> {
	// @ts-expect-error Temporary: dynamic ESM import lacks direct .d.ts pairing (guarded separately)
	const mod = await import('../portable-mcp-client/client-lib.mjs');
	return (mod as unknown as { createInstructionClient(c: Record<string, unknown>): Promise<InstructionClient> })
		.createInstructionClient(config);
}

// Provide both named exports (above) and a default aggregate for flexibility.
export default { runCrudSequence, createInstructionClient };
