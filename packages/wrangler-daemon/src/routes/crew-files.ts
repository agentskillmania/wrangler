import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { FastifyInstance } from 'fastify';

import type { DecoratedFastifyInstance } from '../types.js';
import { resolveWithinRoot, listFiles } from '../utils.js';

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
      const fullPath = resolveWithinRoot(detail.path, query.path);
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
      const fullPath = resolveWithinRoot(detail.path, body.path);
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
      const fullPath = resolveWithinRoot(detail.path, body.path);
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
      const fullPath = resolveWithinRoot(detail.path, body.path);
      await unlink(fullPath);
      return { ok: true };
    } catch {
      return { error: 'File not found' };
    }
  });
}
