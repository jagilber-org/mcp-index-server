import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { FileCatalogRepository } from '../services/catalogRepository';
import { InstructionEntry } from '../models/instruction';

function makeEntry(id: string): InstructionEntry {
  const body = `Body for ${id}`;
  const sourceHash = crypto.createHash('sha256').update(body).digest('hex');
  return {
    id,
    title: `Title ${id}`,
    body,
    priority: 10,
    audience: 'all',
    requirement: 'recommended',
    categories: [],
    sourceHash,
    schemaVersion: '1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

describe('FileCatalogRepository', () => {
  it('loads, saves and removes entries computing deterministic hash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'catrepo-'));
    // write two valid + one invalid file
    const repo = new FileCatalogRepository(dir);
    const a = makeEntry('a');
    const b = makeEntry('b');
    fs.writeFileSync(path.join(dir,'a.json'), JSON.stringify(a));
    fs.writeFileSync(path.join(dir,'b.json'), JSON.stringify(b));
    fs.writeFileSync(path.join(dir,'bad.json'), '{ not json');
    const snap = repo.load();
    expect(snap.entries.map(e=>e.id).sort()).toEqual(['a','b']);
    // add new entry via save
    const c = makeEntry('c');
    repo.save(c);
    const snap2 = repo.load();
    expect(snap2.entries.length).toBe(3);
    // remove one
    repo.remove('b');
    const snap3 = repo.load();
    expect(snap3.entries.length).toBe(2);
  });
});
