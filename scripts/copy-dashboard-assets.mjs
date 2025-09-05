#!/usr/bin/env node
/**
 * Copies static dashboard client assets (HTML/CSS) from src to dist so
 * changes like new admin panel sections appear without manual copying.
 */
import { mkdirSync, readdirSync, copyFileSync, statSync } from 'fs';
import { join, extname } from 'path';

const srcDir = join(process.cwd(), 'src', 'dashboard', 'client');
const destDir = join(process.cwd(), 'dist', 'dashboard', 'client');

const allowed = new Set(['.html', '.css']);

function ensureDir(p) {
  try { mkdirSync(p, { recursive: true }); } catch (e) { /* noop ensure */ }
}

function copyAssets() {
  ensureDir(destDir);
  const entries = readdirSync(srcDir);
  let copied = 0;
  for (const f of entries) {
    const ext = extname(f).toLowerCase();
    if (!allowed.has(ext)) continue;
    const src = join(srcDir, f);
    const dest = join(destDir, f);
    try {
      const srcStat = statSync(src);
      let needsCopy = true;
      try {
        const destStat = statSync(dest);
        if (destStat.mtimeMs >= srcStat.mtimeMs && destStat.size === srcStat.size) {
          needsCopy = false;
        }
      } catch (e) { /* dest missing */ }
      if (needsCopy) {
        copyFileSync(src, dest);
        copied++;
      }
    } catch (e) {
      console.error('Failed to copy', f, e.message);
    }
  }
  console.log(`[copy-dashboard-assets] Copied ${copied} asset(s) to dist.`);
}

copyAssets();
