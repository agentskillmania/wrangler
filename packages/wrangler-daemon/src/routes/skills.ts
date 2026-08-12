import type { FastifyInstance } from 'fastify';

import { FilesystemSkillProvider } from '@agentskillmania/colts';
import { BUILTIN_SKILLS_DIR } from '@agentskillmania/wrangler-devtool';

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
    try {
      const id = await manager().createSkill({
        name: body.name,
        description: body.description ?? '',
      });
      return { id };
    } catch (err) {
      return { error: (err as Error).message };
    }
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

  /**
   * GET /api/skills/available
   *
   * Returns runtime-available skills (builtin + user-supplied dirs).
   * Mirrors the Rust daemon's GET /api/skills/available.
   * Query param: `?dirs=dir1,dir2` — comma-separated skill dirs to scan
   * (defaults to just the builtin skills dir).
   */
  fastify.get('/api/skills/available', async (request) => {
    const query = request.query as { dirs?: string };
    const dirs = [
      BUILTIN_SKILLS_DIR,
      ...(query.dirs?.split(',').map((s) => s.trim()).filter(Boolean) ?? []),
    ];
    const provider = new FilesystemSkillProvider(dirs);
    return { skills: await provider.listSkills() };
  });
}
