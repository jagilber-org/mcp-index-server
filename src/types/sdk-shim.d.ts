// Minimal ambient declarations to satisfy TS7016 for portable client dynamic imports.
// Kept intentionally light; authoritative richer typing lives in portableClient.consolidated.d.ts.

declare module '../portable-mcp-client/client-lib.mjs' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function createInstructionClient(options?: Record<string, unknown>): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function runCrudSequence(options: { id: string; body: string; updateBody: string; categories?: string[] }): Promise<any>;
  export { createInstructionClient, runCrudSequence };
}

declare module '../../portable-mcp-client/client-lib.mjs' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function createInstructionClient(options?: Record<string, unknown>): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function runCrudSequence(options: { id: string; body: string; updateBody: string; categories?: string[] }): Promise<any>;
  export { createInstructionClient, runCrudSequence };
}
// Temporary shim so TypeScript in CommonJS mode can resolve ESM SDK subpath imports.
// The SDK publishes types under dist/ with package exports mapping, but TS resolution in this project
// (module=CommonJS) fails to pick them. We declare modules pointing to the compiled .d.ts outputs.
// Remove this shim once tsconfig is migrated to moduleResolution "Bundler" or ESM.

declare module '@modelcontextprotocol/sdk/server' {
  export * from '@modelcontextprotocol/sdk/dist/server';
}
declare module '@modelcontextprotocol/sdk/transports/stdio' {
  export { StdioServerTransport } from '@modelcontextprotocol/sdk/dist/server/stdio';
}
declare module '@modelcontextprotocol/sdk' {
  export * from '@modelcontextprotocol/sdk/dist/types';
}