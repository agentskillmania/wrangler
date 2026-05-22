/**
 * @fileoverview User Story: Skill File Management (Integration)
 *
 * US-C7: As a developer, I want to browse and edit files within a skill
 * directory so that I can manage SKILL.md and skill source files.
 *
 * Route: src/routes/skill-files.ts with skillFileRoutes
 * Decorate: resourceManager (ResourceManager)
 *
 * Acceptance Criteria:
 * 1. GET /api/skills/:id/files lists files in skill directory
 * 2. GET /api/skills/:id/file reads a specific file
 * 3. PUT /api/skills/:id/file updates a specific file
 * 4. POST /api/skills/:id/file creates a new file
 * 5. DELETE /api/skills/:id/file deletes a specific file
 * 6. Path traversal is rejected
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { skillFileRoutes } from '../../src/routes/skill-files.js';

describe('Integration: Skill File Management (US-C7)', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-skill-file-mgmt-'));
    skillsDir = join(tempDir, 'skills');
    const resourceManager = new ResourceManager(join(tempDir, 'agents'), skillsDir);
    await resourceManager.init();

    fastify = Fastify();
    fastify.decorate('resourceManager', resourceManager);
    fastify.register(skillFileRoutes);
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

  // ─── AC 1: List files in skill directory ─────────────────────

  describe('GET /api/skills/:id/files - List files', () => {
    it('returns file list for an existing skill', async () => {
      await getResourceManager().createSkill({
        name: 'list-skill',
        description: 'test skill',
      });

      const res = await fetch(`${getUrl()}/api/skills/list-skill/files`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.some((f: any) => f.name === 'SKILL.md')).toBe(true);
    });

    it('returns error for unknown skill', async () => {
      const res = await fetch(`${getUrl()}/api/skills/unknown/files`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Skill not found');
    });

    it('returns file entries with name, path, and size', async () => {
      await getResourceManager().createSkill({
        name: 'meta-skill',
        description: 'metadata test',
      });

      const res = await fetch(`${getUrl()}/api/skills/meta-skill/files`);
      expect(res.ok).toBe(true);
      const body = await res.json();

      const skillMd = body.find((f: any) => f.name === 'SKILL.md');
      expect(skillMd).toBeDefined();
      expect(skillMd.path).toBeTruthy();
      expect(typeof skillMd.size).toBe('number');
      expect(skillMd.size).toBeGreaterThan(0);
    });
  });

  // ─── AC 2: Read a specific file ──────────────────────────────

  describe('GET /api/skills/:id/file - Read file', () => {
    it('returns content of SKILL.md', async () => {
      await getResourceManager().createSkill({
        name: 'reader-skill',
        description: 'read skill',
      });

      const res = await fetch(`${getUrl()}/api/skills/reader-skill/file?path=SKILL.md`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.content).toContain('reader-skill');
      expect(body.path).toBe('SKILL.md');
    });

    it('reads source files within the skill directory', async () => {
      const rm = getResourceManager();
      await rm.createSkill({ name: 'source-skill', description: 'source test' });

      // Create a source file via API
      await fetch(`${getUrl()}/api/skills/source-skill/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'handler.ts',
          content: 'export async function handle() { return "ok"; }',
        }),
      });

      const res = await fetch(`${getUrl()}/api/skills/source-skill/file?path=handler.ts`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.content).toBe('export async function handle() { return "ok"; }');
    });

    it('returns error when path parameter is missing', async () => {
      await getResourceManager().createSkill({
        name: 'no-param',
        description: 'test',
      });

      const res = await fetch(`${getUrl()}/api/skills/no-param/file`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('returns error for a file that does not exist', async () => {
      await getResourceManager().createSkill({
        name: 'missing-file',
        description: 'empty skill',
      });

      const res = await fetch(`${getUrl()}/api/skills/missing-file/file?path=nonexistent.ts`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('File not found');
    });

    it('returns error for unknown skill', async () => {
      const res = await fetch(`${getUrl()}/api/skills/unknown/file?path=test.ts`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Skill not found');
    });
  });

  // ─── AC 3: Update a specific file ────────────────────────────

  describe('PUT /api/skills/:id/file - Update file', () => {
    it('updates SKILL.md with new content', async () => {
      await getResourceManager().createSkill({
        name: 'updater-skill',
        description: 'original description',
      });

      const res = await fetch(`${getUrl()}/api/skills/updater-skill/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'SKILL.md',
          content:
            '---\nname: updater-skill\ndescription: updated description\n---\n\n# Updated Skill\n',
        }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(`${getUrl()}/api/skills/updater-skill/file?path=SKILL.md`);
      const body = await readRes.json();
      expect(body.content).toContain('updated description');
    });

    it('updates a source file within the skill directory', async () => {
      const rm = getResourceManager();
      await rm.createSkill({ name: 'source-update', description: 'source test' });

      // Create a source file first
      await fetch(`${getUrl()}/api/skills/source-update/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'utils.ts',
          content: 'export const version = 1;',
        }),
      });

      // Update it
      const res = await fetch(`${getUrl()}/api/skills/source-update/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'utils.ts',
          content: 'export const version = 2;',
        }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(`${getUrl()}/api/skills/source-update/file?path=utils.ts`);
      const body = await readRes.json();
      expect(body.content).toBe('export const version = 2;');
    });

    it('returns error when path is missing', async () => {
      await getResourceManager().createSkill({
        name: 'put-no-path',
        description: 'test',
      });

      const res = await fetch(`${getUrl()}/api/skills/put-no-path/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'missing path' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path and content required');
    });

    it('returns error when content is missing', async () => {
      await getResourceManager().createSkill({
        name: 'put-no-content',
        description: 'test',
      });

      const res = await fetch(`${getUrl()}/api/skills/put-no-content/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'SKILL.md' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path and content required');
    });

    it('returns error for unknown skill', async () => {
      const res = await fetch(`${getUrl()}/api/skills/unknown/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test.ts', content: '' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Skill not found');
    });

    it('allows writing empty string content to clear a file', async () => {
      await getResourceManager().createSkill({
        name: 'clear-skill',
        description: 'clear test',
      });

      // Create a file with content
      await fetch(`${getUrl()}/api/skills/clear-skill/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'cache.txt', content: 'cached data' }),
      });

      // Clear it
      const res = await fetch(`${getUrl()}/api/skills/clear-skill/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'cache.txt', content: '' }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(`${getUrl()}/api/skills/clear-skill/file?path=cache.txt`);
      const body = await readRes.json();
      expect(body.content).toBe('');
    });
  });

  // ─── AC 4: Create a new file ─────────────────────────────────

  describe('POST /api/skills/:id/file - Create file', () => {
    it('creates a new file in the skill directory', async () => {
      await getResourceManager().createSkill({
        name: 'creator-skill',
        description: 'create skill',
      });

      const res = await fetch(`${getUrl()}/api/skills/creator-skill/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'helper.ts',
          content: 'export const x = 1;',
        }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.path).toBe('helper.ts');

      // Verify on disk
      const onDisk = await readFile(join(skillsDir, 'creator-skill', 'helper.ts'), 'utf-8');
      expect(onDisk).toBe('export const x = 1;');
    });

    it('creates nested directories and file when parent dirs do not exist', async () => {
      await getResourceManager().createSkill({
        name: 'nested-creator',
        description: 'nested create',
      });

      const res = await fetch(`${getUrl()}/api/skills/nested-creator/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'src/handlers/main.ts',
          content: 'export function main() {}',
        }),
      });
      expect(res.ok).toBe(true);

      // Verify nested dirs were created
      expect(existsSync(join(skillsDir, 'nested-creator', 'src', 'handlers'))).toBe(true);

      const readRes = await fetch(
        `${getUrl()}/api/skills/nested-creator/file?path=src/handlers/main.ts`
      );
      const body = await readRes.json();
      expect(body.content).toBe('export function main() {}');
    });

    it('creates file with empty content when content is not provided', async () => {
      await getResourceManager().createSkill({
        name: 'default-content',
        description: 'default content test',
      });

      const res = await fetch(`${getUrl()}/api/skills/default-content/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'placeholder.txt' }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(
        `${getUrl()}/api/skills/default-content/file?path=placeholder.txt`
      );
      const body = await readRes.json();
      expect(body.content).toBe('');
    });

    it('returns error when path is missing', async () => {
      await getResourceManager().createSkill({
        name: 'post-no-path',
        description: 'test',
      });

      const res = await fetch(`${getUrl()}/api/skills/post-no-path/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'no path' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('returns error for unknown skill', async () => {
      const res = await fetch(`${getUrl()}/api/skills/unknown/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test.ts', content: 'test' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Skill not found');
    });
  });

  // ─── AC 5: Delete a specific file ────────────────────────────

  describe('DELETE /api/skills/:id/file - Delete file', () => {
    it('deletes an existing file from the skill directory', async () => {
      await getResourceManager().createSkill({
        name: 'deleter-skill',
        description: 'delete skill',
      });

      // Write a file first
      await fetch(`${getUrl()}/api/skills/deleter-skill/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'temp.ts', content: 'temp' }),
      });

      // Verify it exists
      const beforeDelete = await fetch(`${getUrl()}/api/skills/deleter-skill/file?path=temp.ts`);
      expect((await beforeDelete.json()).content).toBe('temp');

      // Delete
      const res = await fetch(`${getUrl()}/api/skills/deleter-skill/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'temp.ts' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify deleted
      const afterDelete = await fetch(`${getUrl()}/api/skills/deleter-skill/file?path=temp.ts`);
      const afterBody = await afterDelete.json();
      expect(afterBody.error).toBe('File not found');
    });

    it('deletes a nested source file', async () => {
      const rm = getResourceManager();
      await rm.createSkill({ name: 'nested-delete', description: 'nested delete' });

      // Create nested file
      await fetch(`${getUrl()}/api/skills/nested-delete/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'src/old-module.ts',
          content: '// old code',
        }),
      });

      // Delete the nested file
      const res = await fetch(`${getUrl()}/api/skills/nested-delete/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'src/old-module.ts' }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(
        `${getUrl()}/api/skills/nested-delete/file?path=src/old-module.ts`
      );
      expect((await readRes.json()).error).toBe('File not found');
    });

    it('returns error when path is missing', async () => {
      await getResourceManager().createSkill({
        name: 'delete-no-path',
        description: 'test',
      });

      const res = await fetch(`${getUrl()}/api/skills/delete-no-path/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('returns error for a file that does not exist', async () => {
      await getResourceManager().createSkill({
        name: 'delete-missing',
        description: 'test',
      });

      const res = await fetch(`${getUrl()}/api/skills/delete-missing/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'ghost-file.ts' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('File not found');
    });

    it('returns error for unknown skill', async () => {
      const res = await fetch(`${getUrl()}/api/skills/unknown/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test.ts' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Skill not found');
    });
  });

  // ─── AC 6: Path traversal is rejected ────────────────────────

  describe('Security: Path traversal rejection', () => {
    it('rejects path traversal in read (../../../etc/passwd)', async () => {
      await getResourceManager().createSkill({
        name: 'safe-read',
        description: 'safe skill',
      });

      const res = await fetch(`${getUrl()}/api/skills/safe-read/file?path=../../../etc/passwd`);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it('rejects path traversal in write', async () => {
      await getResourceManager().createSkill({
        name: 'safe-write',
        description: 'safe skill',
      });

      const res = await fetch(`${getUrl()}/api/skills/safe-write/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../../etc/evil', content: 'hack' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects path traversal in create', async () => {
      await getResourceManager().createSkill({
        name: 'safe-create',
        description: 'safe skill',
      });

      const res = await fetch(`${getUrl()}/api/skills/safe-create/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../escape.txt', content: 'escape' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects path traversal in delete', async () => {
      await getResourceManager().createSkill({
        name: 'safe-delete',
        description: 'safe skill',
      });

      const res = await fetch(`${getUrl()}/api/skills/safe-delete/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../../etc/passwd' }),
      });
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it('rejects absolute path in read', async () => {
      await getResourceManager().createSkill({
        name: 'abs-read',
        description: 'safe skill',
      });

      const res = await fetch(`${getUrl()}/api/skills/abs-read/file?path=/etc/passwd`);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });
  });

  // ─── Full lifecycle: create → list → read → update → delete ──

  describe('Full lifecycle: create file → list → read → update → delete', () => {
    it('manages a skill source file through its complete lifecycle', async () => {
      const url = getUrl();

      // 1. Create skill
      await getResourceManager().createSkill({
        name: 'lifecycle-skill',
        description: 'lifecycle test',
      });

      // 2. Create a new source file
      const createRes = await fetch(`${url}/api/skills/lifecycle-skill/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'src/handler.ts',
          content: 'export function run() { return "v1"; }',
        }),
      });
      expect(createRes.ok).toBe(true);
      const createBody = await createRes.json();
      expect(createBody.ok).toBe(true);
      expect(createBody.path).toBe('src/handler.ts');

      // 3. List files and verify source file is present
      const listRes = await fetch(`${url}/api/skills/lifecycle-skill/files`);
      expect(listRes.ok).toBe(true);
      const listBody = await listRes.json();
      expect(listBody.some((f: any) => f.name === 'SKILL.md')).toBe(true);

      // 4. Read the created file
      const readRes = await fetch(`${url}/api/skills/lifecycle-skill/file?path=src/handler.ts`);
      expect(readRes.ok).toBe(true);
      const readBody = await readRes.json();
      expect(readBody.content).toBe('export function run() { return "v1"; }');

      // 5. Update the file with new content
      const updateRes = await fetch(`${url}/api/skills/lifecycle-skill/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'src/handler.ts',
          content: 'export function run() { return "v2"; }',
        }),
      });
      expect(updateRes.ok).toBe(true);

      // 6. Read again to verify update
      const readAgain = await fetch(`${url}/api/skills/lifecycle-skill/file?path=src/handler.ts`);
      const readAgainBody = await readAgain.json();
      expect(readAgainBody.content).toBe('export function run() { return "v2"; }');

      // 7. Delete the file
      const deleteRes = await fetch(`${url}/api/skills/lifecycle-skill/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'src/handler.ts' }),
      });
      expect(deleteRes.ok).toBe(true);

      // 8. Verify file is gone
      const goneRes = await fetch(`${url}/api/skills/lifecycle-skill/file?path=src/handler.ts`);
      const goneBody = await goneRes.json();
      expect(goneBody.error).toBe('File not found');
    });

    it('manages SKILL.md through its complete lifecycle', async () => {
      const url = getUrl();

      // 1. Create skill (generates SKILL.md)
      await getResourceManager().createSkill({
        name: 'md-lifecycle',
        description: 'original description',
      });

      // 2. Read SKILL.md
      const readRes = await fetch(`${url}/api/skills/md-lifecycle/file?path=SKILL.md`);
      expect(readRes.ok).toBe(true);
      const readBody = await readRes.json();
      expect(readBody.content).toContain('md-lifecycle');
      expect(readBody.content).toContain('original description');

      // 3. Update SKILL.md
      const updatedContent =
        '---\nname: md-lifecycle\ndescription: updated description\n---\n\n# Updated Skill\n\nNew instructions.';
      const updateRes = await fetch(`${url}/api/skills/md-lifecycle/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'SKILL.md', content: updatedContent }),
      });
      expect(updateRes.ok).toBe(true);

      // 4. Verify update
      const verifyRes = await fetch(`${url}/api/skills/md-lifecycle/file?path=SKILL.md`);
      const verifyBody = await verifyRes.json();
      expect(verifyBody.content).toBe(updatedContent);

      // 5. Delete SKILL.md (this removes the skill's identity file)
      const deleteRes = await fetch(`${url}/api/skills/md-lifecycle/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'SKILL.md' }),
      });
      expect(deleteRes.ok).toBe(true);

      // 6. Verify skill is no longer found (SKILL.md is the identity file;
      // removing it causes getSkill() to return null)
      const goneRes = await fetch(`${url}/api/skills/md-lifecycle/file?path=SKILL.md`);
      expect((await goneRes.json()).error).toBe('Skill not found');
    });
  });
});
