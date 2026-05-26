import type { FastifyInstance } from 'fastify';
import { readFile, writeFile, unlink, mkdir, readdir, stat as statFn } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Resolve a path relative to a root directory, preventing path traversal.
 *
 * @param root - Absolute root path
 * @param relativePath - Relative path to resolve
 * @returns Absolute resolved path within root
 * @throws Error if the resolved path escapes the root
 */
function resolvePath(root: string, relativePath: string): string {
  const resolved = resolve(root, relativePath);
  if (!resolved.startsWith(root)) {
    throw new Error('Path outside crew directory');
  }
  return resolved;
}

/**
 * Crew file CRUD routes.
 *
 * Provides endpoints for browsing and editing files within a crew
 * directory (CREW.md, agent definitions, private skills, etc.).
 */
export async function crewFileRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const resourceManager = () => decorated.resourceManager;

  /**
   * GET /api/crews/:id/files
   *
   * Returns a recursive file listing for a crew directory.
   * Each entry has name, path (relative to crew dir), size, and isDirectory flag.
   */
  fastify.get('/api/crews/:id/files', async (request) => {
    const { id } = request.params as { id: string };
    const detail = await resourceManager().getCrew(id);
    if (!detail) {
      return { error: 'Crew not found' };
    }
    return listFiles(detail.path, '');
  });

  /**
   * GET /api/crews/:id/file?path=<relativePath>
   *
   * Returns the text content of a file in the crew directory.
   * Query parameter `path` is required.
   */
  fastify.get('/api/crews/:id/file', async (request, _reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { path?: string };
    const detail = await resourceManager().getCrew(id);
    if (!detail) {
      return { error: 'Crew not found' };
    }
    if (!query.path) {
      return { error: 'path is required' };
    }

    try {
      const fullPath = resolvePath(detail.path, query.path);
      const content = await readFile(fullPath, 'utf-8');
      return { content, path: query.path };
    } catch {
      return { error: 'File not found' };
    }
  });

  /**
   * PUT /api/crews/:id/file
   *
   * Writes content to an existing file in the crew directory.
   * Body must contain `path` and `content` fields.
   */
  fastify.put('/api/crews/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { path?: string; content?: string };
    const detail = await resourceManager().getCrew(id);
    if (!detail) {
      return { error: 'Crew not found' };
    }
    if (!body.path || body.content === undefined) {
      return { error: 'path and content required' };
    }

    try {
      const fullPath = resolvePath(detail.path, body.path);
      await writeFile(fullPath, body.content, 'utf-8');
      return { ok: true };
    } catch {
      return reply.code(400).send({ error: 'Invalid path' });
    }
  });

  /**
   * POST /api/crews/:id/file
   *
   * Creates a new file (and any missing parent directories) in the crew directory.
   * Body must contain `path`. `content` defaults to empty string.
   */
  fastify.post('/api/crews/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { path?: string; content?: string };
    const detail = await resourceManager().getCrew(id);
    if (!detail) {
      return { error: 'Crew not found' };
    }
    if (!body.path) {
      return { error: 'path is required' };
    }

    try {
      const fullPath = resolvePath(detail.path, body.path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, body.content ?? '', 'utf-8');
      return { ok: true, path: body.path };
    } catch {
      return reply.code(400).send({ error: 'Invalid path' });
    }
  });

  /**
   * DELETE /api/crews/:id/file
   *
   * Deletes a file from the crew directory.
   * Body must contain `path`.
   */
  fastify.delete('/api/crews/:id/file', async (request, _reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { path?: string };
    const detail = await resourceManager().getCrew(id);
    if (!detail) {
      return { error: 'Crew not found' };
    }
    if (!body.path) {
      return { error: 'path is required' };
    }

    try {
      const fullPath = resolvePath(detail.path, body.path);
      await unlink(fullPath);
      return { ok: true };
    } catch {
      return { error: 'File not found' };
    }
  });
}

/** File entry returned by the listing endpoint */
interface FileEntry {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  children?: FileEntry[];
}

/** Recursively list files in a directory, excluding hidden files and node_modules */
async function listFiles(dirPath: string, relPrefix: string): Promise<FileEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const filtered = entries.filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules');

  const result: FileEntry[] = [];
  for (const entry of filtered) {
    const fullPath = join(dirPath, entry.name);
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    try {
      const fileStat = await statFn(fullPath);
      if (fileStat.isDirectory()) {
        const children = await listFiles(fullPath, relPath);
        result.push({
          name: entry.name,
          path: relPath,
          size: 0,
          isDirectory: true,
          children,
        });
      } else {
        result.push({
          name: entry.name,
          path: relPath,
          size: fileStat.size,
          isDirectory: false,
        });
      }
    } catch {
      /* skip unreadable entries */
    }
  }

  return result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
