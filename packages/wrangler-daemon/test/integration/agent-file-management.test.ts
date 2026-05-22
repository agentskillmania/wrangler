/**
 * @fileoverview User Story: Agent File Management (Integration)
 *
 * US-C6: As a developer, I want to browse and edit files within an agent
 * directory so that I can manage AGENT.md, mcp.json, and private skills.
 *
 * Route: src/routes/agent-files.ts with agentFileRoutes
 * Decorate: resourceManager (ResourceManager)
 *
 * Acceptance Criteria:
 * 1. GET /api/agents/:id/files lists files in agent directory (excludes hidden/node_modules)
 * 2. GET /api/agents/:id/file reads a specific file
 * 3. PUT /api/agents/:id/file updates a specific file
 * 4. POST /api/agents/:id/file creates a new file (with nested dirs)
 * 5. DELETE /api/agents/:id/file deletes a specific file
 * 6. Path traversal is rejected
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { agentFileRoutes } from '../../src/routes/agent-files.js';

describe('Integration: Agent File Management (US-C6)', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-agent-file-mgmt-'));
    agentsDir = join(tempDir, 'agents');
    const resourceManager = new ResourceManager(agentsDir, join(tempDir, 'skills'));
    await resourceManager.init();

    fastify = Fastify();
    fastify.decorate('resourceManager', resourceManager);
    fastify.register(agentFileRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await fastify.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  function getResourceManager(): ResourceManager {
    return (fastify as any).resourceManager as ResourceManager;
  }

  // ─── AC 1: List files in agent directory ─────────────────────

  describe('GET /api/agents/:id/files - List files', () => {
    it('returns file tree for an agent with default AGENT.md', async () => {
      await getResourceManager().createAgent({
        name: 'list-agent',
        instructions: 'I have files.',
      });

      const res = await fetch(`${getUrl()}/api/agents/list-agent/files`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.some((f: any) => f.name === 'AGENT.md')).toBe(true);
    });

    it('returns error for unknown agent', async () => {
      const res = await fetch(`${getUrl()}/api/agents/nonexistent-agent/files`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Agent not found');
    });

    it('includes nested directories with children', async () => {
      const rm = getResourceManager();
      await rm.createAgent({ name: 'nested-agent', instructions: 'Nested.' });

      // Create a private skill directory structure
      const skillDir = join(agentsDir, 'nested-agent', 'skills', 'search');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: search\n---\n', 'utf-8');
      await writeFile(join(skillDir, 'index.ts'), 'export default {}', 'utf-8');

      const res = await fetch(`${getUrl()}/api/agents/nested-agent/files`);
      expect(res.ok).toBe(true);
      const body = await res.json();

      const skillsDir = body.find((f: any) => f.name === 'skills');
      expect(skillsDir).toBeDefined();
      expect(skillsDir.isDirectory).toBe(true);
      expect(skillsDir.children).toBeDefined();

      const searchDir = skillsDir.children.find((f: any) => f.name === 'search');
      expect(searchDir).toBeDefined();
      expect(searchDir.children.some((f: any) => f.name === 'SKILL.md')).toBe(true);
      expect(searchDir.children.some((f: any) => f.name === 'index.ts')).toBe(true);
    });

    it('excludes hidden files and node_modules from listing', async () => {
      const rm = getResourceManager();
      await rm.createAgent({ name: 'filtered-agent', instructions: 'Filtered.' });
      const agentDir = join(agentsDir, 'filtered-agent');

      await writeFile(join(agentDir, '.hidden'), 'secret', 'utf-8');
      await mkdir(join(agentDir, 'node_modules'), { recursive: true });
      await writeFile(join(agentDir, 'node_modules', 'pkg'), 'pkg', 'utf-8');

      const res = await fetch(`${getUrl()}/api/agents/filtered-agent/files`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      const names = body.map((f: any) => f.name);
      expect(names).not.toContain('.hidden');
      expect(names).not.toContain('node_modules');
    });
  });

  // ─── AC 2: Read a specific file ──────────────────────────────

  describe('GET /api/agents/:id/file - Read file', () => {
    it('returns content of AGENT.md', async () => {
      await getResourceManager().createAgent({
        name: 'reader-agent',
        instructions: 'Read me.',
      });

      const res = await fetch(`${getUrl()}/api/agents/reader-agent/file?path=AGENT.md`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.content).toContain('Read me.');
      expect(body.path).toBe('AGENT.md');
    });

    it('reads nested files within the agent directory', async () => {
      const rm = getResourceManager();
      await rm.createAgent({ name: 'nested-read', instructions: 'Nested.' });
      const skillDir = join(agentsDir, 'nested-read', 'skills', 'util');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'index.ts'), 'export const x = 1;', 'utf-8');

      const res = await fetch(`${getUrl()}/api/agents/nested-read/file?path=skills/util/index.ts`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.content).toBe('export const x = 1;');
    });

    it('returns error when path parameter is missing', async () => {
      await getResourceManager().createAgent({ name: 'no-path-agent', instructions: 'Test.' });

      const res = await fetch(`${getUrl()}/api/agents/no-path-agent/file`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('returns error for a file that does not exist', async () => {
      await getResourceManager().createAgent({ name: 'missing-file', instructions: 'Test.' });

      const res = await fetch(`${getUrl()}/api/agents/missing-file/file?path=nonexistent.ts`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('File not found');
    });

    it('returns error for unknown agent', async () => {
      const res = await fetch(`${getUrl()}/api/agents/unknown/file?path=AGENT.md`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Agent not found');
    });
  });

  // ─── AC 3: Update a specific file ────────────────────────────

  describe('PUT /api/agents/:id/file - Update file', () => {
    it('updates AGENT.md with new content', async () => {
      await getResourceManager().createAgent({
        name: 'updater-agent',
        instructions: 'Original.',
      });

      const res = await fetch(`${getUrl()}/api/agents/updater-agent/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'AGENT.md',
          content: '---\nname: updater-agent\n---\n\nUpdated instructions.',
        }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(`${getUrl()}/api/agents/updater-agent/file?path=AGENT.md`);
      const body = await readRes.json();
      expect(body.content).toContain('Updated instructions.');
    });

    it('updates a nested file within the agent directory', async () => {
      const rm = getResourceManager();
      await rm.createAgent({ name: 'nested-update', instructions: 'Nested.' });
      const configDir = join(agentsDir, 'nested-update', 'config');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'mcp.json'), '{"tools": []}', 'utf-8');

      const res = await fetch(`${getUrl()}/api/agents/nested-update/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'config/mcp.json',
          content: '{"tools": ["search"]}',
        }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(`${getUrl()}/api/agents/nested-update/file?path=config/mcp.json`);
      const body = await readRes.json();
      expect(body.content).toBe('{"tools": ["search"]}');
    });

    it('returns error when path is missing', async () => {
      await getResourceManager().createAgent({ name: 'put-no-path', instructions: 'Test.' });

      const res = await fetch(`${getUrl()}/api/agents/put-no-path/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'missing path' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path and content required');
    });

    it('returns error when content is missing', async () => {
      await getResourceManager().createAgent({ name: 'put-no-content', instructions: 'Test.' });

      const res = await fetch(`${getUrl()}/api/agents/put-no-content/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'AGENT.md' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path and content required');
    });

    it('returns error for unknown agent', async () => {
      const res = await fetch(`${getUrl()}/api/agents/unknown/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test.ts', content: '' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Agent not found');
    });

    it('allows writing empty string content', async () => {
      await getResourceManager().createAgent({ name: 'empty-write', instructions: 'Test.' });

      // Create a file first
      await fetch(`${getUrl()}/api/agents/empty-write/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'clear-me.txt', content: 'has content' }),
      });

      const res = await fetch(`${getUrl()}/api/agents/empty-write/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'clear-me.txt', content: '' }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(`${getUrl()}/api/agents/empty-write/file?path=clear-me.txt`);
      const body = await readRes.json();
      expect(body.content).toBe('');
    });
  });

  // ─── AC 4: Create a new file (with nested dirs) ──────────────

  describe('POST /api/agents/:id/file - Create file', () => {
    it('creates a new file in the agent directory', async () => {
      await getResourceManager().createAgent({ name: 'creator-agent', instructions: 'Create.' });

      const res = await fetch(`${getUrl()}/api/agents/creator-agent/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'notes.txt', content: 'Some notes' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.path).toBe('notes.txt');

      // Verify on disk
      const onDisk = await readFile(join(agentsDir, 'creator-agent', 'notes.txt'), 'utf-8');
      expect(onDisk).toBe('Some notes');
    });

    it('creates nested directories and file when parent dirs do not exist', async () => {
      await getResourceManager().createAgent({
        name: 'nested-creator',
        instructions: 'Nested.',
      });

      const res = await fetch(`${getUrl()}/api/agents/nested-creator/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'skills/helper/index.ts',
          content: 'export default {};',
        }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(
        `${getUrl()}/api/agents/nested-creator/file?path=skills/helper/index.ts`
      );
      const body = await readRes.json();
      expect(body.content).toBe('export default {};');

      // Verify nested directory was created on disk
      expect(existsSync(join(agentsDir, 'nested-creator', 'skills', 'helper'))).toBe(true);
    });

    it('creates file with empty content when content is not provided', async () => {
      await getResourceManager().createAgent({
        name: 'default-content',
        instructions: 'Default.',
      });

      const res = await fetch(`${getUrl()}/api/agents/default-content/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'empty.txt' }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(`${getUrl()}/api/agents/default-content/file?path=empty.txt`);
      const body = await readRes.json();
      expect(body.content).toBe('');
    });

    it('returns error when path is missing', async () => {
      await getResourceManager().createAgent({
        name: 'post-no-path',
        instructions: 'Test.',
      });

      const res = await fetch(`${getUrl()}/api/agents/post-no-path/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'no path' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('returns error for unknown agent', async () => {
      const res = await fetch(`${getUrl()}/api/agents/unknown/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test.ts', content: 'test' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Agent not found');
    });

    it('creates mcp.json configuration file', async () => {
      await getResourceManager().createAgent({
        name: 'mcp-agent',
        instructions: 'MCP config.',
      });

      const mcpContent = JSON.stringify({
        mcpServers: {
          search: { command: 'npx', args: ['search-server'] },
        },
      });

      const res = await fetch(`${getUrl()}/api/agents/mcp-agent/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'mcp.json', content: mcpContent }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(`${getUrl()}/api/agents/mcp-agent/file?path=mcp.json`);
      const body = await readRes.json();
      expect(body.content).toBe(mcpContent);
    });
  });

  // ─── AC 5: Delete a specific file ────────────────────────────

  describe('DELETE /api/agents/:id/file - Delete file', () => {
    it('deletes an existing file from the agent directory', async () => {
      await getResourceManager().createAgent({
        name: 'deleter-agent',
        instructions: 'Delete.',
      });

      // Create a file first
      await fetch(`${getUrl()}/api/agents/deleter-agent/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'temp.md', content: 'temporary' }),
      });

      // Verify it exists
      const beforeDelete = await fetch(`${getUrl()}/api/agents/deleter-agent/file?path=temp.md`);
      expect((await beforeDelete.json()).content).toBe('temporary');

      // Delete
      const res = await fetch(`${getUrl()}/api/agents/deleter-agent/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'temp.md' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify deleted
      const afterDelete = await fetch(`${getUrl()}/api/agents/deleter-agent/file?path=temp.md`);
      const afterBody = await afterDelete.json();
      expect(afterBody.error).toBe('File not found');
    });

    it('deletes a nested file within agent directory', async () => {
      const rm = getResourceManager();
      await rm.createAgent({ name: 'nested-delete', instructions: 'Nested delete.' });
      const skillDir = join(agentsDir, 'nested-delete', 'skills', 'old-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: old\n---\n', 'utf-8');

      const res = await fetch(`${getUrl()}/api/agents/nested-delete/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'skills/old-skill/SKILL.md' }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(
        `${getUrl()}/api/agents/nested-delete/file?path=skills/old-skill/SKILL.md`
      );
      const body = await readRes.json();
      expect(body.error).toBe('File not found');
    });

    it('returns error when path is missing', async () => {
      await getResourceManager().createAgent({
        name: 'delete-no-path',
        instructions: 'Test.',
      });

      const res = await fetch(`${getUrl()}/api/agents/delete-no-path/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('returns error for a file that does not exist', async () => {
      await getResourceManager().createAgent({
        name: 'delete-missing',
        instructions: 'Test.',
      });

      const res = await fetch(`${getUrl()}/api/agents/delete-missing/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'ghost-file.ts' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('File not found');
    });

    it('returns error for unknown agent', async () => {
      const res = await fetch(`${getUrl()}/api/agents/unknown/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test.ts' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Agent not found');
    });
  });

  // ─── AC 6: Path traversal is rejected ────────────────────────

  describe('Security: Path traversal rejection', () => {
    it('rejects path traversal in read (../../../etc/passwd)', async () => {
      await getResourceManager().createAgent({ name: 'safe-read', instructions: 'Safe.' });

      const res = await fetch(`${getUrl()}/api/agents/safe-read/file?path=../../../etc/passwd`);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it('rejects path traversal in write', async () => {
      await getResourceManager().createAgent({ name: 'safe-write', instructions: 'Safe.' });

      const res = await fetch(`${getUrl()}/api/agents/safe-write/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../../etc/evil', content: 'hack' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects path traversal in create', async () => {
      await getResourceManager().createAgent({ name: 'safe-create', instructions: 'Safe.' });

      const res = await fetch(`${getUrl()}/api/agents/safe-create/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../escape.txt', content: 'escape' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects path traversal in delete', async () => {
      await getResourceManager().createAgent({ name: 'safe-delete', instructions: 'Safe.' });

      const res = await fetch(`${getUrl()}/api/agents/safe-delete/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../../etc/passwd' }),
      });
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it('rejects absolute path in read', async () => {
      await getResourceManager().createAgent({ name: 'abs-read', instructions: 'Safe.' });

      const res = await fetch(`${getUrl()}/api/agents/abs-read/file?path=/etc/passwd`);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });
  });

  // ─── Full lifecycle: create → list → read → update → delete ──

  describe('Full lifecycle: create file → list → read → update → delete', () => {
    it('manages a skill file through its complete lifecycle', async () => {
      const url = getUrl();

      // 1. Create agent
      await getResourceManager().createAgent({
        name: 'lifecycle-agent',
        instructions: 'Lifecycle test.',
      });

      // 2. Create a new private skill file
      const createRes = await fetch(`${url}/api/agents/lifecycle-agent/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'skills/analyzer/index.ts',
          content: 'export function analyze() { return "v1"; }',
        }),
      });
      expect(createRes.ok).toBe(true);
      const createBody = await createRes.json();
      expect(createBody.ok).toBe(true);
      expect(createBody.path).toBe('skills/analyzer/index.ts');

      // 3. List files and verify skill directory appears
      const listRes = await fetch(`${url}/api/agents/lifecycle-agent/files`);
      expect(listRes.ok).toBe(true);
      const listBody = await listRes.json();
      const skillsDir = listBody.find((f: any) => f.name === 'skills');
      expect(skillsDir).toBeDefined();
      expect(skillsDir.isDirectory).toBe(true);
      const analyzerDir = skillsDir.children.find((f: any) => f.name === 'analyzer');
      expect(analyzerDir).toBeDefined();

      // 4. Read the created file
      const readRes = await fetch(
        `${url}/api/agents/lifecycle-agent/file?path=skills/analyzer/index.ts`
      );
      expect(readRes.ok).toBe(true);
      const readBody = await readRes.json();
      expect(readBody.content).toBe('export function analyze() { return "v1"; }');

      // 5. Update the file with new content
      const updateRes = await fetch(`${url}/api/agents/lifecycle-agent/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'skills/analyzer/index.ts',
          content: 'export function analyze() { return "v2"; }',
        }),
      });
      expect(updateRes.ok).toBe(true);

      // 6. Read again to verify update
      const readAgain = await fetch(
        `${url}/api/agents/lifecycle-agent/file?path=skills/analyzer/index.ts`
      );
      const readAgainBody = await readAgain.json();
      expect(readAgainBody.content).toBe('export function analyze() { return "v2"; }');

      // 7. Delete the file
      const deleteRes = await fetch(`${url}/api/agents/lifecycle-agent/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'skills/analyzer/index.ts' }),
      });
      expect(deleteRes.ok).toBe(true);

      // 8. Verify file is gone
      const goneRes = await fetch(
        `${url}/api/agents/lifecycle-agent/file?path=skills/analyzer/index.ts`
      );
      const goneBody = await goneRes.json();
      expect(goneBody.error).toBe('File not found');
    });

    it('manages mcp.json configuration through its lifecycle', async () => {
      const url = getUrl();

      // 1. Create agent
      await getResourceManager().createAgent({
        name: 'mcp-lifecycle',
        instructions: 'MCP lifecycle.',
      });

      // 2. Create mcp.json
      const mcpV1 = JSON.stringify({ mcpServers: {} });
      const createRes = await fetch(`${url}/api/agents/mcp-lifecycle/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'mcp.json', content: mcpV1 }),
      });
      expect(createRes.ok).toBe(true);

      // 3. Read mcp.json
      const readRes = await fetch(`${url}/api/agents/mcp-lifecycle/file?path=mcp.json`);
      const readBody = await readRes.json();
      expect(readBody.content).toBe(mcpV1);

      // 4. Update mcp.json with servers
      const mcpV2 = JSON.stringify({
        mcpServers: { search: { command: 'npx', args: ['search'] } },
      });
      const updateRes = await fetch(`${url}/api/agents/mcp-lifecycle/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'mcp.json', content: mcpV2 }),
      });
      expect(updateRes.ok).toBe(true);

      // 5. Verify update
      const verifyRes = await fetch(`${url}/api/agents/mcp-lifecycle/file?path=mcp.json`);
      const verifyBody = await verifyRes.json();
      expect(verifyBody.content).toBe(mcpV2);

      // 6. Delete mcp.json
      const deleteRes = await fetch(`${url}/api/agents/mcp-lifecycle/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'mcp.json' }),
      });
      expect(deleteRes.ok).toBe(true);

      // 7. Verify gone
      const goneRes = await fetch(`${url}/api/agents/mcp-lifecycle/file?path=mcp.json`);
      expect((await goneRes.json()).error).toBe('File not found');
    });
  });
});
