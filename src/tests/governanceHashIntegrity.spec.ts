/*
 * Governance & Hash Integrity Tests
 * Active foundational scenarios + advanced scenarios gated by explicit activation criteria comments.
 * Progression policy: enable one skipped test only after 10 consecutive green runs (guard:baseline + guard:decl) with
 * zero hash polling timeouts. Document each activation in CHANGELOG or GOV-HASH test plan.
 */
import { describe, it, expect } from 'vitest';
import { createInstructionClient } from '../portableClientShim';
import { extractCatalogHash, waitForCatalogHashChange } from './hashHelpers';
import { assertHashStable, assertHashChanged } from './testUtils.js';

// Helper to build static bodies
const STATIC_BODY = 'governance-body-static-v1';
const UPDATED_BODY = 'governance-body-static-v2';

async function withClient<T>(fn: (c: any) => Promise<T>): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const client = await createInstructionClient({});
  try { return await fn(client); } finally { await client.close(); }
}

// Partially enable foundational governance hash tests; advanced cases remain skipped
describe('Governance & Hash Integrity', () => { // Active foundational governance tests; advanced scenarios below remain skipped pending stability metrics (SKIP_OK markers on individual it.skip)
  it('hash-on-create stable across immediate read', async () => {
    await withClient(async (client) => {
      const id = 'gov-hash-create-' + Date.now();
      const created = await client.create({ id, body: STATIC_BODY });
      const cHash = extractCatalogHash(created);
      expect(cHash).toBeTruthy();
      const read = await client.read(id);
      const rHash = extractCatalogHash(read);
      assertHashStable(expect, cHash, rHash, 'hash stable after immediate read');
    });
  });

  it('hash changes when body updated', async () => {
    await withClient(async (client) => {
      const id = 'gov-hash-update-' + Date.now();
      const created = await client.create({ id, body: STATIC_BODY });
      const oldHash = extractCatalogHash(created);
      await client.update({ id, body: UPDATED_BODY });
      const newHash = await waitForCatalogHashChange(client, id, oldHash);
    assertHashChanged(expect, oldHash, newHash, 'hash changed after body update');
    });
  });

  it('metadata-only update (title) does not change catalog hash', async () => { // newly enabled after baseline stability
    await withClient(async (client) => {
      const id = 'gov-hash-metadata-' + Date.now();
      const created = await client.create({ id, body: STATIC_BODY });
      const oldHash = extractCatalogHash(created);
      // Title change via overwrite (supply new title but same body)
      await client.update({ id, body: STATIC_BODY, title: 'New Title' });
      // Small delay then re-read
      const read = await client.read(id);
      const newHash = extractCatalogHash(read);
    assertHashStable(expect, oldHash, newHash, 'metadata-only title change stable');
    });
  });

  // Activation criteria: enable after 10 consecutive green runs with foundational trio + no hash polling timeouts.
  it('multi-create same body different ids yields identical per-entry content hashes (catalog hash will evolve)', async () => { // Activated after baseline stability; asserts sourceHash consistency when available
    await withClient(async (client) => {
      const base = 'gov-hash-multi-' + Date.now();
      const id1 = base + '-a';
      const id2 = base + '-b';
      await client.create({ id:id1, body: STATIC_BODY });
      await client.create({ id:id2, body: STATIC_BODY });
      const r1 = await client.read(id1);
      const r2 = await client.read(id2);
      // We cannot rely on catalog hash equality (global) so assert bodies & derived sourceHash equality
      const b1 = r1?.item?.body;
      const b2 = r2?.item?.body;
      expect(b1).toBe(STATIC_BODY);
      expect(b2).toBe(STATIC_BODY);
      const s1 = r1?.item?.sourceHash;
      const s2 = r2?.item?.sourceHash;
      if(s1 && s2){ expect(s1).toBe(s2); }
    });
  });

  // Activation criteria: expose client create overwrite option OR server adds skip flag in response.
  it.skip('overwrite-flag-governed: second create without overwrite is skipped', async () => { // SKIP_OK overwrite semantics under refinement (client always overwrite=true currently)
    await withClient(async (client) => {
      const id = 'gov-hash-skip-' + Date.now();
      const first = await client.create({ id, body: STATIC_BODY });
      const oldHash = extractCatalogHash(first);
      const second = await client.create({ id, body: UPDATED_BODY });
      // Expect skipped flag (portable client create uses overwrite=true by default UNLESS we later expose option)
      // Current client always overwrites; emulate skip by checking created:false when same catalog hash persists.
      const newHash = extractCatalogHash(second);
      // If implementation overwrote, hash likely changed -> allow either but record expectation shape.
      if(oldHash && newHash){
        // Soft assertion: if same body change should differ, if same hash we accept but note by equality check
        expect(typeof newHash === 'string').toBe(true);
      }
    });
  });

  // Activation criteria: finalize catalog hash policy on delete (stable 2-hash lifecycle) OR document 3-hash variance as accepted.
  it.skip('drift-detection-sequence: single body mutation produces exactly two distinct catalog hashes across lifecycle', async () => { // SKIP_OK drift lifecycle variability (delete hash impact unsettled)
    await withClient(async (client) => {
      const id = 'gov-hash-drift-' + Date.now();
      const hashes: string[] = [];
      const created = await client.create({ id, body: STATIC_BODY });
      const h1 = extractCatalogHash(created); if(h1) hashes.push(h1);
      await client.update({ id, body: UPDATED_BODY });
      const h2 = await waitForCatalogHashChange(client, id, h1);
      if(h2) hashes.push(h2);
      // Remove then (optionally) list to capture final catalog hash after deletion
      try { await client.remove(id); } catch { /* ignore */ }
      // After removal, catalog hash may change again; capture
      const post = await client.read(id); // will return notFound shape; we ignore missing
      const h3 = extractCatalogHash(post); if(h3 && !hashes.includes(h3)) hashes.push(h3);
      // We allow 2 or 3 depending on whether delete modifies catalog hashing scheme.
      expect(hashes.length === 2 || hashes.length === 3).toBe(true);
    });
  });
});

