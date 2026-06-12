import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { crewFileRoutes } from '../../../src/routes/crew-files.js';
import type { DecoratedFastifyInstance } from '../../../src/types.js';

/**
 * Unit tests for crew file operation routes.
 *
 * Tests the following routes:
 * - GET /api/crews/:id/files — recursive file listing
 * - GET /api/crews/:id/file?path=... — read file content
 * - PUT /api/crews/:id/file — write to existing file (body: {path, content})
 * - POST /api/crews/:id/file — create new file (body: {path, content?})
 * - DELETE /api/crews/:id/file — delete file (body: {path})
 */
describe('crew file routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let resourceManager: ResourceManager;
  let crewId: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-crew-files-'));

    // Create resource directories
    const agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    await mkdir(agentsDir, { recursive: true });
    await mkdir(skillsDir, { recursive: true });
    await mkdir(crewsDir, { recursive: true });

    // Initialize ResourceManager and create a crew
    resourceManager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await resourceManager.init();
    crewId = await resourceManager.createCrew({
      name: 'test-crew',
      description: 'Test crew for file operations',
      instructions: 'Test instructions',
    });

    // Add some test files to the crew directory
    const crewPath = join(crewsDir, crewId);
    await writeFile(join(crewPath, 'CREW.md'), '# Test Crew\n\nTest instructions', 'utf-8');
    await mkdir(join(crewPath, 'agents'), { recursive: true });
    await writeFile(join(crewPath, 'agents', 'agent1.md'), '# Agent 1', 'utf-8');
    await mkdir(join(crewPath, 'skills'), { recursive: true });
    await writeFile(join(crewPath, 'skills', 'skill1.md'), '# Skill 1', 'utf-8');

    // Boot Fastify with resourceManager decoration
    fastify = Fastify();
    (fastify as unknown as DecoratedFastifyInstance).resourceManager = resourceManager;
    await fastify.register(crewFileRoutes);
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
    it('GET /api/crews/:id/files returns recursive file listing with name/path/size/isDirectory', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/files`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);

      // Should have entries for CREW.md, agents/, and skills/
      const entries = body as Array<{
        name: string;
        path: string;
        size: number;
        isDirectory: boolean;
      }>;
      expect(entries.length).toBeGreaterThan(0);

      // Check structure
      const crewMd = entries.find((e) => e.name === 'CREW.md');
      expect(crewMd).toBeDefined();
      expect(crewMd?.path).toBe('CREW.md');
      expect(crewMd?.size).toBeGreaterThan(0);
      expect(crewMd?.isDirectory).toBe(false);

      const agentsDir = entries.find((e) => e.name === 'agents');
      expect(agentsDir).toBeDefined();
      expect(agentsDir?.isDirectory).toBe(true);
      expect(agentsDir?.size).toBe(0);
      expect(Array.isArray(agentsDir?.children)).toBe(true);
    });

    it('GET /api/crews/:id/file?path=CREW.md reads file content correctly', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/file?path=CREW.md`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.content).toBe('# Test Crew\n\nTest instructions');
      expect(body.path).toBe('CREW.md');
    });

    it('GET /api/crews/:id/file returns error "path is required" when path missing', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/file`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('GET /api/crews/:id/file returns error "File not found" for non-existent file', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/file?path=does-not-exist.txt`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('File not found');
    });

    it('PUT /api/crews/:id/file updates existing file content (write then read back to verify)', async () => {
      const writeRes = await fetch(`${baseUrl()}/api/crews/${crewId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'CREW.md', content: '# Updated Crew' }),
      });
      expect(writeRes.ok).toBe(true);
      expect((await writeRes.json()).ok).toBe(true);

      const readRes = await fetch(`${baseUrl()}/api/crews/${crewId}/file?path=CREW.md`);
      expect((await readRes.json()).content).toBe('# Updated Crew');
    });

    it('PUT /api/crews/:id/file returns error "path and content required" when missing', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'CREW.md' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path and content required');
    });

    it('POST /api/crews/:id/file creates new file with nested dirs', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'deep/nested/file.txt', content: 'nested content' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.path).toBe('deep/nested/file.txt');

      const readRes = await fetch(
        `${baseUrl()}/api/crews/${crewId}/file?path=deep/nested/file.txt`
      );
      expect((await readRes.json()).content).toBe('nested content');
    });

    it('POST /api/crews/:id/file returns error "path is required" when missing', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'orphan content' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path is required');
    });

    it('DELETE /api/crews/:id/file deletes file (verify file gone after)', async () => {
      const delRes = await fetch(`${baseUrl()}/api/crews/${crewId}/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'agents/agent1.md' }),
      });
      expect(delRes.ok).toBe(true);
      expect((await delRes.json()).ok).toBe(true);

      const readRes = await fetch(`${baseUrl()}/api/crews/${crewId}/file?path=agents/agent1.md`);
      expect((await readRes.json()).error).toBe('File not found');
    });

    it('DELETE /api/crews/:id/file returns error "path is required" when missing', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/file`, {
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
    it('blocks traversal via GET file — returns error not file content', async () => {
      // Create a file outside the crew dir to prove traversal would find it
      const outsideFile = join(tempDir, 'sensitive.txt');
      await writeFile(outsideFile, 'secret data', 'utf-8');
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/file?path=../../sensitive.txt`);
      const body = await res.json();
      // Must NOT return the file content — either error or no content
      expect(body.content).not.toBe('secret data');
      expect(body.error).toBeDefined();
    });

    it('blocks traversal via PUT file (../../tmp/evil.txt → response.ok not true or error)', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../tmp/evil.txt', content: 'pwned' }),
      });
      // Should fail — resolvePath throws "Path outside crew directory"
      const body = await res.json();
      expect(body.ok).not.toBe(true);
    });

    it('blocks traversal via POST create (../../tmp/evil.txt → response.ok not true or error)', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../tmp/evil.txt', content: 'pwned' }),
      });
      const body = await res.json();
      expect(body.ok).not.toBe(true);
    });

    it('blocks traversal via DELETE — external file must survive', async () => {
      const outsideFile = join(tempDir, 'important.txt');
      await writeFile(outsideFile, 'do not delete', 'utf-8');
      const res = await fetch(`${baseUrl()}/api/crews/${crewId}/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../important.txt' }),
      });
      const body = await res.json();
      expect(body.ok).not.toBe(true);
      // The external file must still exist on disk
      expect(existsSync(outsideFile)).toBe(true);
    });
  });

  // ------------------------------------------------------------------ Non-existent crew
  describe('Non-existent crew error handling', () => {
    it('GET files returns error for non-existent crew', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/nonexistent-crew/files`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Crew not found');
    });

    it('GET file returns error for non-existent crew', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/nonexistent-crew/file?path=CREW.md`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Crew not found');
    });

    it('PUT file returns error for non-existent crew', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/nonexistent-crew/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'CREW.md', content: 'test' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Crew not found');
    });

    it('DELETE file returns error for non-existent crew', async () => {
      const res = await fetch(`${baseUrl()}/api/crews/nonexistent-crew/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'CREW.md' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Crew not found');
    });
  });
});
