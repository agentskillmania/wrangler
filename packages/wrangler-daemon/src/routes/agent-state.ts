import type { FastifyInstance, FastifyReply } from 'fastify';

import type { DecoratedFastifyInstance } from '../types.js';
import { writeSSE, writeGenericSSE } from '../utils.js';

/**
 * Agent state SSE route — streams cockpit events for a session.
 *
 * Opens a long-lived SSE connection that sends an initial state snapshot
 * then forwards cockpit events from the active AgentSession in real-time.
 */
export async function agentStateRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const sessionManager = () => decorated.sessionManager;

  /**
   * GET /api/agent/:sessionId/state
   *
   * Opens an SSE stream for agent state updates. Sends an initial
   * snapshot immediately, then forwards cockpit events if an
   * AgentSession is active.
   */
  fastify.get('/api/agent/:sessionId/state', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const info = await sessionManager().getInfo(sessionId);
    if (!info) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // If AgentSession is active, wire event forwarding (history + live events)
    const agentSession = sessionManager().getAgentSession(sessionId);
    if (agentSession) {
      const removeSender = agentSession.addCockpitSender((event) => {
        if (event.event === 'agent-diagnostics') {
          writeSSE(reply, 'agent-diagnostics', event.data);
        } else {
          writeGenericSSE(reply, event);
        }
      });
      // Listen on reply.raw (the socket) — see chat.ts CONC5 note. The
      // request body is already consumed by the time SSE opens, so
      // request.raw would not reliably fire on client disconnect.
      reply.raw.on('close', () => {
        removeSender();
      });
    } else {
      // No in-memory AgentSession — load persisted state from disk
      const store = sessionManager().getSessionStore(info.workspacePath);
      const persistedState = await store.loadState(sessionId);
      const status = sessionManager().getStatus(sessionId) ?? 'idle';
      const ctx = persistedState?.context;
      const tokensIn = ctx?.totalTokens?.input;
      const tokensOut = ctx?.totalTokens?.output;
      writeSSE(reply, 'agent-diagnostics', {
        runner: { features: null, tools: [], skills: [] },
        agent: persistedState ?? { status: 'no-state' },
        llm: null,
        session: {
          overview: {
            title: info.title,
            agentName: info.agentName,
            model: info.runnerConfig?.model,
            stepCount: ctx?.stepCount ?? 0,
            messageCount: ctx?.messages?.length ?? 0,
            tokensIn,
            tokensOut,
            tokensTotal:
              tokensIn != null && tokensOut != null ? tokensIn + tokensOut : undefined,
            status,
            createdAt: info.createdAt,
            updatedAt: info.updatedAt,
          },
          info: {
            sessionId,
            agentName: info.agentName,
            workspacePath: info.workspacePath,
          },
        },
      });
    }
  });
}
