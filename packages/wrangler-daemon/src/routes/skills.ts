import type { FastifyInstance } from 'fastify';
import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Skill CRUD API routes.
 *
 * Provides endpoints for:
 * - Listing all skills
 * - Getting a single skill by id
 * - Creating a new skill
 * - Deleting a skill
 */
export async function skillRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const manager = () => decorated.resourceManager;

  /**
   * GET /api/skills
   *
   * Returns a list of all available skills.
   */
  fastify.get('/api/skills', async () => {
    return manager().listSkills();
  });

  /**
   * GET /api/skills/:id
   *
   * Returns detailed skill info with parsed SKILL.md content
   * and file listing.
   * Returns error object if skill not found.
   */
  fastify.get('/api/skills/:id', async (request) => {
    const { id } = request.params as { id: string };
    const detail = await manager().getSkill(id);
    if (!detail) return { error: 'Skill not found' };
    return detail;
  });

  /**
   * POST /api/skills
   *
   * Creates a new skill.
   * Body must contain `name` field. `description` is optional.
   * Returns the created skill id.
   */
  fastify.post('/api/skills', async (request) => {
    const body = request.body as { name?: string; description?: string };
    if (!body.name) return { error: 'name is required' };
    const id = await manager().createSkill({
      name: body.name,
      description: body.description ?? '',
    });
    return { id };
  });

  /**
   * DELETE /api/skills/:id
   *
   * Deletes a skill by id.
   * Returns success confirmation.
   */
  fastify.delete('/api/skills/:id', async (request) => {
    const { id } = request.params as { id: string };
    await manager().deleteSkill(id);
    return { ok: true };
  });
}
