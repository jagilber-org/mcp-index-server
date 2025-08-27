export async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 40): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return predicate();
}

// Parse a tools/call success line and return decoded inner JSON payload (content[0].text) if present
export function parseToolPayload<T=unknown>(line: string): T | undefined {
  try {
    const outer = JSON.parse(line);
    const text = outer.result?.content?.[0]?.text;
    if (typeof text === 'string') {
      try { return JSON.parse(text) as T; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return undefined;
}
