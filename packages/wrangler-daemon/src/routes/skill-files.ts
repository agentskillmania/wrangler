import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';

import type { FastifyInstance } from 'fastify';

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
  // SEC9: relative() detects sibling-prefix escapes that startsWith misses.
  const rel = relative(root, resolved);
  if (rel.startsWith('..')) {
    throw new Error('Path outside skill directory');
  }
  return resolved;
}

/**
 * Skill file CRUD routes.
 *
 * Provides endpoints for managing files within a skill directory:
 * - Listing files
 * - Reading file content
 * - Writing/creating files
 * - Deleting files
 */
export async function skillFileRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const resourceManager = () => decorated.resourceManager;

  /**
   * GET /api/skills/:id/files
   *
   * Returns the file listing for a skill directory.
   * Non-hidden files only.
   */
  fastify.get('/api/skills/:id/files', async (request) => {
    const { id } = request.params as { id: string };
    const detail = await resourceManager().getSkill(id);
    if (!detail) {
      return { error: 'Skill not found' };
    }
    return detail.files;
  });

  /**
   * GET /api/skills/:id/file?path=<relativePath>
   *
   * Returns the text content of a file in the skill directory.
   * Query parameter `path` is required.
   */
  fastify.get('/api/skills/:id/file', async (request, _reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { path?: string };
    const detail = await resourceManager().getSkill(id);
    if (!detail) {
      return { error: 'Skill not found' };
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
   * PUT /api/skills/:id/file
   *
   * Writes content to an existing file in the skill directory.
   * Body must contain `path` and `content` fields.
   */
  fastify.put('/api/skills/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { path?: string; content?: string };
    const detail = await resourceManager().getSkill(id);
    if (!detail) {
      return { error: 'Skill not found' };
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
   * POST /api/skills/:id/file
   *
   * Creates a new file (and any missing parent directories) in the skill directory.
   * Body must contain `path`. `content` defaults to empty string.
   */
  fastify.post('/api/skills/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { path?: string; content?: string };
    const detail = await resourceManager().getSkill(id);
    if (!detail) {
      return { error: 'Skill not found' };
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
   * DELETE /api/skills/:id/file
   *
   * Deletes a file from the skill directory.
   * Body must contain `path`.
   */
  fastify.delete('/api/skills/:id/file', async (request, _reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { path?: string };
    const detail = await resourceManager().getSkill(id);
    if (!detail) {
      return { error: 'Skill not found' };
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
