import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { skillFileRoutes } from '../../../src/routes/skill-files.js';
import type { DecoratedFastifyInstance } from '../../../src/types.js';

/**
 * Unit tests for skill file operation routes.
 *
 * Tests the following routes:
 * - GET /api/skills/:id/files — file listing from skill detail
 * - GET /api/skills/:id/file?path=... — read file content
 * - PUT /api/skills/:id/file — write to existing file (body: {path, content})
 * - POST /api/skills/:id/file — create new file (body: {path, content?})
 * - DELETE /api/skills/:id/file — delete file (body: {path})
 */
describe('skill file routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let resourceManager: ResourceManager;
  let skillId: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-skill-files-'));

    // Create resource directories
    const agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    await mkdir(agentsDir, { recursive: true });
    await mkdir(skillsDir, { recursive: true });
    await mkdir(crewsDir, { recursive: true });

    // Initialize ResourceManager and create a skill
    resourceManager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await resourceManager.init();
    skillId = await resourceManager.createSkill({
      name: 'test-skill',
      description: 'Test skill for file operations',
    });

    // Add some test files to the skill directory
    const skillPath = join(skillsDir, skillId);
    await writeFile(join(skillPath, 'data.txt'), 'content', 'utf-8');

    // Boot Fastify with resourceManager decoration
    fastify = Fastify();
    (fastify as unknown as DecoratedFastifyInstance).resourceManager = resourceManager;
    fastify.register(skillFileRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await fastify.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Resolve the ephemeral base URL for the running Fastify instance. */
  function baseUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  // ------------------------------------------------------------------ File operations
  describe('File operations', () => {
    it('GET /api/skills/:id/files returns file listing with name/path/size', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/files`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);

      // Should have entries for SKILL.md and data.txt
      const entries = body as Array<{
        name: string;
        path: string;
        size: number;
      }>;
      expect(entries.length).toBeGreaterThan(0);

      // Check structure — getSkill returns flat file list with path relative to skill directory
      const dataEntry = entries.find((e) => e.name === 'data.txt');
      expect(dataEntry).toBeDefined();
      expect(dataEntry?.path).toBe('data.txt');
      expect(dataEntry?.size).toBeGreaterThan(0);

      const skillMd = entries.find((e) => e.name === 'SKILL.md');
      expect(skillMd).toBeDefined();
      expect(skillMd?.size).toBeGreaterThan(0);
    });

    it('GET /api/skills/:id/file?path=data.txt reads file content correctly', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/file?path=data.txt`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.content).toBe('content');
      expect(body.path).toBe('data.txt');
    });

    it('GET /api/skills/:id/file returns error "path is required" when path missing', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/file`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('GET /api/skills/:id/file returns error "File not found" for non-existent file', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/file?path=does-not-exist.txt`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('File not found');
    });

    it('PUT /api/skills/:id/file updates existing file content (write then read back to verify)', async () => {
      const writeRes = await fetch(`${baseUrl()}/api/skills/${skillId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'data.txt', content: 'updated content' }),
      });
      expect(writeRes.ok).toBe(true);
      expect((await writeRes.json()).ok).toBe(true);

      const readRes = await fetch(`${baseUrl()}/api/skills/${skillId}/file?path=data.txt`);
      expect((await readRes.json()).content).toBe('updated content');
    });

    it('PUT /api/skills/:id/file returns error "path and content required" when missing', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'data.txt' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path and content required');
    });

    it('POST /api/skills/:id/file creates new file with nested dirs', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'deep/nested/file.txt', content: 'nested content' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.path).toBe('deep/nested/file.txt');

      const readRes = await fetch(
        `${baseUrl()}/api/skills/${skillId}/file?path=deep/nested/file.txt`
      );
      expect((await readRes.json()).content).toBe('nested content');
    });

    it('POST /api/skills/:id/file returns error "path is required" when missing', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'orphan content' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path is required');
    });

    it('DELETE /api/skills/:id/file deletes file (verify file gone after)', async () => {
      const delRes = await fetch(`${baseUrl()}/api/skills/${skillId}/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'data.txt' }),
      });
      expect(delRes.ok).toBe(true);
      expect((await delRes.json()).ok).toBe(true);

      const readRes = await fetch(`${baseUrl()}/api/skills/${skillId}/file?path=data.txt`);
      expect((await readRes.json()).error).toBe('File not found');
    });

    it('DELETE /api/skills/:id/file returns error "path is required" when missing', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path is required');
    });
  });

  // ------------------------------------------------------------------ Path traversal
  describe('Path traversal security', () => {
    it('blocks traversal via GET file (../../../etc/passwd → "File not found")', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/file?path=../../../etc/passwd`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('File not found');
    });

    it('blocks traversal via PUT file (../../tmp/evil.txt → response.ok not true or error)', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../tmp/evil.txt', content: 'pwned' }),
      });
      // Should fail — resolvePath throws "Path outside skill directory"
      const body = await res.json();
      expect(body.ok).not.toBe(true);
    });

    it('blocks traversal via POST create (../../tmp/evil.txt → response.ok not true or error)', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../tmp/evil.txt', content: 'pwned' }),
      });
      const body = await res.json();
      expect(body.ok).not.toBe(true);
    });

    it('blocks traversal via DELETE (../../tmp/important.txt → not deleted)', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/${skillId}/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../tmp/important.txt' }),
      });
      const body = await res.json();
      expect(body.ok).not.toBe(true);
    });
  });

  // ------------------------------------------------------------------ Non-existent skill
  describe('Non-existent skill error handling', () => {
    it('GET files returns error for non-existent skill', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/nonexistent-skill/files`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Skill not found');
    });

    it('GET file returns error for non-existent skill', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/nonexistent-skill/file?path=SKILL.md`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Skill not found');
    });

    it('PUT file returns error for non-existent skill', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/nonexistent-skill/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'SKILL.md', content: 'test' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Skill not found');
    });

    it('DELETE file returns error for non-existent skill', async () => {
      const res = await fetch(`${baseUrl()}/api/skills/nonexistent-skill/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'SKILL.md' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Skill not found');
    });
  });
});
