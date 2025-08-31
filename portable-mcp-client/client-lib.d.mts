// Duplicate declaration surface for ESM (.mjs) resolution so that TypeScript can
// associate the '*.mjs' import with declarations. We can't directly re-export from
// a .d.ts via "export * from './client-lib.d.ts'" (TS error). Instead we import types
// and re-export them explicitly. Keep list in sync with client-lib.d.ts.
// Re-declare the same public surface (copy from client-lib.d.ts) so that this file
// stands alone without importing another .d.ts as a value.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface ConnectOptions { command?: string; args?: string[]; name?: string; version?: string; envOverrides?: Record<string, string>; }
export interface Connected { client: Client; transport: StdioClientTransport; }
export function connect(options?: ConnectOptions): Promise<Connected>;

export interface InstructionEntry { id: string; title: string; body: string; version: number; hash: string | null; }
export function buildEntries(count?: number, prefix?: string): InstructionEntry[];

export interface CrudFailure { phase: string; id?: string; error?: string; mismatch?: boolean; }
export interface CrudSummary { created: number; listed: number; validated: number; removed: number; failures: CrudFailure[]; durationMs: number; ok?: boolean; }
export interface RunCrudScenarioOptions { command?: string; args?: string[]; }
export interface RunCrudScenarioFlags { verbose?: boolean; json?: boolean; forceMutation?: boolean; skipRemove?: boolean; }
export function runCrudScenario(proc: RunCrudScenarioOptions, entries: InstructionEntry[], flags?: RunCrudScenarioFlags): Promise<CrudSummary>;

export interface CountInstructionsOptions { command?: string; args?: string[]; list?: boolean; verbose?: boolean; }
export interface CountInstructionsResult { count?: number; hash?: string; items?: Array<Record<string, unknown>>; via?: string; error?: string; }
export function countInstructions(options?: CountInstructionsOptions): Promise<CountInstructionsResult>;

export interface InstructionCreateInput { id: string; body: string; title?: string; priority?: number; audience?: string; requirement?: string; categories?: string[]; }
export interface InstructionClient { create(entry: InstructionCreateInput, opts?: { overwrite?: boolean }): Promise<Record<string, unknown>>; read(id: string): Promise<Record<string, unknown>>; update(entry: InstructionCreateInput): Promise<Record<string, unknown>>; remove(id: string): Promise<Record<string, unknown> | { removed: boolean }>; list(): Promise<{ items: Array<Record<string, unknown>>; count: number; hash?: string }>; close(): Promise<void>; dispatcher: boolean; }
export interface CreateInstructionClientOptions { command?: string; args?: string[]; forceMutation?: boolean; verbose?: boolean; instructionsDir?: string; }
export function createInstructionClient(options?: CreateInstructionClientOptions): Promise<InstructionClient>;

export interface CrudSequenceResult { id: string; created: Record<string, unknown>; read1: Record<string, unknown>; updated: Record<string, unknown>; read2: Record<string, unknown>; removed: Record<string, unknown> | { removed: boolean }; failures: CrudFailure[]; ok?: boolean; }
export interface RunCrudSequenceOptions { command?: string; args?: string[]; id: string; body?: string; updateBody?: string; verbose?: boolean; forceMutation?: boolean; categories?: string[]; }
export function runCrudSequence(options: RunCrudSequenceOptions): Promise<CrudSequenceResult>;

export {}; // ensure module
