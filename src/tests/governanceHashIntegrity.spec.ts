/*
 * Governance & Hash Integrity Tests (scaffold)
 * Initially skipped until helper utilities and stability confirmed.
 */
import { describe, it, expect } from 'vitest';
import { createInstructionClient } from '../portableClientShim';

// Helper to build static bodies
const STATIC_BODY = 'governance-body-static-v1';
const UPDATED_BODY = 'governance-body-static-v2';

async function withClient<T>(fn: (c: any) => Promise<T>): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const client = await createInstructionClient({});
  try { return await fn(client); } finally { await client.close(); }
}

describe.skip('Governance & Hash Integrity', () => {
  it('hash-on-create stable across immediate read', async () => {
    await withClient(async (client) => {
      const id = 'gov-hash-create-' + Date.now();
      const created = await client.create({ id, body: STATIC_BODY });
      expect(created?.hash ?? created?.item?.hash).toBeTruthy();
      const read = await client.read(id);
      const cHash = created?.hash ?? created?.item?.hash;
      const rHash = read?.hash ?? read?.item?.hash;
      expect(cHash).toBe(rHash);
    });
  });

  it('hash changes when body updated', async () => {
    await withClient(async (client) => {
      const id = 'gov-hash-update-' + Date.now();
      const created = await client.create({ id, body: STATIC_BODY });
      const oldHash = created?.hash ?? created?.item?.hash;
      await client.update({ id, body: UPDATED_BODY });
      // Simple polling loop
      let newHash: string | undefined;
      const start = Date.now();
      while (Date.now() - start < 1500) {
        const r = await client.read(id);
        newHash = r?.hash ?? r?.item?.hash;
        if (newHash && newHash !== oldHash) break;
        await new Promise(res => setTimeout(res, 50));
      }
      expect(newHash && newHash !== oldHash).toBe(true);
    });
  });
});
