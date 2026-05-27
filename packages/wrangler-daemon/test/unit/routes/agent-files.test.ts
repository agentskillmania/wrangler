import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { agentFileRoutes } from '../../../src/routes/agent-files.js';
import type { DecoratedFastifyInstance } from '../../../src/types.js';

/**
 * Unit tests for agent file operation routes.
 *
 * Tests the following routes:
 * - GET /api/agents/:id/files — recursive file listing
 * - GET /api/agents/:id/file?path=... — read file content
 * - PUT /api/agents/:id/file — write to existing file (body: {path, content})
 * - POST /api/agents/:id/file — create new file (body: {path, content?})
 * - DELETE /api/agents/:id/file — delete file (body: {path})
 */
describe('agent file routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let resourceManager: ResourceManager;
  let agentId: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-agent-files-'));

    // Create resource directories
    const agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    await mkdir(agentsDir, { recursive: true });
    await mkdir(skillsDir, { recursive: true });
    await mkdir(crewsDir, { recursive: true });

    // Initialize ResourceManager and create an agent
    resourceManager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await resourceManager.init();
    agentId = await resourceManager.createAgent({
      name: 'test-agent',
      instructions: 'Test agent for file operations',
    });

    // Add some test files to the agent directory
    const agentPath = join(agentsDir, agentId);
    await writeFile(join(agentPath, 'notes.txt'), 'hello', 'utf-8');
    await mkdir(join(agentPath, 'skills'), { recursive: true });
    await writeFile(join(agentPath, 'skills', 'skill1.md'), '# Skill 1', 'utf-8');

    // Boot Fastify with resourceManager decoration
    fastify = Fastify();
    (fastify as unknown as DecoratedFastifyInstance).resourceManager = resourceManager;
    fastify.register(agentFileRoutes);
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
    it('GET /api/agents/:id/files returns recursive file listing with name/path/size/isDirectory', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/files`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);

      // Should have entries for AGENT.md, notes.txt, and skills/
      const entries = body as Array<{
        name: string;
        path: string;
        size: number;
        isDirectory: boolean;
      }>;
      expect(entries.length).toBeGreaterThan(0);

      // Check structure
      const agentMd = entries.find((e) => e.name === 'AGENT.md');
      expect(agentMd).toBeDefined();
      expect(agentMd?.path).toBe('AGENT.md');
      expect(agentMd?.size).toBeGreaterThan(0);
      expect(agentMd?.isDirectory).toBe(false);

      const skillsDirEntry = entries.find((e) => e.name === 'skills');
      expect(skillsDirEntry).toBeDefined();
      expect(skillsDirEntry?.isDirectory).toBe(true);
      expect(skillsDirEntry?.size).toBe(0);
      expect(Array.isArray(skillsDirEntry?.children)).toBe(true);
    });

    it('GET /api/agents/:id/file?path=notes.txt reads file content correctly', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/file?path=notes.txt`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.content).toBe('hello');
      expect(body.path).toBe('notes.txt');
    });

    it('GET /api/agents/:id/file returns error "path is required" when path missing', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/file`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('GET /api/agents/:id/file returns error "File not found" for non-existent file', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/file?path=does-not-exist.txt`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('File not found');
    });

    it('PUT /api/agents/:id/file updates existing file content (write then read back to verify)', async () => {
      const writeRes = await fetch(`${baseUrl()}/api/agents/${agentId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'notes.txt', content: 'updated content' }),
      });
      expect(writeRes.ok).toBe(true);
      expect((await writeRes.json()).ok).toBe(true);

      const readRes = await fetch(`${baseUrl()}/api/agents/${agentId}/file?path=notes.txt`);
      expect((await readRes.json()).content).toBe('updated content');
    });

    it('PUT /api/agents/:id/file returns error "path and content required" when missing', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'notes.txt' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path and content required');
    });

    it('POST /api/agents/:id/file creates new file with nested dirs', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'deep/nested/file.txt', content: 'nested content' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.path).toBe('deep/nested/file.txt');

      const readRes = await fetch(
        `${baseUrl()}/api/agents/${agentId}/file?path=deep/nested/file.txt`
      );
      expect((await readRes.json()).content).toBe('nested content');
    });

    it('POST /api/agents/:id/file returns error "path is required" when missing', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'orphan content' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path is required');
    });

    it('DELETE /api/agents/:id/file deletes file (verify file gone after)', async () => {
      const delRes = await fetch(`${baseUrl()}/api/agents/${agentId}/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'notes.txt' }),
      });
      expect(delRes.ok).toBe(true);
      expect((await delRes.json()).ok).toBe(true);

      const readRes = await fetch(`${baseUrl()}/api/agents/${agentId}/file?path=notes.txt`);
      expect((await readRes.json()).error).toBe('File not found');
    });

    it('DELETE /api/agents/:id/file returns error "path is required" when missing', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/file`, {
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
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/file?path=../../../etc/passwd`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('File not found');
    });

    it('blocks traversal via PUT file (../../tmp/evil.txt → response.ok not true or error)', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../tmp/evil.txt', content: 'pwned' }),
      });
      // Should fail — resolvePath throws "Path outside agent directory"
      const body = await res.json();
      expect(body.ok).not.toBe(true);
    });

    it('blocks traversal via POST create (../../tmp/evil.txt → response.ok not true or error)', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../tmp/evil.txt', content: 'pwned' }),
      });
      const body = await res.json();
      expect(body.ok).not.toBe(true);
    });

    it('blocks traversal via DELETE (../../tmp/important.txt → not deleted)', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/${agentId}/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../tmp/important.txt' }),
      });
      const body = await res.json();
      expect(body.ok).not.toBe(true);
    });
  });

  // ------------------------------------------------------------------ Non-existent agent
  describe('Non-existent agent error handling', () => {
    it('GET files returns error for non-existent agent', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/nonexistent-agent/files`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Agent not found');
    });

    it('GET file returns error for non-existent agent', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/nonexistent-agent/file?path=AGENT.md`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Agent not found');
    });

    it('PUT file returns error for non-existent agent', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/nonexistent-agent/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'AGENT.md', content: 'test' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Agent not found');
    });

    it('DELETE file returns error for non-existent agent', async () => {
      const res = await fetch(`${baseUrl()}/api/agents/nonexistent-agent/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'AGENT.md' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Agent not found');
    });
  });
});
