import type { FastifyInstance, FastifyReply } from 'fastify';

import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Write an SSE frame to the raw response stream.
 *
 * @param reply - Fastify reply with raw writable stream
 * @param event - SSE event name
 * @param data - Event payload (will be JSON-serialized)
 */
function writeSSE(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Write a generic SSE message (no event name) — caught by onmessage.
 *
 * @param reply - Fastify reply with raw writable stream
 * @param data - Event payload (will be JSON-serialized)
 */
function writeGenericSSE(reply: FastifyReply, data: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

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
      writeSSE(reply, 'agent-diagnostics', {
        runner: { features: null, tools: [], skills: [] },
        agent: persistedState ?? { status: 'no-state' },
        llm: null,
      });
    }
  });
}
