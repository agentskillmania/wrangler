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

    await streamAgentSession(reply, agentSession, body.message, {
      thinkingEnabled: body.thinkingEnabled,
      model: body.model,
      sessionId,
      sessionManager: sessionManager(),
      emitSessionStart: true,
    });
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

    await streamAgentSession(reply, agentSession, body.message, {
      thinkingEnabled: body.thinkingEnabled,
      model: body.model,
      sessionId,
      sessionManager: sessionManager(),
      // Resume does NOT emit session-start (the client already has the id).
      emitSessionStart: false,
    });
  });
}

/**
 * Shared SSE streaming helper for both new-conversation and resume routes.
 *
 * Responsibilities:
 * 1. Hijack the reply and open a `text/event-stream`.
 * 2. Optionally emit `session-start` as the first event (new chats only).
 * 3. Forward each event from `agentSession.handleMessage` to the client.
 * 4. CONC5: abort the agent when the client drops the connection mid-stream
 *    so the runner does not keep burning tokens after the user navigates away.
 * 5. Update SessionManager status to idle/error and close the stream cleanly.
 *
 * The `settled` flag distinguishes a client disconnect from the natural end
 * of the stream — both close `reply.raw`, so we need it to avoid calling
 * `stop()` after the run already finished.
 */
async function streamAgentSession(
  reply: FastifyReply,
  agentSession: AgentSession,
  message: string,
  opts: {
    thinkingEnabled?: boolean;
    model?: string;
    sessionId: string;
    sessionManager: DecoratedFastifyInstance['sessionManager'];
    emitSessionStart: boolean;
  }
): Promise<void> {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let clientGone = false;
  let settled = false;
  const onDisconnect = () => {
    if (!settled && !clientGone) {
      clientGone = true;
      agentSession.stop();
    }
  };
  reply.raw.on('close', onDisconnect);

  if (opts.emitSessionStart) {
    writeSSE(reply, 'session-start', { sessionId: opts.sessionId });
    agentSession.emitCockpitEvent({
      event: 'session-start',
      data: { sessionId: opts.sessionId },
    });
  }

  try {
    for await (const sse of agentSession.handleMessage(message, {
      thinkingEnabled: opts.thinkingEnabled,
      model: opts.model,
    })) {
      if (clientGone) break;
      writeSSE(reply, sse.event, sse.data);
    }
    if (!clientGone) opts.sessionManager.updateStatus(opts.sessionId, 'idle');
  } catch {
    if (!clientGone) {
      writeSSE(reply, 'error', { message: 'Internal server error' });
      opts.sessionManager.updateStatus(opts.sessionId, 'error');
    }
  } finally {
    settled = true;
    if (!clientGone) reply.raw.end();
  }
}
