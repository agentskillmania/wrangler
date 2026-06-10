import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SessionManager } from '../../../src/core/session-manager.js';
import { fileRoutes } from '../../../src/routes/files.js';
import type { DecoratedFastifyInstance } from '../../../src/types.js';

/**
 * Unit tests for workspace file CRUD routes.
 *
 * Tests the following endpoints:
 * - GET  /api/files/:sessionId/tree              — recursive file tree
 * - GET  /api/files/:sessionId/content?path=xxx  — read file content
 * - PUT  /api/files/:sessionId/content           — write file (body: {path, content})
 * - POST /api/files/:sessionId                   — create file with nested dirs (body: {path, content?})
 * - DELETE /api/files/:sessionId                 — delete file (body: {path})
 */
describe('workspace file routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let sessionsDir: string;
  let workspacePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-files-'));
    sessionsDir = join(tempDir, 'sessions');
    workspacePath = join(tempDir, 'workspace');
    await mkdir(workspacePath, { recursive: true });

    // Initialize SessionManager and register a real session on disk
    const sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

    const store = sessionManager.getSessionStore(workspacePath);
    await store.createWithId('test-session', 'test-agent');
    sessionManager.registerSession('test-session', workspacePath);

    // Seed workspace with test files
    await writeFile(join(workspacePath, 'hello.txt'), 'hello world', 'utf-8');
    await mkdir(join(workspacePath, 'subdir'), { recursive: true });
    await writeFile(join(workspacePath, 'subdir', 'nested.txt'), 'nested content', 'utf-8');

    // Boot Fastify with sessionManager decoration
    fastify = Fastify();
    (fastify as unknown as DecoratedFastifyInstance).sessionManager = sessionManager;
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

  // ------------------------------------------------------------------ File tree

  describe('GET /api/files/:sessionId/tree', () => {
    it('returns recursive file tree for session workspace', async () => {
      const res = await fetch(`${baseUrl()}/api/files/test-session/tree`);
      expect(res.ok).toBe(true);
      const body = await res.json();

      // Root node should be a directory at path "."
      expect(body.isDirectory).toBe(true);
      expect(body.path).toBe('.');

      // Directories sorted before files, entries sorted alphabetically
      const childNames = body.children.map((c: { name: string }) => c.name);
      expect(childNames).toContain('subdir');
      expect(childNames).toContain('hello.txt');

      // subdir should come before hello.txt (directories first)
      const subdirIdx = childNames.indexOf('subdir');
      const fileIdx = childNames.indexOf('hello.txt');
      expect(subdirIdx).toBeLessThan(fileIdx);

      // Nested file inside subdir
      const subdir = body.children.find((c: { name: string }) => c.name === 'subdir');
      expect(subdir.isDirectory).toBe(true);
      expect(subdir.children).toHaveLength(1);
      expect(subdir.children[0].name).toBe('nested.txt');
      expect(subdir.children[0].isDirectory).toBe(false);
    });

    it('returns error for non-existent session', async () => {
      const res = await fetch(`${baseUrl()}/api/files/nonexistent/tree`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Session not found');
    });
  });

  // ------------------------------------------------------------------ Read file

  describe('GET /api/files/:sessionId/content', () => {
    it('reads file content', async () => {
      const res = await fetch(`${baseUrl()}/api/files/test-session/content?path=hello.txt`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.content).toBe('hello world');
      expect(body.path).toBe('hello.txt');
    });

    it('returns error when path query parameter is missing', async () => {
      const res = await fetch(`${baseUrl()}/api/files/test-session/content`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path is required');
    });

    it('returns error for non-existent file', async () => {
      const res = await fetch(`${baseUrl()}/api/files/test-session/content?path=nope.txt`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('File not found');
    });

    it('returns error for non-existent session', async () => {
      const res = await fetch(`${baseUrl()}/api/files/missing-session/content?path=hello.txt`);
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Session not found');
    });
  });

  // ------------------------------------------------------------------ Write file

  describe('PUT /api/files/:sessionId/content', () => {
    it('updates existing file content', async () => {
      const writeRes = await fetch(`${baseUrl()}/api/files/test-session/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'hello.txt', content: 'updated' }),
      });
      expect(writeRes.ok).toBe(true);
      expect((await writeRes.json()).ok).toBe(true);

      // Read back to verify persistence
      const readRes = await fetch(`${baseUrl()}/api/files/test-session/content?path=hello.txt`);
      expect((await readRes.json()).content).toBe('updated');
    });

    it('returns error when path or content is missing', async () => {
      const res = await fetch(`${baseUrl()}/api/files/test-session/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'hello.txt' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path and content required');
    });

    it('returns error for non-existent session', async () => {
      const res = await fetch(`${baseUrl()}/api/files/ghost-session/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'hello.txt', content: 'x' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('Session not found');
    });
  });

  // ------------------------------------------------------------------ Create file

  describe('POST /api/files/:sessionId', () => {
    it('creates new file with nested directories', async () => {
      const res = await fetch(`${baseUrl()}/api/files/test-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'deep/nested/new.txt',
          content: 'fresh content',
        }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.path).toBe('deep/nested/new.txt');

      // Verify the file exists on disk
      const diskContent = await readFile(join(workspacePath, 'deep', 'nested', 'new.txt'), 'utf-8');
      expect(diskContent).toBe('fresh content');
    });

    it('creates file with empty content when content is omitted', async () => {
      const res = await fetch(`${baseUrl()}/api/files/test-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'empty.txt' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).ok).toBe(true);

      const diskContent = await readFile(join(workspacePath, 'empty.txt'), 'utf-8');
      expect(diskContent).toBe('');
    });

    it('returns error when path is missing', async () => {
      const res = await fetch(`${baseUrl()}/api/files/test-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'orphan' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path is required');
    });
  });

  // ------------------------------------------------------------------ Delete file

  describe('DELETE /api/files/:sessionId', () => {
    it('deletes file and confirms it is gone', async () => {
      const delRes = await fetch(`${baseUrl()}/api/files/test-session`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'hello.txt' }),
      });
      expect(delRes.ok).toBe(true);
      expect((await delRes.json()).ok).toBe(true);

      // File should no longer be accessible
      await expect(access(join(workspacePath, 'hello.txt'))).rejects.toThrow();
    });

    it('returns error when path is missing', async () => {
      const res = await fetch(`${baseUrl()}/api/files/test-session`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('path is required');
    });

    it('returns error for non-existent file', async () => {
      const res = await fetch(`${baseUrl()}/api/files/test-session`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'ghost.txt' }),
      });
      expect(res.ok).toBe(true);
      expect((await res.json()).error).toBe('File not found');
    });
  });
});
