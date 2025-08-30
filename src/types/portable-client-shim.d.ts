// Minimal ambient module declaration for portable client ESM without pulling in vendored tree.
// Keeps typechecker quiet (avoid TS7016) while treating exports as 'any'.
// Intentionally lax: tests exercise runtime behavior; full typing would require vendored sources.
declare module '../portable-mcp-client/client-lib.mjs' {
  export const createInstructionClient: any;
  export const runCrudSequence: any;
  export const createTransport: any;
}
declare module '../../portable-mcp-client/client-lib.mjs' {
  export const createInstructionClient: any;
  export const runCrudSequence: any;
  export const createTransport: any;
}