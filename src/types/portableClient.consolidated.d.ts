/**
 * Consolidated portable client ambient declarations.
 * Single source of truth enforced by scripts/guard-declarations.mjs.
 * Any reappearance of other portable client *.d.ts files will fail the guard step.
 * Keep minimal and structurally typed for resilience to upstream churn.
 */

// Core instruction entry shape (flexible augmentation allowed)
export interface PortableInstructionEntry {
	id: string;
	body: string;
	title?: string;
	priority?: number;
	// Allow additional evolving properties
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[k: string]: any;
}

export interface PortableCrudSequenceResult {
	id?: string;
	ok?: boolean;
	failures?: unknown[];
	created?: unknown;
	read1?: unknown;
	read2?: unknown;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[k: string]: any;
}

// Ambient module for the ESM client library shipped alongside the repo.
declare module '../portable-mcp-client/client-lib.mjs' {
	import { PortableInstructionEntry, PortableCrudSequenceResult } from './portableClient.consolidated.d.ts';
	// Creation of a lightweight instruction client used by tests.
	function createInstructionClient(options?: Record<string, unknown>): Promise<{
		read(id: string): Promise<unknown>;
		// Minimal method surface required by tests; extended methods ignored.
		close(): Promise<void>;
	}>;
	function runCrudSequence(options: { id: string; body: string; updateBody: string; categories?: string[] }): Promise<PortableCrudSequenceResult>;
	export { createInstructionClient, runCrudSequence };
	export type InstructionEntry = PortableInstructionEntry;
	export type RunCrudResult = PortableCrudSequenceResult;
}

// Backwards compatibility re-exports for any older shim references.
export type InstructionEntry = PortableInstructionEntry;
export type RunCrudResult = PortableCrudSequenceResult;

