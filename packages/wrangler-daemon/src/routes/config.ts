import type { FastifyInstance } from 'fastify';

import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Config read/write API routes.
 *
 * Provides endpoints for:
 * - Getting current daemon config
 * - Updating config values
 * - Reading/writing the daemon config raw content
 */
export async function configRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const manager = () => decorated.configManager;

  /**
   * GET /api/config
   *
   * Returns the current daemon configuration.
   */
  fastify.get('/api/config', async () => {
    return manager().get();
  });

  /**
   * PATCH /api/config
   *
   * Updates partial configuration values and persists to disk.
   * Returns the updated full configuration.
   */
  fastify.patch('/api/config', async (request) => {
    const partial = request.body as Record<string, unknown>;
    await manager().update(partial);
    return manager().get();
  });

  /**
   * GET /api/config/raw
   *
   * Returns the raw content of the daemon config file.
   * Always reads from the daemon's own configPath — no path parameter.
   */
  fastify.get('/api/config/raw', async () => {
    const content = await manager().getConfigFileRaw();
    return { content };
  });

  /**
   * PUT /api/config/raw
   *
   * Overwrites the daemon config file with the given content.
   * Body must contain a `content` field. The content is validated as YAML
   * (with a mapping root) before writing to prevent corrupting the config.
   * Always writes to the daemon's own configPath — no path parameter.
   */
  fastify.put('/api/config/raw', async (request, reply) => {
    const body = request.body as { content?: string };
    if (body.content === undefined) {
      reply.code(400);
      return { error: 'content is required' };
    }
    try {
      await manager().setConfigFileRaw(body.content);
      return { ok: true };
    } catch (e) {
      reply.code(400);
      const msg = e instanceof Error ? e.message : String(e);
      return { error: msg };
    }
  });
}
