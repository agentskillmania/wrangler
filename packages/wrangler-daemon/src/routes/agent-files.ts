import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { FastifyInstance } from 'fastify';

import type { DecoratedFastifyInstance } from '../types.js';
import { resolveWithinRoot, listFiles } from '../utils.js';

/**
 * Agent file CRUD routes.
 *
 * Provides endpoints for browsing and editing files within an agent
 * directory (AGENT.md, mcp.json, private skills, etc.).
 */
export async function agentFileRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const resourceManager = () => decorated.resourceManager;

  /**
   * GET /api/agents/:id/files
   *
   * Returns a recursive file listing for an agent directory.
   * Each entry has name, path (relative to agent dir), size, and isDirectory flag.
   */
  fastify.get('/api/agents/:id/files', async (request) => {
    const { id } = request.params as { id: string };
    const detail = await resourceManager().getAgent(id);
    if (!detail) {
      return { error: 'Agent not found' };
    }
    return listFiles(detail.path, '');
  });

  /**
   * GET /api/agents/:id/file?path=<relativePath>
   *
   * Returns the text content of a file in the agent directory.
   * Query parameter `path` is required.
   */
  fastify.get('/api/agents/:id/file', async (request, _reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { path?: string };
    const detail = await resourceManager().getAgent(id);
    if (!detail) {
      return { error: 'Agent not found' };
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
   * PUT /api/agents/:id/file
   *
   * Writes content to an existing file in the agent directory.
   * Body must contain `path` and `content` fields.
   */
  fastify.put('/api/agents/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { path?: string; content?: string };
    const detail = await resourceManager().getAgent(id);
    if (!detail) {
      return { error: 'Agent not found' };
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
   * POST /api/agents/:id/file
   *
   * Creates a new file (and any missing parent directories) in the agent directory.
   * Body must contain `path`. `content` defaults to empty string.
   */
  fastify.post('/api/agents/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { path?: string; content?: string };
    const detail = await resourceManager().getAgent(id);
    if (!detail) {
      return { error: 'Agent not found' };
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
   * DELETE /api/agents/:id/file
   *
   * Deletes a file from the agent directory.
   * Body must contain `path`.
   */
  fastify.delete('/api/agents/:id/file', async (request, _reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { path?: string };
    const detail = await resourceManager().getAgent(id);
    if (!detail) {
      return { error: 'Agent not found' };
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
