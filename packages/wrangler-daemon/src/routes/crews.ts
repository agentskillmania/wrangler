import type { FastifyInstance } from 'fastify';
import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Crew CRUD API routes.
 *
 * Provides endpoints for:
 * - Listing all crews
 * - Getting a single crew by id
 * - Creating a new crew
 * - Deleting a crew
 */
export async function crewRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const manager = () => decorated.resourceManager;

  /**
   * GET /api/crews
   *
   * Returns a list of all available crews.
   */
  fastify.get('/api/crews', async () => {
    return manager().listCrews();
  });

  /**
   * GET /api/crews/:id
   *
   * Returns detailed crew info with parsed CREW.md content,
   * agent list, and skill list.
   * Returns error object if crew not found.
   */
  fastify.get('/api/crews/:id', async (request) => {
    const { id } = request.params as { id: string };
    const detail = await manager().getCrew(id);
    if (!detail) return { error: 'Crew not found' };
    return detail;
  });

  /**
   * POST /api/crews
   *
   * Creates a new crew.
   * Body must contain `name` field. `description`, `primaryAgent`,
   * and `instructions` are optional.
   * Returns the created crew id.
   */
  fastify.post('/api/crews', async (request) => {
    const body = request.body as {
      name?: string;
      description?: string;
      primaryAgent?: string;
      instructions?: string;
    };
    if (!body.name) return { error: 'name is required' };
    const id = await manager().createCrew({
      name: body.name,
      description: body.description,
      primaryAgent: body.primaryAgent,
      instructions: body.instructions,
    });
    return { id };
  });

  /**
   * DELETE /api/crews/:id
   *
   * Deletes a crew by id.
   * Returns success confirmation.
   */
  fastify.delete('/api/crews/:id', async (request) => {
    const { id } = request.params as { id: string };
    await manager().deleteCrew(id);
    return { ok: true };
  });
}
