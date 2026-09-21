import { readFile, writeFile, unlink, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, basename, relative, join } from 'node:path';

import { readMeta } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import type { FastifyInstance } from 'fastify';

import type { DecoratedFastifyInstance } from '../types.js';
import { resolveWithinRoot } from '../utils.js';

/**
 * MIME type by file extension for the raw bytes endpoint.
 *
 * Mirrors Rust `static_assets::mime_type_for` (d7dbde2): the static-asset
 * helper was widened with common image/document types so `/api/files/:id/raw`
 * can serve previews, falling back to `application/octet-stream`. The
 * extension is lower-cased so `PIC.PNG` resolves too.
 */
function mimeTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  const ext = dot === -1 ? '' : filePath.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'html':
      return 'text/html';
    case 'css':
      return 'text/css';
    case 'js':
      return 'application/javascript';
    case 'json':
      return 'application/json';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'ico':
      return 'image/x-icon';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
    case 'md':
    case 'markdown':
      return 'text/plain';
    case 'woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
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
  /**
   * Resolve the workspace path for a session — either from an explicit
   * sessionDir (notebook-dir sessions, reads meta.yaml) or the standard tree.
   */
  async function resolveWorkspace(sessionId: string, sessionDir?: string): Promise<string | null> {
    if (sessionDir) {
      const meta = await readMeta(sessionDir, defaultNodeHostEnv);
      return meta?.workspacePath ?? null;
    }
    const info = await sessionManager().getInfo(sessionId);
    return info?.workspacePath ?? null;
  }

  fastify.get('/api/sessions/:sessionId/files/tree', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { sessionDir?: string };
    const workspacePath = await resolveWorkspace(sessionId, query.sessionDir);
    if (!workspacePath) return { error: 'Session not found' };
    return buildFileTree(workspacePath, workspacePath);
  });

  /**
   * GET /api/files/:sessionId/content?path=<relativePath>&sessionDir=<dir>
   *
   * Returns the text content of a file in the session's workspace.
   * Query parameter `path` is required.
   */
  fastify.get('/api/sessions/:sessionId/files/content', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { path?: string; sessionDir?: string };
    const workspacePath = await resolveWorkspace(sessionId, query.sessionDir);
    if (!workspacePath) return { error: 'Session not found' };
    if (!query.path) return { error: 'path is required' };

    try {
      const fullPath = resolveWithinRoot(workspacePath, query.path);
      const content = await readFile(fullPath, 'utf-8');
      return { content, path: query.path };
    } catch {
      return { error: 'File not found' };
    }
  });

  /**
   * GET /api/files/:sessionId/raw?path=<relativePath>&sessionDir=<dir>
   *
   * Serves a workspace file's raw bytes — the binary preview channel the
   * text-only `content` endpoint cannot carry (images, PDFs). Addressing and
   * traversal protection are identical to `content` (`resolveWorkspace` +
   * `resolveWithinRoot`); the response is NOT JSON-wrapped.
   *
   * Status: 404 unknown session / missing file / directory (a traversal path
   * is clamped and lands here too, never leaking outside the root), 400
   * missing path. Mirrors Rust `file_raw` (d7dbde2) with the TS error shape.
   */
  fastify.get('/api/sessions/:sessionId/files/raw', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { path?: string; sessionDir?: string };
    const workspacePath = await resolveWorkspace(sessionId, query.sessionDir);
    if (!workspacePath) {
      reply.code(404);
      return { error: 'Session not found' };
    }
    if (!query.path) {
      reply.code(400);
      return { error: 'path is required' };
    }

    // resolveWithinRoot throwing (escape attempt) propagates as 500, matching
    // the content PUT path — the raw channel must never fall back to reading
    // outside the workspace.
    const fullPath = resolveWithinRoot(workspacePath, query.path);
    let data: Buffer;
    try {
      // No encoding: bytes are returned verbatim (binary-safe). Directories
      // make readFile throw EISDIR → 404, like a missing file.
      data = await readFile(fullPath);
    } catch {
      reply.code(404);
      return { error: 'File not found' };
    }
    reply.type(mimeTypeFor(query.path));
    return reply.send(data);
  });

  /**
   * PUT /api/files/:sessionId/content?sessionDir=<dir>
   *
   * Writes content to an existing file in the session's workspace.
   * Body must contain `path` and `content` fields.
   */
  fastify.put('/api/sessions/:sessionId/files/content', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { sessionDir?: string };
    const body = request.body as { path?: string; content?: string };
    // 与读侧(tree/content)对齐：显式 sessionDir 优先（笔记目录即会话），
    // 否则按会话 id 查标准 sessions 树。此前写侧只认标准树，notebook
    // 会话的写/建/删全 404——读写不对称（R2P-234，对齐 Rust 96ddf46）。
    const workspacePath = await resolveWorkspace(sessionId, query.sessionDir);
    if (!workspacePath) return { error: 'Session not found' };
    if (!body.path || body.content === undefined) return { error: 'path and content required' };

    const fullPath = resolveWithinRoot(workspacePath, body.path);
    await writeFile(fullPath, body.content, 'utf-8');
    return { ok: true };
  });

  /**
   * POST /api/files/:sessionId?sessionDir=<dir>
   *
   * Creates a new file (and any missing parent directories) in the workspace.
   * Body must contain `path`. `content` defaults to empty string.
   */
  fastify.post('/api/sessions/:sessionId/files', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { sessionDir?: string };
    const body = request.body as { path?: string; content?: string };
    const workspacePath = await resolveWorkspace(sessionId, query.sessionDir);
    if (!workspacePath) return { error: 'Session not found' };
    if (!body.path) return { error: 'path is required' };

    const fullPath = resolveWithinRoot(workspacePath, body.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, body.content ?? '', 'utf-8');
    return { ok: true, path: body.path };
  });

  /**
   * DELETE /api/files/:sessionId?sessionDir=<dir>
   *
   * Deletes a file from the session's workspace.
   * Body must contain `path`.
   */
  fastify.delete('/api/sessions/:sessionId/files', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { sessionDir?: string };
    const body = request.body as { path?: string };
    const workspacePath = await resolveWorkspace(sessionId, query.sessionDir);
    if (!workspacePath) return { error: 'Session not found' };
    if (!body.path) return { error: 'path is required' };

    try {
      const fullPath = resolveWithinRoot(workspacePath, body.path);
      await unlink(fullPath);
      return { ok: true };
    } catch {
      return { error: 'File not found' };
    }
  });
}
