import type { FastifyInstance } from 'fastify';

import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Agent CRUD API routes.
 *
 * Provides endpoints for:
 * - Listing all agents
 * - Getting a single agent by id
 * - Creating a new agent
 * - Deleting an agent
 */
export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const manager = () => decorated.resourceManager;

  /**
   * GET /api/agents
   *
   * Returns a list of all available agents.
   */
  fastify.get('/api/agents', async () => {
    return manager().listAgents();
  });

  /**
   * GET /api/agents/:id
   *
   * Returns detailed agent info with parsed AGENT.md content,
   * skill directories, and MCP paths.
   * Returns error object if agent not found.
   */
  fastify.get('/api/agents/:id', async (request) => {
    const { id } = request.params as { id: string };
    const detail = await manager().getAgent(id);
    if (!detail) return { error: 'Agent not found' };
    return detail;
  });

  /**
   * POST /api/agents
   *
   * Creates a new agent.
   * Body must contain `name` field. `instructions` is optional.
   * Returns the created agent id.
   */
  fastify.post('/api/agents', async (request) => {
    const body = request.body as { name?: string; instructions?: string };
    if (!body.name) return { error: 'name is required' };
    try {
      const id = await manager().createAgent({
        name: body.name,
        instructions: body.instructions ?? '',
      });
      return { id };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  /**
   * DELETE /api/agents/:id
   *
   * Deletes an agent by id.
   * Returns success confirmation.
   */
  fastify.delete('/api/agents/:id', async (request) => {
    const { id } = request.params as { id: string };
    await manager().deleteAgent(id);
    return { ok: true };
  });
}
