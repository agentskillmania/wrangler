import { SessionNotFoundError } from '@agentskillmania/wrangler';
import { BUILTIN_SKILLS_DIR } from '@agentskillmania/wrangler-devtool';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { AgentSession } from '../core/agent-session.js';
import type { AgentSessionOptions } from '../core/agent-session.js';
import type {
  DecoratedFastifyInstance,
  CreateAndChatRequest,
  ResumeChatRequest,
} from '../types.js';
import { writeSSE } from '../utils.js';

/** Predefined slash commands for the chat input */
const COMMANDS = [
  {
    id: 'search',
    label: 'Search',
    command: 'Help me search ',
    group: 'Tools',
    description: 'Search the internet',
  },
  {
    id: 'file',
    label: 'File ops',
    command: 'Help me list workspace files',
    group: 'Tools',
    description: 'Read/write workspace files',
  },
  {
    id: 'shell',
    label: 'Run command',
    command: 'Help me run command: ',
    group: 'Tools',
    description: 'Execute shell commands',
  },
  {
    id: 'todo',
    label: 'Task management',
    command: 'Help me create a task list: ',
    group: 'Tools',
    description: 'Manage task lists',
  },
  {
    id: 'ask',
    label: 'Ask me',
    command: 'Please ask me questions first before answering: ',
    group: 'Interaction',
    description: 'Let AI ask you questions to understand requirements',
  },
  {
    id: 'think',
    label: 'Deep think',
    command: 'Please think carefully before answering: ',
    group: 'Chat',
    description: 'Trigger deep thinking mode',
  },
];

/**
 * Chat SSE streaming routes.
 *
 * Two entry points:
 * - POST /api/agents/:name/chat — start a NEW conversation with an agent
 * - POST /api/chat/:sessionId   — RESUME an existing conversation
 *
 * Plus: stop, respond (AskHuman), commands, message history.
 */
