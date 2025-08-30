// Ambient module declaration for the ESM portable client library.
// Provides minimal, strictly-typed surface needed by test shims without leaking any 'any'.
// Extend as the upstream library surface grows.

declare module '../portable-mcp-client/client-lib.mjs' {
  export interface InstructionRecord {
    id: string;
    body: string;
    categories?: string[];
    [k: string]: unknown;
  }

  export interface CreateParams { id: string; body: string; categories?: string[] }
  export interface UpdateParams { id: string; body: string; categories?: string[] }

  export interface ListResult { items: InstructionRecord[] }
  export interface ReadResult { item?: InstructionRecord; body?: string }

  export interface InstructionClient {
    create(p: CreateParams): Promise<InstructionRecord | { verified?: boolean } & InstructionRecord>;
    list(): Promise<ListResult>;
    read(id: string): Promise<ReadResult | null>;
    update(p: UpdateParams): Promise<InstructionRecord | { verified?: boolean } & InstructionRecord>;
    remove(id: string): Promise<void>;
    close(): Promise<void>;
  }

  export function createInstructionClient(opts: Record<string, unknown>): Promise<InstructionClient>;
  export function runCrudSequence(id: string, body: string): Promise<{ ok: boolean; failures: string[]; id: string; dir?: string }>;
}
