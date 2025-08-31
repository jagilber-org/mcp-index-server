// Global stderr log prefixing for diagnostics.
// Adds ISO timestamp, pid, ppid, monotonically increasing sequence, and optional worker thread id.
// Does NOT touch stdout to avoid contaminating JSON-RPC protocol channel.
// Safe to import multiple times (idempotent guard).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
if(!(global as any).__mcpLogPrefixPatched){
  try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origWrite = process.stderr.write.bind(process.stderr) as unknown as (chunk: any, encoding?: any, cb?: any)=>boolean;
    let seq = 0;
    let threadId: number | undefined;
    try {
      // Lazy load worker_threads only if available (Node >=12) to avoid bundler complaints.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const wt = require('worker_threads');
      if(wt && typeof wt.threadId === 'number') threadId = wt.threadId;
    } catch { /* ignore */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = function patched(chunk: any, encoding?: any, cb?: any){
      try {
        // Accept Buffers and strings; fall back to original if non-standard.
        const s = (chunk instanceof Buffer) ? chunk.toString('utf8') : String(chunk);
        // Split on newlines, drop trailing empty if final newline present to avoid double blank lines.
        const parts = s.split(/\n/);
        const last = parts[parts.length-1];
        const dropLastEmpty = last === '';
        if(dropLastEmpty) parts.pop();
        const prefixed = parts.map(line => {
          if(!line) return line; // preserve empty interior lines
          // Avoid double prefixing: detect if line already starts with our marker.
          if(/^[[]ts=\d{4}-\d{2}-\d{2}T/.test(line)) return line;
          const iso = new Date().toISOString();
            const pfx = `[ts=${iso} pid=${process.pid} ppid=${process.ppid} seq=${++seq}${threadId!=null?` tid=${threadId}`:''}]`;
          return `${pfx} ${line}`;
        }).join('\n');
        const finalOut = prefixed + (dropLastEmpty ? '\n' : '');
        return origWrite(finalOut, encoding, cb);
      } catch {
        return origWrite(chunk, encoding, cb);
      }
    };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).__mcpLogPrefixPatched = true;
  } catch { /* ignore patch errors */ }
}

export {}; // module side-effect only
