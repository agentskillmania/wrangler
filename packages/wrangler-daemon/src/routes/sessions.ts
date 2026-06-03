import type { FastifyInstance } from 'fastify';

import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Session query and deletion routes.
 *
 * Sessions are created automatically by wrangler session middleware during
 * runner.run(). This module only provides read, fork, and delete operations.
 */
export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const manager = () => decorated.sessionManager;

  /**
   * GET /api/sessions
   *
   * Returns all sessions sorted by most recently updated.
   * Optional query parameter `workspacePath` filters by workspace.
   */
  fastify.get('/api/sessions', async (request) => {
    const query = request.query as { workspacePath?: string };
    return manager().list(query.workspacePath);
  });

  /**
   * POST /api/sessions/:id/fork
   *
   * Forks a session: copies agent state and conversation history
   * into a new session with a new ID. The new session can continue
   * independently from the same point.
   */
  fastify.post('/api/sessions/:id/fork', async (request) => {
    const { id } = request.params as { id: string };

    const info = await manager().getInfo(id);
    if (!info) return { error: 'Session not found' };

    const store = manager().getSessionStore(info.workspacePath);

    const state = await store.loadState(id);
    if (!state) return { error: 'Session state not found' };

    // Generate a new session ID and create the session
    const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    await store.createWithId(newId, info.model, info.agentName);

    // Copy state with new ID
    const forkedState = { ...state, id: newId };
    await store.saveState(newId, forkedState);

    // Copy conversation entries
    const entries = await store.readEntries(id);
    for (const entry of entries) {
      await store.appendEntry(newId, entry);
    }

    manager().registerSession(newId, info.workspacePath);

    return { id: newId };
  });

  /**
   * GET /api/sessions/:id
   *
   * Returns session info by id.
   */
  fastify.get('/api/sessions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const info = await manager().getInfo(id);
    if (!info) return { error: 'Session not found' };
    return info;
  });

  /**
   * DELETE /api/sessions/:id
   *
   * Deletes a session by id. Stops the active AgentSession if running.
   */
  fastify.delete('/api/sessions/:id', async (request) => {
    const { id } = request.params as { id: string };
    await manager().delete(id);
    return { ok: true };
  });
}
