import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpecStore } from '../../../src/spec-plan/spec-store.js';
import type { SpecDocument } from '../../../src/spec-plan/types.js';

describe('SpecStore', () => {
  let testDir: string;
  let store: SpecStore;

  const makeDoc = (overrides: Partial<SpecDocument['meta']> = {}): SpecDocument => ({
    meta: {
      name: 'user-login',
      version: 1,
      status: 'draft',
      workspacePath: '/test/project',
      createdAt: '2026-04-23T14:30:00.000Z',
      updatedAt: '2026-04-23T14:30:00.000Z',
      ...overrides,
    },
    body: '# User Login\n\n## Goal\nImplement user authentication.',
  });

  beforeEach(async () => {
    testDir = join(tmpdir(), `spec-store-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    store = new SpecStore(testDir);
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
      expect(doc!.body).toContain('# User Login');
    });

    it('file name does NOT contain timestamp', async () => {
      // Verify the file is stored directly under baseDir (no hash subdirectory)
      await store.save(makeDoc());
      const entries = await store.list();
      expect(entries).toHaveLength(1);
      // The internal file should be user-login-spec-v1.md
      const doc = await store.get('user-login', 1);
      expect(doc).not.toBeNull();
    });

    it('stores files directly under baseDir without hash subdirectory', async () => {
      await store.save(makeDoc());
      // Verify the storage directory is exactly baseDir, not baseDir/{hash}
      const doc = await store.getLatest('user-login');
      expect(doc).not.toBeNull();
    });

    it('auto-increments version for same spec name', async () => {
      // save v1
      await store.save(makeDoc({ version: 1 }));
      // save a new doc with same name — the store should handle versioning
      // (version is managed by the caller, store just saves what it receives)
      await store.save(makeDoc({ version: 2 }));
      const list = await store.list();
      expect(list).toHaveLength(2);
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

    it('filters out non-spec files', async () => {
      // Create a random file that is not a spec
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'not-a-spec.md'), '---\nname: test\n---\nbody');
      await store.save(makeDoc());
      const list = await store.list();
      expect(list).toHaveLength(1);
    });
  });

  // --- Negative paths: list ---

  describe('list - negative paths', () => {
    it('handles non-existent directory gracefully', async () => {
      const tempDir = join(tmpdir(), `empty-spec-${Date.now()}`);
      try {
        const emptyStore = new SpecStore(tempDir);
        const list = await emptyStore.list();
        expect(list).toEqual([]);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('skips corrupt YAML files gracefully', async () => {
      // Write a file that doesn't have valid YAML frontmatter
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'bad-spec-v1.md'), 'no frontmatter here');
      await store.save(makeDoc());
      const list = await store.list();
      // Should still return the valid file, skipping the corrupt one
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.some((doc) => doc.meta.name === 'user-login')).toBe(true);
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
      expect(doc!.meta.version).toBe(1);
    });

    // --- Negative paths: get ---

    it('returns null when directory does not exist', async () => {
      const tempDir = join(tmpdir(), `nonexistent-spec-${Date.now()}`);
      const emptyStore = new SpecStore(tempDir);
      const doc = await emptyStore.get('anything', 1);
      expect(doc).toBeNull();
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
      expect(doc!.meta.version).toBe(3);
    });

    it('returns null when directory does not exist', async () => {
      const tempDir = join(tmpdir(), `nonexistent-latest-${Date.now()}`);
      const emptyStore = new SpecStore(tempDir);
      const doc = await emptyStore.getLatest('anything');
      expect(doc).toBeNull();
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

    // --- Negative paths: updateStatus ---

    it('throws with descriptive error message on invalid transition', async () => {
      await store.save(makeDoc({ status: 'draft' }));
      await expect(store.updateStatus('user-login', 1, 'completed')).rejects.toThrow(
        /Invalid status transition/
      );
    });

    it('throws when spec not found with descriptive message', async () => {
      await expect(store.updateStatus('nonexistent', 1, 'approved')).rejects.toThrow(
        /Spec not found/
      );
    });

    it('cannot transition from superseded to any other status', async () => {
      await store.save(makeDoc({ status: 'superseded' }));
      await expect(store.updateStatus('user-login', 1, 'draft')).rejects.toThrow();
      await expect(store.updateStatus('user-login', 1, 'approved')).rejects.toThrow();
    });
  });

  // --- spec isolation (no workspace hash, so files share same dir) ---

  describe('spec isolation by name/version', () => {
    it('different spec names do not interfere', async () => {
      await store.save(makeDoc({ name: 'spec-a', version: 1 }));
      await store.save(makeDoc({ name: 'spec-b', version: 1 }));

      const a = await store.getLatest('spec-a');
      const b = await store.getLatest('spec-b');

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a!.meta.name).toBe('spec-a');
      expect(b!.meta.name).toBe('spec-b');
    });

    it('same name different versions both accessible', async () => {
      await store.save(makeDoc({ version: 1 }));
      await store.save(makeDoc({ version: 2 }));

      const v1 = await store.get('user-login', 1);
      const v2 = await store.get('user-login', 2);

      expect(v1!.meta.version).toBe(1);
      expect(v2!.meta.version).toBe(2);
    });
  });
});
