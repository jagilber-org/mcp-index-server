// Central semantic JSON-RPC error helper to ensure code/message survive wrapping layers.
// We use a simple plain-object shape (instead of Error subclass) to avoid any
// library/runtime wrapping stripping custom enumerable properties under load.
// Shape intentionally mirrors JSON-RPC error with an added __semantic marker.
export interface SemanticRpcErrorShape<TData extends Record<string, unknown> | undefined = Record<string, unknown>> {
  code: number;
  message: string;
  data: TData;
  __semantic: true;
}

export function semanticError<TData extends Record<string, unknown> | undefined = Record<string, unknown>>(code: number, message: string, data?: TData): never {
  const err: SemanticRpcErrorShape<TData> = { code, message, data: (data === undefined ? ({} as TData) : data), __semantic: true };
  // Throw plain object so downstream passes through as-is.
  // (Stack trace not required for semantic validation errors.)
  // eslint-disable-next-line no-throw-literal
  throw err;
}

export function isSemanticError(e: unknown): e is SemanticRpcErrorShape<Record<string, unknown>> {
  if(!e || typeof e !== 'object') return false;
  const maybe = e as { code?: unknown; message?: unknown; __semantic?: unknown };
  return maybe.__semantic === true && Number.isSafeInteger(maybe.code) && typeof maybe.message === 'string';
}