#!/usr/bin/env node
// Dev launcher for MCP Index Server
// Ensures build exists, then executes compiled server with provided args.
// Writes only coordination logs to stderr to avoid contaminating stdout MCP channel.
const { existsSync } = require('fs');
const { spawnSync, spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const distEntry = path.join(root, 'dist', 'server', 'index.js');

function log(msg){
  process.stderr.write(`[mcp-dev-launch] ${msg}\n`);
}

if(!existsSync(distEntry)){
  log('dist/server/index.js missing - running TypeScript build...');
  const r = spawnSync(process.execPath, [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p','tsconfig.json'
  ], { cwd: root, stdio: ['ignore','ignore','inherit'] });
  if(r.status !== 0){
    log('Build failed. Aborting.');
    process.exit(r.status || 1);
  }
  if(!existsSync(distEntry)){
    log('Build succeeded but entry still missing. Aborting.');
    process.exit(1);
  }
}

const child = spawn(process.execPath, [distEntry, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit'
});
child.on('exit', code => process.exit(code));
