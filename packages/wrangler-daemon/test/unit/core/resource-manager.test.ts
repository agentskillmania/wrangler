/**
 * @fileoverview Unit tests for ResourceManager path-validation contracts.
 *
 * Source file: src/core/resource-manager.ts
 * Layer: UNIT — uses a real temp directory but tests the manager's validation
 * logic directly (no HTTP, no Fastify).
 *
 * Covers SEC7 (delete without validateName) and SEC8 (get without validateName):
 * every get/delete method must reject ids containing path traversal sequences
 * (.., /, \) before joining them into a filesystem path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ResourceManager } from '../../../src/core/resource-manager.js';

describe('ResourceManager path validation (SEC7/SEC8)', () => {
  let tempDir: string;
  let manager: ResourceManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'rm-sec78-'));
    const agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    await mkdir(agentsDir, { recursive: true });
    await mkdir(skillsDir, { recursive: true });
    await mkdir(crewsDir, { recursive: true });
    // Plant a "sibling" dir that a traversal would escape into
    await mkdir(join(tempDir, 'sibling-secret'), { recursive: true });
    await writeFile(join(tempDir, 'sibling-secret', 'SECRET.txt'), 'TOPSECRET');

    manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── SEC7: delete must reject traversal ids ────────────────

  describe('SEC7: delete methods reject path-traversal ids', () => {
    it('deleteAgent rejects ".." id', async () => {
      await expect(manager.deleteAgent('..')).rejects.toThrow();
    });

    it('deleteAgent rejects id with path separator', async () => {
      await expect(manager.deleteAgent('../sibling-secret')).rejects.toThrow();
    });

    it('deleteSkill rejects ".." id', async () => {
      await expect(manager.deleteSkill('..')).rejects.toThrow();
    });

    it('deleteCrew rejects ".." id', async () => {
      await expect(manager.deleteCrew('..')).rejects.toThrow();
    });

    it('delete does not remove parent directory', async () => {
      // Even if the call somehow proceeds, the sibling-secret must survive
      try {
        await manager.deleteAgent('..');
      } catch {
        // expected to throw
      }
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(join(tempDir, 'sibling-secret', 'SECRET.txt'), 'utf-8');
      expect(content).toBe('TOPSECRET');
    });
  });

  // ─── SEC8: get must reject traversal ids ───────────────────

  describe('SEC8: get methods reject path-traversal ids', () => {
    it('getAgent rejects ".." id', async () => {
      await expect(manager.getAgent('..')).rejects.toThrow();
    });

    it('getSkill rejects ".." id', async () => {
      await expect(manager.getSkill('..')).rejects.toThrow();
    });

    it('getCrew rejects ".." id', async () => {
      await expect(manager.getCrew('..')).rejects.toThrow();
    });

    it('getAgent rejects id with path separator', async () => {
      await expect(manager.getAgent('../sibling-secret')).rejects.toThrow();
    });
  });

  // ─── Normal operation still works ──────────────────────────

  describe('normal operation (no false positives)', () => {
    it('createAgent + getAgent + deleteAgent work with valid name', async () => {
      await manager.createAgent({
        name: 'my-agent',
        description: 'test',
        instructions: 'be helpful',
      });
      const detail = await manager.getAgent('my-agent');
      expect(detail).not.toBeNull();
      expect(detail?.name).toBe('my-agent');
      await manager.deleteAgent('my-agent');
      const after = await manager.getAgent('my-agent');
      expect(after).toBeNull();
    });
  });
});
