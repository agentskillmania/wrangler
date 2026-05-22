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

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send initial state snapshot
    writeSSE(reply, 'agent-state', {
      agentName: info.agentName,
      model: info.model,
      status: sessionManager().getStatus(sessionId),
      tokensIn: 0,
      tokensOut: 0,
      tokensTotal: 0,
      contextLimit: 200000,
      stepCount: 0,
      skills: [],
      tools: [],
      estimatedContextSize: 0,
      compressionHistory: [],
    });

    // If AgentSession is active, wire cockpit event forwarding
    const agentSession = sessionManager().getAgentSession(sessionId);
    if (agentSession) {
      agentSession.setCockpitSender((event) => {
        writeSSE(reply, event.event, event.data);
      });
      request.raw.on('close', () => {
        agentSession.setCockpitSender(null);
      });
    }
  });
}
