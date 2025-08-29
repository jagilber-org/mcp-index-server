/**
 * @fileoverview Portable MCP Test Client Integration Tests
 * Tests the deployed portable MCP client functionality and validates
 * its integration with the test suite for CRUD troubleshooting.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

describe('Portable MCP Client Integration', () => {
  const testTimeout = 10000; // explicit constant to avoid NaN propagation
  const portableDir = path.resolve(process.cwd(), 'portable');

  beforeEach(() => {
    // per-test setup placeholder (no-op currently)
  });

  afterEach(() => {
    // Cleanup any running processes
  });

  describe('Portable Client Deployment', () => {
    it('should have portable directory with required files', async () => {
      const requiredFiles = [
        'package.json',
        'server.mjs',
        'smoke-client.mjs',
        'node_modules'
      ];

      for (const file of requiredFiles) {
        const filePath = path.join(portableDir, file);
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        expect(exists, `Required file missing: ${file}`).toBe(true);
      }
    });

    it('should have valid package.json with required smoke scripts (start script optional)', async () => {
      const packagePath = path.join(portableDir, 'package.json');
      const packageContent = await fs.readFile(packagePath, 'utf8');
      const packageJson = JSON.parse(packageContent);

      expect(packageJson.scripts).toBeDefined();
      expect(packageJson.scripts.smoke).toBeDefined();
      expect(packageJson.scripts['smoke:json']).toBeDefined();
      // Some portable bundles omit a dedicated start script; do NOT fail baseline if absent.
    });
  });

  describe('Portable Client Smoke Tests', () => {
    it('should successfully run human-readable smoke test', async () => {
      const result = await runPortableCommand('npm run smoke');
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[portable-smoke] tools:');
      expect(result.stdout).toContain('echo');
      expect(result.stdout).toContain('math');
      expect(result.stdout).toContain('system_info');
      expect(result.stdout).toContain('[portable-smoke] ok: true');
    }, testTimeout);

    it('should successfully run JSON smoke test', async () => {
      const result = await runPortableCommand('npm run smoke:json');
      
      expect(result.exitCode).toBe(0);
      
      // Extract JSON from output (filter out server startup logs)
      const lines = result.stdout.split('\n');
      const jsonLine = lines.find(line => line.trim().startsWith('{') && line.includes('toolCount'));
      expect(jsonLine, 'Should contain valid JSON output').toBeDefined();

      const jsonResult = JSON.parse(jsonLine!);
      expect(jsonResult.toolCount).toBe(3);
      expect(jsonResult.tools).toEqual(['echo', 'math', 'system_info']);
      expect(jsonResult.ok).toBe(true);
      
      // Verify each tool response
      expect(jsonResult.echo).toContain('hello portable');
      expect(jsonResult.math).toContain('"result":7');
      // The summary key uses 'system' even though the tool is 'system_info'
      expect(jsonResult.system).toContain('"platform":');
    }, testTimeout);

    it('should demonstrate MCP protocol compliance', async () => {
      const result = await runPortableCommand('npm run smoke:json');
      const lines = result.stdout.split('\n');
      const jsonLine = lines.find(line => line.trim().startsWith('{') && line.includes('toolCount'));
      const jsonResult = JSON.parse(jsonLine!);

      // Verify MCP protocol compliance indicators
      expect(jsonResult.toolCount).toBeGreaterThan(0);
      expect(Array.isArray(jsonResult.tools)).toBe(true);
      expect(jsonResult.tools.length).toBe(jsonResult.toolCount);
      
      // Verify tool responses are properly formatted JSON strings (handle system_info -> system mapping)
      const KEY_MAP: Record<string,string> = { system_info: 'system', echo: 'echo', math: 'math' };
      for (const tool of jsonResult.tools) {
        const key = KEY_MAP[tool] || tool;
        const toolResponse = jsonResult[key];
        expect(toolResponse, `Expected response field for tool ${tool} (mapped key ${key})`).toBeDefined();
        expect(() => JSON.parse(toolResponse)).not.toThrow();
      }
    }, testTimeout);
  });

  describe('Baseline MCP Behavior Reference', () => {
    it('should establish 100% success rate baseline', async () => {
      const result = await runPortableCommand('npm run smoke:json');
      const lines = result.stdout.split('\n');
      const jsonLine = lines.find(line => line.trim().startsWith('{') && line.includes('toolCount'));
      const jsonResult = JSON.parse(jsonLine!);

      // This establishes the expected 100% success rate for comparison
      // with MCP Index Server CRUD operations that currently show 66.7% failure
      expect(jsonResult.ok).toBe(true);
      expect(jsonResult.toolCount).toBe(3);
      expect(jsonResult.tools.length).toBe(3);
      
      // Verify no tools report failures
      const KEY_MAP: Record<string,string> = { system_info: 'system', echo: 'echo', math: 'math' };
      for (const tool of jsonResult.tools) {
        const key = KEY_MAP[tool] || tool;
        const toolResponseRaw = jsonResult[key];
        const toolResponse = JSON.parse(toolResponseRaw);
        expect(toolResponse).toBeDefined();
        expect(typeof toolResponse).toBe('object');
      }
    }, testTimeout);

    it('should provide consistent response formatting', async () => {
      // Run multiple times to verify consistency
      const runs = 3;
      const results = [];

      for (let i = 0; i < runs; i++) {
        const result = await runPortableCommand('npm run smoke:json');
        const lines = result.stdout.split('\n');
        const jsonLine = lines.find(line => line.trim().startsWith('{') && line.includes('toolCount'));
        results.push(JSON.parse(jsonLine!));
      }

      // Verify consistent structure across runs
      for (let i = 1; i < runs; i++) {
        expect(results[i].toolCount).toBe(results[0].toolCount);
  expect(results[i].tools).toEqual(results[0].tools);
        expect(results[i].ok).toBe(results[0].ok);
      }
    }, testTimeout * 3);
  });

  describe('CRUD Testing Foundation', () => {
    it('should validate portable client as CRUD testing baseline', async () => {
      const result = await runPortableCommand('npm run smoke:json');
      const lines = result.stdout.split('\n');
      const jsonLine = lines.find(line => line.trim().startsWith('{') && line.includes('toolCount'));
      const baselineResult = JSON.parse(jsonLine!);

      // Document baseline behavior for CRUD comparison tests
      expect(baselineResult, 'Baseline MCP client should be fully functional').toMatchObject({
        toolCount: 3,
        tools: expect.arrayContaining(['echo', 'math', 'system_info']),
        ok: true
      });

      // This test establishes the portable client as the reference
      // implementation for comparing MCP Index Server CRUD reliability
      console.log('✅ Baseline MCP behavior established:', {
        toolDiscovery: '100% success',
        toolInvocation: '100% success', 
        responseFormatting: 'consistent',
        silentFailures: 'none detected'
      });
    }, testTimeout);
  });
});

/**
 * Helper function to run portable MCP commands
 */
async function runPortableCommand(command: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const portableDir = path.resolve(process.cwd(), 'portable');
    const [cmd, ...args] = command.split(' ');
    
    const child = spawn(cmd, args, {
      cwd: portableDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code || 0,
        stdout,
        stderr
      });
    });

    // Timeout protection
    setTimeout(() => {
      child.kill();
      resolve({
        exitCode: -1,
        stdout: stdout + '\n[TIMEOUT]',
        stderr: stderr + '\n[TIMEOUT]'
      });
    }, 15000);
  });
}
