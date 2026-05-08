import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpecStore } from '../../../src/spec-plan/spec-store.js';
import type { SpecDocument } from '../../../src/spec-plan/types.js';

describe('SpecStore', () => {
  let testDir: string;
  let store: SpecStore;

  const workspacePath = '/test/project';

  const makeDoc = (overrides: Partial<SpecDocument['meta']> = {}): SpecDocument => ({
    meta: {
      name: 'user-login',
      version: 1,
      status: 'draft',
      workspacePath,
      createdAt: '2026-04-23T14:30:00.000Z',
      updatedAt: '2026-04-23T14:30:00.000Z',
      ...overrides,
    },
    body: '# User Login\n\n## Goal\nImplement user authentication.',
  });

  beforeEach(async () => {
    testDir = join(tmpdir(), `spec-store-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    store = new SpecStore(testDir, workspacePath);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- save ---

  describe('save', () => {
    it('writes spec document to file', async () => {
      await store.save(makeDoc());
      const list = await store.list();
      expect(list).toHaveLength(1);
      expect(list[0].meta.name).toBe('user-login');
      expect(list[0].meta.version).toBe(1);
      expect(list[0].body).toContain('User Login');
    });

    it('writes YAML frontmatter + markdown body', async () => {
      await store.save(makeDoc());
      const doc = await store.get('user-login', 1);
      expect(doc).not.toBeNull();
      expect(doc!.body).toContain('# User Login');
    });
  });

  // --- list ---

  describe('list', () => {
    it('returns empty array for empty directory', async () => {
      const list = await store.list();
      expect(list).toEqual([]);
    });

    it('returns all specs sorted by timestamp descending', async () => {
      await store.save(makeDoc({ version: 1, createdAt: '2026-04-23T10:00:00.000Z' }));
      await store.save(makeDoc({ version: 2, createdAt: '2026-04-23T14:00:00.000Z' }));

      const list = await store.list();
      expect(list).toHaveLength(2);
      expect(list[0].meta.version).toBe(2);
      expect(list[1].meta.version).toBe(1);
    });
  });

  // --- get ---

  describe('get', () => {
    it('returns null for non-existent spec', async () => {
      const doc = await store.get('nonexistent', 1);
      expect(doc).toBeNull();
    });

    it('returns specific spec by name and version', async () => {
      await store.save(makeDoc({ version: 1 }));
      await store.save(makeDoc({ version: 2 }));

      const doc = await store.get('user-login', 1);
      expect(doc).not.toBeNull();
      expect(doc!.meta.version).toBe(1);
    });
  });

  // --- getLatest ---

  describe('getLatest', () => {
    it('returns null when no specs exist', async () => {
      const doc = await store.getLatest('user-login');
      expect(doc).toBeNull();
    });

    it('returns the highest version of a spec', async () => {
      await store.save(makeDoc({ version: 1 }));
      await store.save(makeDoc({ version: 3 }));
      await store.save(makeDoc({ version: 2 }));

      const doc = await store.getLatest('user-login');
      expect(doc).not.toBeNull();
      expect(doc!.meta.version).toBe(3);
    });
  });

  // --- updateStatus ---

  describe('updateStatus', () => {
    it('updates spec status from draft to approved', async () => {
      await store.save(makeDoc({ status: 'draft' }));
      await store.updateStatus('user-login', 1, 'approved');

      const doc = await store.get('user-login', 1);
      expect(doc!.meta.status).toBe('approved');
    });

    it('updates spec status from approved to superseded', async () => {
      await store.save(makeDoc({ status: 'approved' }));
      await store.updateStatus('user-login', 1, 'superseded');

      const doc = await store.get('user-login', 1);
      expect(doc!.meta.status).toBe('superseded');
    });

    it('throws on invalid status transition', async () => {
      await store.save(makeDoc({ status: 'draft' }));
      await expect(store.updateStatus('user-login', 1, 'completed')).rejects.toThrow();
    });

    it('throws when spec not found', async () => {
      await expect(store.updateStatus('nonexistent', 1, 'approved')).rejects.toThrow();
    });

    it('updates updatedAt timestamp', async () => {
      await store.save(makeDoc({ status: 'draft' }));
      const before = (await store.get('user-login', 1))!.meta.updatedAt;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));
      await store.updateStatus('user-login', 1, 'approved');

      const after = (await store.get('user-login', 1))!.meta.updatedAt;
      expect(after).not.toBe(before);
    });
  });

  // --- workspace isolation ---

  describe('workspace isolation', () => {
    it('does not see specs from different workspace', async () => {
      await store.save(makeDoc());

      const otherStore = new SpecStore(testDir, '/other/workspace');
      const list = await otherStore.list();
      expect(list).toHaveLength(0);
    });
  });
});
