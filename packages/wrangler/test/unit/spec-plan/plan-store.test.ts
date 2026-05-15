import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { PlanStore } from '../../../src/spec-plan/plan-store.js';
import type { PlanDocument } from '../../../src/spec-plan/types.js';

describe('PlanStore', () => {
  let testDir: string;
  let store: PlanStore;

  const workspacePath = '/test/project';

  const makeDoc = (overrides: Partial<PlanDocument['meta']> = {}): PlanDocument => ({
    meta: {
      name: 'user-login',
      specName: 'user-login',
      specVersion: 1,
      version: 1,
      status: 'draft',
      workspacePath,
      createdAt: '2026-04-23T15:00:00.000Z',
      updatedAt: '2026-04-23T15:00:00.000Z',
      ...overrides,
    },
    body: '# Implementation Plan\n\n## Task 1\n- [ ] Step 1',
  });

  beforeEach(async () => {
    testDir = join(tmpdir(), `plan-store-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    store = new PlanStore(testDir, workspacePath);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- save ---

  describe('save', () => {
    it('writes plan document to file', async () => {
      await store.save(makeDoc());
      const list = await store.list();
      expect(list).toHaveLength(1);
      expect(list[0].meta.name).toBe('user-login');
      expect(list[0].meta.specVersion).toBe(1);
      expect(list[0].meta.version).toBe(1);
    });

    it('file name contains spec name and version', async () => {
      await store.save(makeDoc({ name: 'auth', specVersion: 2, version: 3 }));
      const doc = await store.get('auth', 2, 3);
      expect(doc).not.toBeNull();
      expect(doc!.meta.specVersion).toBe(2);
      expect(doc!.meta.version).toBe(3);
    });
  });

  // --- list ---

  describe('list', () => {
    it('returns empty array for empty directory', async () => {
      const list = await store.list();
      expect(list).toEqual([]);
    });

    it('returns all plans sorted by timestamp descending', async () => {
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
    it('returns null for non-existent plan', async () => {
      const doc = await store.get('nonexistent', 1, 1);
      expect(doc).toBeNull();
    });

    it('returns specific plan by name, specVersion, and version', async () => {
      await store.save(makeDoc({ specVersion: 1, version: 1 }));
      await store.save(makeDoc({ specVersion: 1, version: 2 }));

      const doc = await store.get('user-login', 1, 1);
      expect(doc).not.toBeNull();
      expect(doc!.meta.version).toBe(1);
    });
  });

  // --- getLatestForSpec ---

  describe('getLatestForSpec', () => {
    it('returns null when no plans exist', async () => {
      const doc = await store.getLatestForSpec('user-login');
      expect(doc).toBeNull();
    });

    it('returns latest plan for a spec', async () => {
      await store.save(makeDoc({ specVersion: 1, version: 1 }));
      await store.save(makeDoc({ specVersion: 1, version: 3 }));
      await store.save(makeDoc({ specVersion: 1, version: 2 }));

      const doc = await store.getLatestForSpec('user-login');
      expect(doc).not.toBeNull();
      expect(doc!.meta.version).toBe(3);
    });

    it('filters by specVersion when provided', async () => {
      await store.save(makeDoc({ specVersion: 1, version: 1 }));
      await store.save(makeDoc({ specVersion: 2, version: 1 }));

      const doc = await store.getLatestForSpec('user-login', 1);
      expect(doc).not.toBeNull();
      expect(doc!.meta.specVersion).toBe(1);
    });
  });

  // --- updateStatus ---

  describe('updateStatus', () => {
    it('updates plan status from draft to approved', async () => {
      await store.save(makeDoc({ status: 'draft' }));
      await store.updateStatus('user-login', 1, 1, 'approved');

      const doc = await store.get('user-login', 1, 1);
      expect(doc!.meta.status).toBe('approved');
    });

    it('updates plan status from approved to executing', async () => {
      await store.save(makeDoc({ status: 'approved' }));
      await store.updateStatus('user-login', 1, 1, 'executing');

      const doc = await store.get('user-login', 1, 1);
      expect(doc!.meta.status).toBe('executing');
    });

    it('updates plan status from executing to completed', async () => {
      await store.save(makeDoc({ status: 'executing' }));
      await store.updateStatus('user-login', 1, 1, 'completed');

      const doc = await store.get('user-login', 1, 1);
      expect(doc!.meta.status).toBe('completed');
    });

    it('throws on invalid status transition', async () => {
      await store.save(makeDoc({ status: 'draft' }));
      await expect(store.updateStatus('user-login', 1, 1, 'completed')).rejects.toThrow();
    });

    it('throws when plan not found', async () => {
      await expect(store.updateStatus('nonexistent', 1, 1, 'approved')).rejects.toThrow();
    });
  });

  // --- spec isolation ---

  describe('spec isolation', () => {
    it('different specs do not interfere', async () => {
      await store.save(makeDoc({ name: 'plan-a', specName: 'spec-a', specVersion: 1, version: 1 }));
      await store.save(makeDoc({ name: 'plan-b', specName: 'spec-b', specVersion: 1, version: 1 }));

      const latestA = await store.getLatestForSpec('spec-a');
      const latestB = await store.getLatestForSpec('spec-b');

      expect(latestA!.meta.name).toBe('plan-a');
      expect(latestB!.meta.name).toBe('plan-b');
    });

    it('same spec multiple plan versions', async () => {
      await store.save(makeDoc({ specVersion: 1, version: 1 }));
      await store.save(makeDoc({ specVersion: 1, version: 2 }));
      await store.save(makeDoc({ specVersion: 2, version: 1 }));

      const latest = await store.getLatestForSpec('user-login');
      expect(latest!.meta.version).toBe(2);
    });
  });

  // --- workspace path normalization ---

  describe('workspace path normalization', () => {
    it('relative and absolute paths to same workspace produce same directory', async () => {
      await store.save(makeDoc());

      const relPath = relative(process.cwd(), workspacePath);
      const relativeStore = new PlanStore(testDir, relPath);
      const list = await relativeStore.list();
      expect(list).toHaveLength(1);
      expect(list[0].meta.name).toBe('user-login');
    });
  });

  // --- workspace isolation ---

  describe('workspace isolation', () => {
    it('does not see plans from different workspace', async () => {
      await store.save(makeDoc());

      const otherStore = new PlanStore(testDir, '/other/workspace');
      const list = await otherStore.list();
      expect(list).toHaveLength(0);
    });
  });
});
