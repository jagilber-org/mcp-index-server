#!/usr/bin/env node
/**
 * Copies static dashboard client assets (HTML/CSS) from src to dist so
 * changes like new admin panel sections appear without manual copying.
 */
import { mkdirSync, readdirSync, copyFileSync, statSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { createHash } from 'crypto';

const srcDir = join(process.cwd(), 'src', 'dashboard', 'client');
const destDir = join(process.cwd(), 'dist', 'dashboard', 'client');

const allowed = new Set(['.html', '.css']);

function fileHash(p) {
  try {
    const h = createHash('sha1');
    h.update(readFileSync(p));
    return h.digest('hex');
  } catch {
    return '';
  }
}

function ensureDir(p) {
  try { mkdirSync(p, { recursive: true }); } catch (e) { /* noop ensure */ }
}

function copyAssets() {
  ensureDir(destDir);
  const entries = readdirSync(srcDir);
  let copied = 0;
  const debug = [];
  for (const f of entries) {
    const ext = extname(f).toLowerCase();
    if (!allowed.has(ext)) continue;
    const src = join(srcDir, f);
    const dest = join(destDir, f);
    try {
      const srcStat = statSync(src);
      let needsCopy = true;
      let reason = 'new or changed';
      try {
        const destStat = statSync(dest);
        if (destStat.size === srcStat.size) {
          // Size match; verify content hash to avoid mtime resolution issues on Windows
          const srcH = fileHash(src);
            const destH = fileHash(dest);
            if (srcH === destH) {
              needsCopy = false;
              reason = 'unchanged';
            } else {
              reason = 'hash-diff';
            }
        } else {
          reason = 'size-diff';
        }
      } catch (e) { reason = 'missing-dest'; }
      if (needsCopy) {
        copyFileSync(src, dest);
        copied++;
        debug.push(`${f}: copied (${reason})`);
      } else {
        debug.push(`${f}: skipped (${reason})`);
      }
    } catch (e) {
      console.error('Failed to copy', f, e.message);
    }
  }
  console.log(`[copy-dashboard-assets] Copied ${copied} asset(s) to dist. Details: ${debug.join('; ')}`);
  if (!copied) {
    // Provide explicit signal so CI can optionally grep
    console.log('[copy-dashboard-assets] NOTE: 0 assets copied (all unchanged by hash).');
  }
}

copyAssets();
