import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeMeta, readMeta } from '../../../src/session/meta.js';
import type { SessionMeta } from '../../../src/types.js';
import { NodeHostEnv } from '../../../src/host-env/node-host-env.js';

describe('session/meta', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `wrangler-test-meta-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const sampleMeta: SessionMeta = {
    id: '1745848800000-abc123xyz',
    workspacePath: '/Users/dev/my-project',
    createdAt: '2026-04-28T14:30:00.000Z',
    updatedAt: '2026-04-28T14:30:00.000Z',
    model: 'GLM-4.7',
    agentName: 'test-agent',
  };

  describe('writeMeta', () => {
    it('should write meta.yaml to the session directory', async () => {
      await writeMeta(testDir, sampleMeta, new NodeHostEnv());
      const content = await readFile(join(testDir, 'meta.yaml'), 'utf-8');
      expect(content).toContain('1745848800000-abc123xyz');
      expect(content).toContain('/Users/dev/my-project');
      expect(content).toContain('GLM-4.7');
    });

    it('should overwrite existing meta.yaml', async () => {
      await writeMeta(testDir, sampleMeta, new NodeHostEnv());
      const updated = { ...sampleMeta, agentName: 'updated-agent' };
      await writeMeta(testDir, updated, new NodeHostEnv());
      const content = await readFile(join(testDir, 'meta.yaml'), 'utf-8');
      expect(content).toContain('updated-agent');
    });
  });

  describe('readMeta', () => {
    it('should read and parse meta.yaml', async () => {
      await writeMeta(testDir, sampleMeta, new NodeHostEnv());
      const meta = await readMeta(testDir, new NodeHostEnv());
      expect(meta).toEqual(sampleMeta);
    });

    it('should return null when meta.yaml does not exist', async () => {
      const meta = await readMeta(testDir, new NodeHostEnv());
      expect(meta).toBeNull();
    });

    it('should return null when directory does not exist', async () => {
      const meta = await readMeta(join(tmpdir(), 'nonexistent-dir-xyz'), new NodeHostEnv());
      expect(meta).toBeNull();
    });
  });
});
