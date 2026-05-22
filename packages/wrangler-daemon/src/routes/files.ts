import type { FastifyInstance } from 'fastify';
import { readFile, writeFile, unlink, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, basename, relative, join } from 'node:path';
import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Resolve a path relative to the workspace root, preventing path traversal.
 *
 * @param workspaceRoot - Absolute workspace root path
 * @param relativePath - Relative path to resolve
 * @returns Absolute resolved path within workspace
 * @throws Error if the resolved path escapes the workspace root
 */
function resolvePath(workspaceRoot: string, relativePath: string): string {
  const resolved = resolve(workspaceRoot, relativePath);
  if (!resolved.startsWith(workspaceRoot)) {
    throw new Error('Path outside workspace');
  }
  return resolved;
}

/**
 * Recursively build a file tree from a directory.
 *
 * Filters out hidden files (dot-prefixed) and node_modules directories.
 * Directories are sorted before files; entries are sorted alphabetically.
 *
 * @param dirPath - Absolute directory path to scan
 * @param rootPath - Workspace root for computing relative paths
 * @returns File tree node with path, name, and optional children
 */
async function buildFileTree(
  dirPath: string,
  rootPath: string
): Promise<{
  path: string;
  name: string;
  isDirectory: boolean;
  children?: Array<{ path: string; name: string; isDirectory: boolean }>;
}> {
  const name = basename(dirPath);
  const relPath = relative(rootPath, dirPath) || '.';

  const dirStat = await stat(dirPath);
  if (!dirStat.isDirectory()) {
    return { path: relPath, name, isDirectory: false };
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const filtered = entries.filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules');

  const children = await Promise.all(
    filtered.map((entry) => buildFileTree(join(dirPath, entry.name), rootPath))
  );

  return {
    path: relPath,
    name,
    isDirectory: true,
    children: children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    }),
  };
}

/**
 * Workspace file CRUD routes.
 *
 * Provides endpoints for:
 * - Getting the file tree for a session's workspace
 * - Reading file content
 * - Writing/creating files
 * - Deleting files
 */
export async function fileRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const sessionManager = () => decorated.sessionManager;

  /**
   * GET /api/files/:sessionId/tree
   *
   * Returns the recursive file tree for a session's workspace.
   * Filters out hidden files and node_modules.
   */
  fastify.get('/api/files/:sessionId/tree', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const info = await sessionManager().getInfo(sessionId);
    if (!info) return { error: 'Session not found' };
    return buildFileTree(info.workspacePath, info.workspacePath);
  });

  /**
   * GET /api/files/:sessionId/content?path=<relativePath>
   *
   * Returns the text content of a file in the session's workspace.
   * Query parameter `path` is required.
   */
  fastify.get('/api/files/:sessionId/content', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { path?: string };
    const info = await sessionManager().getInfo(sessionId);
    if (!info) return { error: 'Session not found' };
    if (!query.path) return { error: 'path is required' };

    try {
      const fullPath = resolvePath(info.workspacePath, query.path);
      const content = await readFile(fullPath, 'utf-8');
      return { content, path: query.path };
    } catch {
      return { error: 'File not found' };
    }
  });

  /**
   * PUT /api/files/:sessionId/content
   *
   * Writes content to an existing file in the session's workspace.
   * Body must contain `path` and `content` fields.
   */
  fastify.put('/api/files/:sessionId/content', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as { path?: string; content?: string };
    const info = await sessionManager().getInfo(sessionId);
    if (!info) return { error: 'Session not found' };
    if (!body.path || body.content === undefined) return { error: 'path and content required' };

    const fullPath = resolvePath(info.workspacePath, body.path);
    await writeFile(fullPath, body.content, 'utf-8');
    return { ok: true };
  });

  /**
   * POST /api/files/:sessionId
   *
   * Creates a new file (and any missing parent directories) in the workspace.
   * Body must contain `path`. `content` defaults to empty string.
   */
  fastify.post('/api/files/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as { path?: string; content?: string };
    const info = await sessionManager().getInfo(sessionId);
    if (!info) return { error: 'Session not found' };
    if (!body.path) return { error: 'path is required' };

    const fullPath = resolvePath(info.workspacePath, body.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, body.content ?? '', 'utf-8');
    return { ok: true, path: body.path };
  });

  /**
   * DELETE /api/files/:sessionId
   *
   * Deletes a file from the session's workspace.
   * Body must contain `path`.
   */
  fastify.delete('/api/files/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as { path?: string };
    const info = await sessionManager().getInfo(sessionId);
    if (!info) return { error: 'Session not found' };
    if (!body.path) return { error: 'path is required' };

    try {
      const fullPath = resolvePath(info.workspacePath, body.path);
      await unlink(fullPath);
      return { ok: true };
    } catch {
      return { error: 'File not found' };
    }
  });
}