export async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const sessionManager = () => decorated.sessionManager;
  const configManager = () => decorated.configManager;
  const resourceManager = () => decorated.resourceManager;

  /**
   * GET /api/chat/commands
   *
   * Returns the list of predefined slash commands for the chat input.
   */
  fastify.get('/api/chat/commands', async () => {
    return COMMANDS;
  });

  /**
   * GET /api/chat/:sessionId/messages
   *
   * Returns chat message history for a session.
   * Reads persisted entries from SessionStore.
   */
  fastify.get('/api/chat/:sessionId/messages', async (request) => {
    const { sessionId } = request.params as { sessionId: string };

    const info = await sessionManager().getInfo(sessionId);
    if (!info) {
      return { error: 'Session not found' };
    }

    const store = sessionManager().getSessionStore(info.workspacePath);
    const entries = await store.readEntries(sessionId);

    return { messages: entries };
  });

  /**
   * POST /api/chat/:sessionId/stop
   *
   * Aborts the active agent execution for a session.
   */
  fastify.post('/api/chat/:sessionId/stop', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const agentSession = sessionManager().getAgentSession(sessionId);
    if (agentSession) {
      agentSession.stop();
    }
    return { ok: true };
  });

  /**
   * POST /api/chat/:sessionId/respond — respond to AskHuman
   *
   * Resolves a pending human-input request.
   */
  fastify.post('/api/chat/:sessionId/respond', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as { requestId?: string; response?: unknown };

    if (!body.requestId) {
      return { error: 'requestId is required' };
    }

    const agentSession = sessionManager().getAgentSession(sessionId);
    if (!agentSession) {
      return { error: 'Session not found or not yet active' };
    }

    const found = agentSession.respondHumanInput(body.requestId, body.response);
    if (!found) {
      return { error: 'Request not found or already answered' };
    }
    return { ok: true };
  });

  /**
   * POST /api/agents/:name/chat — NEW conversation
   *
   * Loads agent config, creates fresh AgentState, runs EnhancedRunner.
   * Wrangler session middleware auto-creates the session during run.
   * Returns SSE stream. The 'done' event includes sessionId.
   */
  fastify.post('/api/agents/:name/chat', async (request, reply) => {
    const { name } = request.params as { name: string };
    const body = request.body as CreateAndChatRequest;

    if (!body.message?.trim()) {
      reply.code(400).send({ error: 'message is required' });
      return;
    }

    if (!body.workspacePath?.trim()) {
      reply.code(400).send({ error: 'workspacePath is required' });
      return;
    }

    const agentDetail = await resourceManager().getAgent(name);
    if (!agentDetail) {
      reply.code(404).send({ error: 'Agent not found' });
      return;
    }

    const workspacePath = body.workspacePath;

    const sessionOptions: AgentSessionOptions = {
      workspacePath,
      agentName: agentDetail.name,
      agentInstructions: agentDetail.instructions,
      model: agentDetail.model,
      skillDirs: [
        ...(body.config?.skillDirs ?? agentDetail.skillDirs ?? []),
        BUILTIN_SKILLS_DIR, // always include devtool's built-in skills (architect/reviewer/curator)
      ],
      mcpConfigPaths: body.config?.mcpConfigPaths ?? agentDetail.mcpPaths,
      sessionBaseDir: sessionManager().baseDir,
      sessionManager: sessionManager(),
      agentConfigPath: agentDetail.path,
      // New config fields from request body
      builtinTools: body.config?.builtinTools as AgentSessionOptions['builtinTools'],
      enableSession: body.config?.enableSession,
      enableTodolist: body.config?.enableTodolist,
      enableCommands: body.config?.enableCommands,
      sandbox: body.config?.sandbox,
      a2ui: body.config?.a2ui,
    };

    const config = configManager().get();
    const agentSession = await AgentSession.create(sessionOptions, config);
    const sessionId = agentSession.sessionId;

    // Register session so wrangler's auto-created session is discoverable
    sessionManager().registerSession(sessionId, workspacePath);
    sessionManager().setAgentSession(sessionId, agentSession);
    sessionManager().updateStatus(sessionId, 'running');

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // CONC5: if the client drops the connection (page close, network loss,
    // or premature EventSource close), abort the agent so it stops burning
    // tokens and the session returns to idle instead of hanging in running.
    // We listen on reply.raw (the socket) rather than request.raw, because
    // once the request body is consumed request.raw has nothing left to
    // signal — reply.raw is what actually reflects socket lifecycle.
    // `settled` distinguishes a client disconnect (still streaming) from the
    // natural end of the stream, which also closes reply.raw.
    let clientGone = false;
    let settled = false;
    const onDisconnect = () => {
      if (!settled && !clientGone) {
        clientGone = true;
        agentSession.stop();
      }
    };
    reply.raw.on('close', onDisconnect);

    // Send sessionId as first event so client can save it
    writeSSE(reply, 'session-start', { sessionId });
    agentSession.emitCockpitEvent({ event: 'session-start', data: { sessionId } });

    try {
      for await (const sse of agentSession.handleMessage(body.message, {
        thinkingEnabled: body.thinkingEnabled,
        model: body.model,
      })) {
        if (clientGone) break;
        writeSSE(reply, sse.event, sse.data);
      }
      if (!clientGone) sessionManager().updateStatus(sessionId, 'idle');
    } catch {
      if (!clientGone) {
        writeSSE(reply, 'error', { message: 'Internal server error' });
        sessionManager().updateStatus(sessionId, 'error');
      }
    } finally {
      settled = true;
      if (!clientGone) reply.raw.end();
    }
  });

  /**
   * POST /api/chat/:sessionId — RESUME conversation
   *
   * Loads existing state from SessionStore, appends user message,
   * runs EnhancedRunner. Streams SSE events until completion.
   */
  fastify.post('/api/chat/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as ResumeChatRequest;

    if (!body.message?.trim()) {
      reply.code(400).send({ error: 'message is required' });
      return;
    }

    const info = await sessionManager().getInfo(sessionId);
    if (!info) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }

    // Lazily resume AgentSession on first resume chat
    let agentSession = sessionManager().getAgentSession(sessionId);
    if (!agentSession) {
      const store = sessionManager().getSessionStore(info.workspacePath);
      const agentDetail = await resourceManager().getAgent(info.agentName);
      const sessionDir = store.getSessionDir(sessionId);
      const config = configManager().get();

      try {
        agentSession = await AgentSession.resume(
          sessionDir,
          {
            sessionId,
            workspacePath: info.workspacePath,
            agentName: info.agentName,
            agentConfigPath: agentDetail?.path,
            sessionStore: store,
            sessionManager: sessionManager(),
          },
          config
        );
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          reply.code(410).send({ error: 'Session expired, please start a new conversation' });
          return;
        }
        throw error;
      }

      sessionManager().setAgentSession(sessionId, agentSession);
    }

    // Reject if session is already processing a message
    if (agentSession.busy) {
      reply.code(409).send({ error: 'Session is busy' });
      return;
    }

    sessionManager().updateStatus(sessionId, 'running');

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // CONC5: stop the agent if the client drops the connection mid-stream.
    // See new-conversation route above for why reply.raw (not request.raw)
    // and why the `settled` guard is required.
    let clientGone = false;
    let settled = false;
    const onDisconnect = () => {
      if (!settled && !clientGone) {
        clientGone = true;
        agentSession.stop();
      }
    };
    reply.raw.on('close', onDisconnect);

    try {
      for await (const sse of agentSession.handleMessage(body.message, {
        thinkingEnabled: body.thinkingEnabled,
        model: body.model,
      })) {
        if (clientGone) break;
        writeSSE(reply, sse.event, sse.data);
      }
      if (!clientGone) sessionManager().updateStatus(sessionId, 'idle');
    } catch {
      if (!clientGone) {
        writeSSE(reply, 'error', { message: 'Internal server error' });
        sessionManager().updateStatus(sessionId, 'error');
      }
    } finally {
      settled = true;
      if (!clientGone) reply.raw.end();
    }
  });
}
