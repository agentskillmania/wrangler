import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { LLMClient } from '@agentskillmania/llm-client';
import { Sandbox } from '@agentskillmania/sandbox';
import type { SessionMeta } from '@agentskillmania/wrangler';
import {
  SessionNotFoundError,
  SessionStore,
  crewToRunnerOptions,
  readMeta,
} from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { loadMCPTools } from '@agentskillmania/wrangler/tools/mcp';
import { createWebTools } from '@agentskillmania/wrangler/tools/web';
import { BUILTIN_SKILLS_DIR } from '@agentskillmania/wrangler-devtool';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { AgentSession } from '../core/agent-session.js';
import type { AgentSessionOptions, AgentSessionResumeOptions } from '../core/agent-session.js';
import { mergeSandboxConfig } from '../core/sandbox-config.js';
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

/**
 * 合并 sandbox 配置（config.yaml ← 请求体）并构造实例（enabled 时）。
 * Node 宿主职责——wrangler core 不捆绑 sandbox 运行时。
 */
function withSandboxInstance(
  base: import('@agentskillmania/wrangler').SandboxConfig | undefined,
  override: import('@agentskillmania/wrangler').SandboxConfig | boolean | undefined,
  workspacePath: string
): import('@agentskillmania/wrangler').SandboxConfig {
  const merged = mergeSandboxConfig(base, override);
  if (!merged.enabled) return merged;
  const { enabled: _enabled, instance: _instance, ...params } = merged;
  return {
    enabled: true,
    ...params,
    instance: new Sandbox({ sandboxDir: workspacePath, ...params }),
  };
}
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
   * Reads the full AgentState from state.json — includes thinking,
   * tool calls, and tool results (unlike the old session.jsonl format).
   */
  fastify.get('/api/chat/:sessionId/messages', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { sessionDir?: string };

    // Explicit sessionDir: read state.json directly. Missing state is a HARD
    // 404 so the client can distinguish "no session yet" from "unreadable"
    // (mirrors Rust chat_messages sessionDir path).
    if (query.sessionDir) {
      try {
        const raw = await readFile(join(query.sessionDir, 'state.json'), 'utf-8');
        const state = JSON.parse(raw) as { context?: { messages?: unknown[] } };
        return { messages: state.context?.messages ?? [] };
      } catch {
        reply.code(404);
        return { error: 'Session state not found' };
      }
    }

    // Standard tree: 200 empty when not found (mirrors Rust — NOT an error).
    const info = await sessionManager().getInfo(sessionId);
    if (!info) return { messages: [] };

    const store = sessionManager().getSessionStore(info.workspacePath);
    const state = await store.loadState(sessionId);
    return { messages: state?.context.messages ?? [] };
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

    // Daemon-level runner defaults (three-tier merge: body > agent > config.runner).
    const config = configManager().get();
    const rc = config.runner;

    // 搜索配置解析（供 search 字段与 web 工具注入工厂共用）
    const searchConfig =
      body.config?.search ??
      (config.search?.defaultProvider
        ? { provider: config.search.defaultProvider as 'sogou' | 'bing' }
        : undefined);

    const sessionOptions: AgentSessionOptions = {
      llmClientFactory: (providers) => LLMClient.quickInit({ providers }),
      workspacePath,
      agentName: agentDetail.name,
      agentInstructions: agentDetail.instructions,
      model: agentDetail.model,
      // skills.dirs: body > agent.skillDirs > config.runner.skillDirs > []
      skills: {
        dirs: [
          ...(body.config?.skills?.dirs ?? agentDetail.skillDirs ?? rc?.skillDirs ?? []),
          BUILTIN_SKILLS_DIR,
        ],
      },
      tools: {
        mcpConfigPaths:
          body.config?.tools?.mcpConfigPaths ?? agentDetail.mcpPaths ?? rc?.mcpConfigPaths ?? [],
        builtinFilter: body.config?.tools?.builtinFilter ?? rc?.tools?.builtinTools,
        // Node 专属 web 工具（jsdom 爬虫）——引擎 core 不含，由 daemon 组装注入
        injectFactory: (deps) => createWebTools({ deps, provider: searchConfig?.provider }),
        // MCP 加载器（引擎 core 不捆绑 MCP 加载）
        mcpLoader: (paths) => loadMCPTools({ configPaths: paths }),
      },
      sessionStore: body.sessionDir
        ? SessionStore.fromDir(body.sessionDir, defaultNodeHostEnv)
        : undefined,
      sessionManager: sessionManager(),
      sessionBaseDir: sessionManager().baseDir,
      agentConfigPath: agentDetail.path,
      // Feature toggles + groups: body > config.runner (two-tier for toggles)
      thinking: body.config?.thinking ?? rc?.thinking,
      session: body.config?.session ?? rc?.session,
      todolist: body.config?.todolist ?? rc?.todolist,
      specPlan: body.config?.specPlan ?? rc?.specPlan,
      commands: body.config?.commands ?? rc?.commands,
      // Node 专属：合并 sandbox 配置并构造实例（引擎 core 不捆绑 sandbox 运行时）
      sandbox: withSandboxInstance(config.sandbox, body.config?.sandbox, workspacePath),
      a2ui: body.config?.a2ui ?? rc?.a2ui,
      search: searchConfig,
      compression: (body.config?.compression ?? rc?.compression) as boolean | undefined,
      limits: body.config?.limits ?? rc?.limits,
    };

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

    // Explicit sessionDir ("notebook dir is the session") bypasses the
    // standard {root}/sessions tree: identity comes from the persisted
    // meta.yaml in that directory.
    let info: SessionMeta;
    let store: SessionStore;
    let sessionDir: string;
    if (body.sessionDir) {
      const meta = await readMeta(body.sessionDir, defaultNodeHostEnv);
      if (!meta) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }
      info = meta;
      store = SessionStore.fromDir(body.sessionDir, defaultNodeHostEnv);
      sessionDir = body.sessionDir;
    } else {
      const meta = await sessionManager().getInfo(sessionId);
      if (!meta) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }
      info = meta;
      store = sessionManager().getSessionStore(meta.workspacePath);
      sessionDir = store.getSessionDir(sessionId);
    }

    // Lazily resume AgentSession on first resume chat
    let agentSession = sessionManager().getAgentSession(sessionId);
    if (!agentSession) {
      const agentDetail = await resourceManager().getAgent(info.agentName);
      const config = configManager().get();

      // Crew session: if the persisted runnerConfig carried a crewId, reload
      // the crew config and rebuild subAgents so the delegate tool is wired
      // on resume. Non-crew sessions have no crewId → subAgents stays
      // undefined and behavior is unchanged.
      let resumeSubAgents: AgentSessionResumeOptions['subAgents'];
      const crewId = info.runnerConfig?.crewId;
      if (crewId) {
        try {
          const crewConfig = await resourceManager().loadCrewConfig(crewId);
          resumeSubAgents = crewToRunnerOptions(crewConfig).subAgents;
        } catch {
          // Crew was deleted between session creation and resume — proceed
          // without subAgents. The primary agent still runs; it just can't
          // delegate. Surface the situation in logs later if needed.
        }
      }

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
            subAgents: resumeSubAgents,
            llmClientFactory: (providers) => LLMClient.quickInit({ providers }),
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

  /**
   * POST /api/crews/:id/chat — NEW conversation driven by a crew config
   *
   * Loads CREW.md + agents/*.md via CrewLoader, converts to runner options
   * via crewToRunnerOptions (system prompt = crew memory + primary
   * instructions + sub-agent catalog; subAgents = non-primary agents;
   * enables the delegate tool), then constructs AgentSession the same way
   * the single-agent route does. crewId is persisted into runnerConfig so
   * the resume path can reload crew config.
   */
  fastify.post('/api/crews/:id/chat', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as CreateAndChatRequest;

    if (!body.message?.trim()) {
      reply.code(400).send({ error: 'message is required' });
      return;
    }

    if (!body.workspacePath?.trim()) {
      reply.code(400).send({ error: 'workspacePath is required' });
      return;
    }

    let crewConfig;
    try {
      crewConfig = await resourceManager().loadCrewConfig(id);
    } catch {
      reply.code(404).send({ error: 'Crew not found' });
      return;
    }

    const runnerOpts = crewToRunnerOptions(crewConfig);
    const workspacePath = body.workspacePath;

    // Daemon-level runner defaults (three-tier: body > crew > config.runner).
    const config = configManager().get();
    const rc = config.runner;

    // 搜索配置解析（供 search 字段与 web 工具注入工厂共用）
    const searchConfig =
      body.config?.search ??
      (config.search?.defaultProvider
        ? { provider: config.search.defaultProvider as 'sogou' | 'bing' }
        : undefined);

    const sessionOptions: AgentSessionOptions = {
      llmClientFactory: (providers) => LLMClient.quickInit({ providers }),
      workspacePath,
      agentName: runnerOpts.primaryAgent,
      agentInstructions: runnerOpts.systemPrompt,
      subAgents: runnerOpts.subAgents,
      crewId: id,
      model: body.model ?? runnerOpts.model,
      sandbox: body.config?.sandbox ?? true,
      skills: {
        dirs: [
          ...(body.config?.skills?.dirs ?? runnerOpts.skillDirs ?? rc?.skillDirs ?? []),
          BUILTIN_SKILLS_DIR,
        ],
      },
      tools: {
        mcpConfigPaths: body.config?.tools?.mcpConfigPaths ?? rc?.mcpConfigPaths ?? [],
        builtinFilter: body.config?.tools?.builtinFilter ?? rc?.tools?.builtinTools,
        // Node 专属 web 工具（jsdom 爬虫）——引擎 core 不含，由 daemon 组装注入
        injectFactory: (deps) => createWebTools({ deps, provider: searchConfig?.provider }),
        // MCP 加载器（引擎 core 不捆绑 MCP 加载）
        mcpLoader: (paths) => loadMCPTools({ configPaths: paths }),
      },
      sessionStore: body.sessionDir
        ? SessionStore.fromDir(body.sessionDir, defaultNodeHostEnv)
        : undefined,
      sessionManager: sessionManager(),
      sessionBaseDir: sessionManager().baseDir,
      thinking: body.config?.thinking ?? rc?.thinking,
      session: body.config?.session ?? rc?.session,
      todolist: body.config?.todolist ?? rc?.todolist,
      specPlan: body.config?.specPlan ?? rc?.specPlan,
      commands: body.config?.commands ?? rc?.commands,
      a2ui: body.config?.a2ui ?? rc?.a2ui,
      search: searchConfig,
      compression: (body.config?.compression ?? rc?.compression) as boolean | undefined,
      limits: body.config?.limits ?? rc?.limits,
    };

    const agentSession = await AgentSession.create(sessionOptions, config);
    const sessionId = agentSession.sessionId;

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
    const config = agentSession.getRunnerConfig();
    const startData = {
      sessionId: opts.sessionId,
      model: config.model,
      contextWindow: config.contextWindow,
      thinkingEnabled: config.thinkingEnabled,
      enablePromptThinking: config.enablePromptThinking,
      sandbox: config.sandbox,
      compression: { enabled: config.compressorEnabled },
      features: {
        session: config.enableSession,
        todolist: config.enableTodolist,
        specPlan: config.enableSpecPlan,
        commands: config.enableCommands,
        a2ui: config.a2ui?.enabled ?? false,
      },
      skillDirs: config.skillDirs,
      mcpConfigPaths: config.mcpConfigPaths,
    };
    writeSSE(reply, 'session-start', startData);
    agentSession.emitCockpitEvent({ event: 'session-start', data: startData });
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
