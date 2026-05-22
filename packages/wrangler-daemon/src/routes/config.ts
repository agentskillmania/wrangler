import type { FastifyInstance } from 'fastify';
import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Config read/write API routes.
 *
 * Provides endpoints for:
 * - Getting current daemon config
 * - Updating config values
 * - Reading/writing arbitrary config files
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
   * GET /api/config/file?path=<filepath>
   *
   * Reads and returns the content of an arbitrary config file.
   * Query parameter `path` is required.
   */
  fastify.get('/api/config/file', async (request) => {
    const query = request.query as { path?: string };
    if (!query.path) return { error: 'path is required' };
    const content = await manager().getConfigFile(query.path);
    return { content };
  });

  /**
   * PUT /api/config/file
   *
   * Writes content to an arbitrary config file.
   * Body must contain `path` and `content` fields.
   */
  fastify.put('/api/config/file', async (request) => {
    const body = request.body as { path?: string; content?: string };
    if (!body.path || body.content === undefined) {
      return { error: 'path and content are required' };
    }
    await manager().setConfigFile(body.path, body.content);
    return { ok: true };
  });
}
