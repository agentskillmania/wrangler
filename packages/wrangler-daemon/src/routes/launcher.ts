import type { FastifyInstance } from 'fastify';
import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Launcher data route — agents, skills, sessions overview.
 *
 * Provides a single endpoint that returns all launcher data needed
 * to render the home screen: available agents, skills, and sessions.
 */
export async function launcherRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const resourceManager = () => decorated.resourceManager;
  const sessionManager = () => decorated.sessionManager;

  /**
   * GET /api/launcher
   *
   * Returns combined launcher data: agents, skills, and sessions.
   * All three queries run in parallel for efficiency.
   */
  fastify.get('/api/launcher', async () => {
    const [agents, skills, sessions] = await Promise.all([
      resourceManager().listAgents(),
      resourceManager().listSkills(),
      sessionManager().list(),
    ]);
    return { agents, skills, sessions };
  });
}
