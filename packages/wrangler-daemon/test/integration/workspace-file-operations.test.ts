import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SessionStore } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { SessionManager } from '../../src/core/session-manager.js';
import { fileRoutes } from '../../src/routes/files.js';

/**
 * US-C5: Workspace File Operations
 *
 * As a developer, I want to browse and edit files in a session's workspace
 * so that I can inspect and modify agent working files.
 *
 * Acceptance Criteria:
 * 1. GET /api/files/:sessionId/tree returns file tree (dirs before files, excludes node_modules/hidden)
 * 2. GET /api/files/:sessionId/content reads file content
 * 3. PUT /api/files/:sessionId/content updates file content
 * 4. POST /api/files/:sessionId creates a new file (with nested dir support)
 * 5. DELETE /api/files/:sessionId deletes a file
 * 6. Path traversal is blocked
 */
describe('US-C5: Workspace File Operations', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let workspacePath: string;
  let sessionId: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-us-c5-'));
    workspacePath = join(tempDir, 'workspace');
    await mkdir(workspacePath, { recursive: true });

    // Seed workspace with a structured file tree for tree / sorting tests
    await writeFile(join(workspacePath, 'readme.md'), '# Project', 'utf-8');
    await mkdir(join(workspacePath, 'src'), { recursive: true });
    await writeFile(join(workspacePath, 'src', 'index.ts'), 'export {};', 'utf-8');
    await mkdir(join(workspacePath, 'src', 'utils'), { recursive: true });
    await writeFile(
      join(workspacePath, 'src', 'utils', 'helpers.ts'),
      'export function noop() {}',
      'utf-8'
    );
    await mkdir(join(workspacePath, 'node_modules', 'foo'), { recursive: true });
    await writeFile(
      join(workspacePath, 'node_modules', 'foo', 'index.js'),
      'module.exports={}',
      'utf-8'
    );
    await mkdir(join(workspacePath, '.git'), { recursive: true });
    await writeFile(join(workspacePath, '.git', 'HEAD'), 'ref: refs/heads/main', 'utf-8');

    // Create a session on disk via SessionStore (same path wrangler middleware uses)
    const sessionsDir = join(tempDir, 'sessions');
    const sessionManager = new SessionManager(sessionsDir);
    sessionId = 'us-c5-session';
    const store = new SessionStore(sessionsDir, workspacePath, defaultNodeHostEnv);
    await store.createWithId(sessionId, 'test-agent');
    sessionManager.registerSession(sessionId, workspacePath);

    // Boot a throw-away Fastify with only file routes
    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
    fastify.register(fileRoutes);
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

  // ------------------------------------------------------------------ AC-1
  describe('AC-1: GET tree returns file tree', () => {
    it('returns the workspace root as a directory node with children', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}/tree`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.isDirectory).toBe(true);
      expect(body.name).toBeDefined();
      expect(Array.isArray(body.children)).toBe(true);
      expect(body.children.length).toBeGreaterThan(0);
    });

    it('sorts directories before files, then alphabetically', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}/tree`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      const children = body.children as Array<{ name: string; isDirectory: boolean }>;

      const dirs = children.filter((c) => c.isDirectory);
      const files = children.filter((c) => !c.isDirectory);

      // All directories come before all files
      const firstFileIdx = children.findIndex((c) => !c.isDirectory);
      const lastDirIdx = children.findLastIndex((c) => c.isDirectory);
      if (dirs.length > 0 && files.length > 0) {
        expect(lastDirIdx).toBeLessThan(firstFileIdx);
      }

      // Within each group, names are alphabetical
      const dirNames = dirs.map((d) => d.name);
      const fileNames = files.map((f) => f.name);
      expect([...dirNames].sort((a, b) => a.localeCompare(b))).toEqual(dirNames);
      expect([...fileNames].sort((a, b) => a.localeCompare(b))).toEqual(fileNames);
    });

    it('excludes node_modules from the tree', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}/tree`);
      expect(res.ok).toBe(true);
      const body = await res.json();

      const hasNodeModules = (nodes: Array<{ name: string; children?: unknown[] }>): boolean =>
        nodes.some(
          (n) =>
            n.name === 'node_modules' ||
            (n.children
              ? hasNodeModules(n.children as Array<{ name: string; children?: unknown[] }>)
              : false)
        );

      expect(hasNodeModules(body.children)).toBe(false);
    });

    it('excludes hidden files and directories (dot-prefixed)', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}/tree`);
      expect(res.ok).toBe(true);
      const body = await res.json();

      const hasHidden = (nodes: Array<{ name: string; children?: unknown[] }>): boolean =>
        nodes.some(
          (n) =>
            n.name.startsWith('.') ||
            (n.children
              ? hasHidden(n.children as Array<{ name: string; children?: unknown[] }>)
              : false)
        );

      expect(hasHidden(body.children)).toBe(false);
    });
  });

  // ------------------------------------------------------------------ AC-2
  describe('AC-2: GET content reads file content', () => {
    it('returns the text content of an existing file', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}/content?path=readme.md`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.content).toBe('# Project');
      expect(body.path).toBe('readme.md');
    });

    it('reads a deeply nested file', async () => {
      const res = await fetch(
        `${baseUrl()}/api/files/${sessionId}/content?path=src/utils/helpers.ts`
      );
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.content).toBe('export function noop() {}');
    });
  });

  // ------------------------------------------------------------------ AC-2 error cases
  describe('GET content error handling', () => {
    it('returns error when path query parameter is missing', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}/content`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('returns error for a non-existent file', async () => {
      const res = await fetch(
        `${baseUrl()}/api/files/${sessionId}/content?path=does-not-exist.txt`
      );
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('File not found');
    });
  });

  // ------------------------------------------------------------------ AC-3
  describe('AC-3: PUT content updates file content', () => {
    it('overwrites an existing file with new content', async () => {
      const writeRes = await fetch(`${baseUrl()}/api/files/${sessionId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'readme.md', content: '# Updated Project' }),
      });
      expect(writeRes.ok).toBe(true);
      expect((await writeRes.json()).ok).toBe(true);

      const readRes = await fetch(`${baseUrl()}/api/files/${sessionId}/content?path=readme.md`);
      expect((await readRes.json()).content).toBe('# Updated Project');
    });

    it('returns error when path or content is missing', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'readme.md' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path and content required');
    });
  });

  // ------------------------------------------------------------------ AC-4
  describe('AC-4: POST creates a new file', () => {
    it('creates a file with specified content', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'new-feature.ts', content: 'export const x = 1;' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.path).toBe('new-feature.ts');

      const readRes = await fetch(
        `${baseUrl()}/api/files/${sessionId}/content?path=new-feature.ts`
      );
      expect((await readRes.json()).content).toBe('export const x = 1;');
    });

    it('creates nested directories automatically', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'deep/nested/dir/file.txt', content: 'nested' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).ok).toBe(true);

      const readRes = await fetch(
        `${baseUrl()}/api/files/${sessionId}/content?path=deep/nested/dir/file.txt`
      );
      expect((await readRes.json()).content).toBe('nested');
    });

    it('defaults content to empty string when not provided', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'empty.txt' }),
      });
      expect(res.ok).toBe(true);

      const readRes = await fetch(`${baseUrl()}/api/files/${sessionId}/content?path=empty.txt`);
      expect((await readRes.json()).content).toBe('');
    });

    it('returns error when path is missing', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'orphan' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path is required');
    });
  });

  // ------------------------------------------------------------------ AC-5
  describe('AC-5: DELETE removes a file', () => {
    it('deletes an existing file and it is no longer readable', async () => {
      const delRes = await fetch(`${baseUrl()}/api/files/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'readme.md' }),
      });
      expect(delRes.ok).toBe(true);
      expect((await delRes.json()).ok).toBe(true);

      const readRes = await fetch(`${baseUrl()}/api/files/${sessionId}/content?path=readme.md`);
      expect((await readRes.json()).error).toBe('File not found');
    });

    it('returns error for a non-existent file', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'ghost.txt' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('File not found');
    });

    it('returns error when path is missing', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path is required');
    });
  });

  // ------------------------------------------------------------------ AC-6
  describe('AC-6: Path traversal is blocked', () => {
    it('blocks traversal via GET content', async () => {
      const res = await fetch(
        `${baseUrl()}/api/files/${sessionId}/content?path=../../../etc/passwd`
      );
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('File not found');
    });

    it('blocks traversal via PUT content', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../tmp/evil.txt', content: 'pwned' }),
      });
      // Should fail — either a thrown error turned into a 500 or resolvePath rejects
      const body = await res.json();
      // The route may throw before returning ok: true — either way, file must not be written
      expect(body.ok).not.toBe(true);
    });

    it('blocks traversal via POST create', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../tmp/evil.txt', content: 'pwned' }),
      });
      const body = await res.json();
      expect(body.ok).not.toBe(true);
    });

    it('blocks traversal via DELETE', async () => {
      const res = await fetch(`${baseUrl()}/api/files/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../tmp/important.txt' }),
      });
      const body = await res.json();
      expect(body.ok).not.toBe(true);
    });
  });

  // ------------------------------------------------------------------ Edge: unknown session
  describe('Unknown session error handling', () => {
    it('returns Session not found for tree endpoint', async () => {
      const res = await fetch(`${baseUrl()}/api/files/nonexistent-session/tree`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Session not found');
    });

    it('returns Session not found for content endpoint', async () => {
      const res = await fetch(`${baseUrl()}/api/files/nonexistent-session/content?path=x.txt`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Session not found');
    });

    it('returns Session not found for PUT endpoint', async () => {
      const res = await fetch(`${baseUrl()}/api/files/nonexistent-session/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'x.txt', content: 'y' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Session not found');
    });

    it('returns Session not found for POST endpoint', async () => {
      const res = await fetch(`${baseUrl()}/api/files/nonexistent-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'x.txt' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Session not found');
    });

    it('returns Session not found for DELETE endpoint', async () => {
      const res = await fetch(`${baseUrl()}/api/files/nonexistent-session`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'x.txt' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Session not found');
    });
  });

  // ------------------------------------------------------------------ Full lifecycle
  describe('Full file lifecycle', () => {
    it('create -> read -> update -> tree -> delete', async () => {
      // Step 1: Create a new file
      const createRes = await fetch(`${baseUrl()}/api/files/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'lifecycle.txt', content: 'v1' }),
      });
      expect(createRes.ok).toBe(true);
      expect((await createRes.json()).ok).toBe(true);

      // Step 2: Read it back
      const read1 = await fetch(`${baseUrl()}/api/files/${sessionId}/content?path=lifecycle.txt`);
      expect((await read1.json()).content).toBe('v1');

      // Step 3: Update it
      const updateRes = await fetch(`${baseUrl()}/api/files/${sessionId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'lifecycle.txt', content: 'v2' }),
      });
      expect(updateRes.ok).toBe(true);
      expect((await updateRes.json()).ok).toBe(true);

      // Verify update
      const read2 = await fetch(`${baseUrl()}/api/files/${sessionId}/content?path=lifecycle.txt`);
      expect((await read2.json()).content).toBe('v2');

      // Step 4: Confirm it appears in the file tree
      const treeRes = await fetch(`${baseUrl()}/api/files/${sessionId}/tree`);
      const tree = await treeRes.json();
      const rootFiles = tree.children.filter(
        (c: { name: string; isDirectory: boolean }) => !c.isDirectory
      );
      expect(rootFiles.some((f: { name: string }) => f.name === 'lifecycle.txt')).toBe(true);

      // Step 5: Delete it
      const delRes = await fetch(`${baseUrl()}/api/files/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'lifecycle.txt' }),
      });
      expect(delRes.ok).toBe(true);
      expect((await delRes.json()).ok).toBe(true);

      // Verify gone
      const read3 = await fetch(`${baseUrl()}/api/files/${sessionId}/content?path=lifecycle.txt`);
      expect((await read3.json()).error).toBe('File not found');

      // Verify absent from tree
      const treeRes2 = await fetch(`${baseUrl()}/api/files/${sessionId}/tree`);
      const tree2 = await treeRes2.json();
      const rootFiles2 = tree2.children.filter(
        (c: { name: string; isDirectory: boolean }) => !c.isDirectory
      );
      expect(rootFiles2.some((f: { name: string }) => f.name === 'lifecycle.txt')).toBe(false);
    });
  });
});
