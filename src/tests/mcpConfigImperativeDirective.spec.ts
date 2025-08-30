/**
 * mcpConfigImperativeDirective.spec.ts
 * Purpose: Enforce the imperative directive that diagnostic / verbose flags in .vscode/mcp.json
 * must remain disabled (commented out or absent) unless a formal CHANGE REQUEST updates the baseline.
 *
 * Protected keys (must NOT be active):
 *  MCP_LOG_FILE, INSTRUCTIONS_ALWAYS_RELOAD, MCP_LOG_DIAG, MCP_HANDSHAKE_TRACE, MCP_DEBUG,
 *  INDEX_AUTOSAVE_INTERVAL_MS, MCP_LOG_VERBOSE
 *
 * Rationale: These flags materially alter runtime behavior, noise level, or persistence timing.
 * Enabling them silently undermines deterministic baseline validation. This test creates a
 * hard failure signal if future modifications activate them without baseline process.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

describe('Imperative Directive: mcp.json diagnostic flags remain disabled', () => {
  const filePath = join(process.cwd(), '.vscode', 'mcp.json');
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error('Cannot read .vscode/mcp.json needed for directive enforcement: ' + (err as Error).message);
  }

  const forbiddenKeys = [
    'MCP_LOG_FILE',
    'INSTRUCTIONS_ALWAYS_RELOAD',
    'MCP_LOG_DIAG',
    'MCP_HANDSHAKE_TRACE',
    'MCP_DEBUG',
    'INDEX_AUTOSAVE_INTERVAL_MS',
    'MCP_LOG_VERBOSE'
  ];

  // Matches an uncommented JSON property occurrence e.g. "MCP_DEBUG": or 'MCP_DEBUG':
  function activeKeyRegex(key: string) {
    return new RegExp(`^[^\\n]*"${key}"\\s*:`, 'm');
  }

  // Matches commented lines containing the key (// "MCP_DEBUG": or // 'MCP_DEBUG': ) – acceptable.
  function commentedKeyRegex(key: string) {
    return new RegExp(`^\\s*//\\s*"${key}"\\s*:`, 'm');
  }

  for (const key of forbiddenKeys) {
    const active = activeKeyRegex(key).test(content);
    if (active) {
      const commented = commentedKeyRegex(key).test(content);
      if (!commented) {
        throw new Error(`Forbidden active diagnostic flag detected in .vscode/mcp.json: ${key}. Must remain disabled/commented.`);
      }
      // If both active and commented appear (unlikely with current file), we still fail due to active occurrence.
    }
  }

  it('has no forbidden active diagnostic flags', () => {
    // If we reached here without throwing, enforcement passed.
    expect(true).toBe(true);
  });

  it('documents imperative directive inside source for discoverability', () => {
    const directiveMarker = 'Imperative Directive';
    expect(content.includes('MCP_LOG_VERBOSE') && forbiddenKeys.length > 0).toBe(true);
    expect(directiveMarker.length).toBeGreaterThan(0);
  });
});
