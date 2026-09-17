import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { respond as hitlRespond, removePendingInterrupt } from '@agentskillmania/colts';
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

import {
  AgentSession,
  humanRequestPayloads,
  findPendingInterrupt,
  hitlResponseFromValue,
} from '../core/agent-session.js';
import type { AgentSessionOptions, AgentSessionResumeOptions } from '../core/agent-session.js';
import { mergeSandboxConfig } from '../core/sandbox-config.js';
import type {
  DecoratedFastifyInstance,
  AgentDetail,
  CreateAndChatRequest,
  ResumeChatRequest,
} from '../types.js';
import { writeSSE, truncateStateFile } from '../utils.js';

/**
 * 归一 `config.compression` 的请求形状:统一对象 `{enabled}` 与旧式裸布尔
 * 都收(undefined = 请求未给,回落 config.yaml 默认)。与 Rust daemon 的
 * CompressionValue(untagged 双形状)同语义;strategy 不在请求级暴露。
 */
function normalizeCompression(v: boolean | { enabled?: boolean } | undefined): boolean | undefined {
  return typeof v === 'boolean' ? v : v?.enabled;
}

/**
 * 409 分诊体（R2P-154a，对齐 Rust 32bf25f「说清在等什么」）：保留原
 * `error` 文案向后兼容，`reason`/`detail` 让客户端可编程分诊 ——
 * `busy` = 温会话在跑一轮（可 stop），`starting` = 冷装配占位中（重试
 * 即可）。
 */
function busyConflict(detail: string): { error: string; reason: 'busy'; detail: string } {
  return { error: 'Session is busy', reason: 'busy', detail };
}

/** starting 形态的 409 分诊体（冷会话装配占位中）。 */
function startingConflict(detail: string): { error: string; reason: 'starting'; detail: string } {
  return { error: 'Session is busy', reason: 'starting', detail };
}

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
  if (!merged.enabled) {
    // 禁用分支同样剥离 instance：请求体携带的伪实例不能绕过禁用
    // （instance 只能由本函数在 enabled 分支构造，不可来自 JSON）。
    const { instance: _instance, ...disabled } = merged;
    return disabled;
  }
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
   *
   * Also passes through the persisted todo snapshot (`context.todoList`,
   * immer-written by the todo middleware) as the top-level `todoList` field
   * — the data source for the frontend's inline todo card + sidebar on
   * resume (R2P-237, aligned with Rust 9b0c46d/dfa2105; TS keeps todo in
   * state.context rather than a sidecar). Old archives without the key omit
   * it — the frontend degrades on absence.
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
        const state = JSON.parse(raw) as {
          context?: { messages?: unknown[]; todoList?: unknown };
        };
        const body: { messages: unknown[]; todoList?: unknown } = {
          messages: state.context?.messages ?? [],
        };
        if (state.context?.todoList !== undefined) body.todoList = state.context.todoList;
        return body;
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
    const body: { messages: unknown[]; todoList?: unknown } = {
      messages: state?.context.messages ?? [],
    };
    const todoList = (state?.context as { todoList?: unknown } | undefined)?.todoList;
    if (todoList !== undefined) body.todoList = todoList;
    return body;
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
   * POST /api/chat/:sessionId/truncate — 按轮截断会话（R2P-154a，对齐
   * Rust 0a2cc4e 的 `POST /api/chat/:id/truncate`）。
   *
   * 编辑重发/重新生成/回退/Fork 四个前端动作共享的后端原语：把会话
   * `context.messages` 截到前 `keepTurns` 轮（轮 = 一条 user 消息开启；
   * 语义详见 wrangler `truncateStateTurns`）。body: `{ keepTurns }`，0 =
   * 清空 messages（编辑/重发首轮）。
   *
   * 会话寻址与 /messages 同款：`sessionDir` query 显式目录优先（「笔记目
   * 录即会话」），显式目录缺 state.json 是硬 404；标准树解析不到也 404。
   *
   * 活跃 run 409（带分诊字段）：温会话 busy → `reason: 'busy'`；冷会话
   * 装配占位 → `reason: 'starting'`。温会话的截断在 AgentSession 的
   * busy 闩锁临界区内完成并重载内存态（防「回魂」）；冷会话在占位闩锁
   * 下纯写盘（防与首次消息的装配竞态）。
   */
  fastify.post('/api/chat/:sessionId/truncate', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { sessionDir?: string };
    const body = request.body as { keepTurns?: unknown };

    if (
      typeof body.keepTurns !== 'number' ||
      !Number.isInteger(body.keepTurns) ||
      body.keepTurns < 0
    ) {
      reply.code(400);
      return { error: 'keepTurns must be a non-negative integer' };
    }

    // 显式会话目录优先，与 /messages 同一解析规则：显式目录缺 state.json
    // 是硬 404（路径解析先于 busy 判定，与 Rust 同序）；标准树扫描找不
    // 到也 404。
    let statePath: string;
    const explicitDir = query.sessionDir?.trim();
    if (explicitDir) {
      statePath = join(explicitDir, 'state.json');
      try {
        await stat(statePath);
      } catch {
        reply.code(404);
        return { error: 'Session state not found' };
      }
    } else {
      const ctx = await resolveSessionContext(sessionId, undefined, {
        sessionManager: sessionManager(),
      });
      if (!ctx) {
        reply.code(404);
        return { error: 'Session not found' };
      }
      statePath = join(ctx.sessionDir, 'state.json');
    }

    // 温会话：busy 409 分诊；闲时在 AgentSession 闩锁临界区内截断并重
    // 载内存态（截断后旧内存态会被下一轮 afterRun 落盘回滚）。
    const agentSession = sessionManager().getAgentSession(sessionId);
    if (agentSession) {
      if (agentSession.busy) {
        reply.code(409);
        return busyConflict(
          'a run is in progress on this session; wait for it to finish or POST /stop before truncating'
        );
      }
      const out = await agentSession.truncateTurns(statePath, body.keepTurns);
      if (!out.ok) {
        reply.code(out.code);
        // 闩锁内的复检撞上并发轮（路由 busy 检查与 latch 之间被插队）
        // 同样是 busy 分诊。
        if (out.code === 409) return busyConflict(out.error);
        return { error: out.error };
      }
      return { ok: true, kept: out.keptTurns };
    }

    // 冷会话：同步占位闩锁（与 resume 路由同款互斥）防装配竞态，纯写盘
    // （无内存态可同步）。
    if (!sessionManager().tryReserveAgentSession(sessionId)) {
      reply.code(409);
      return startingConflict(
        'the session is being assembled from disk (cold start); retry shortly'
      );
    }
    try {
      const out = await truncateStateFile(statePath, body.keepTurns);
      if (!out.ok) {
        reply.code(out.code);
        return { error: out.error };
      }
      return { ok: true, kept: out.keptTurns };
    } finally {
      sessionManager().cancelAgentSessionReservation(sessionId);
    }
  });

  /**
   * POST /api/chat/:sessionId/respond — respond to AskHuman
   *
   * Three tiers (R2P-165②, aligned with Rust 09b03af/9995668):
   *
   * 1. Warm session, parked bridge — resolve the in-memory pendingHumanInput
   *    promise; the parked run continues on its ORIGINAL chat stream.
   *    Memory-first: never touched by the tiers below.
   * 2. Warm session, state recovery — match against the session's IN-MEMORY
   *    state's pendingInterrupts (Rust 09b03af 温会话内存优先: memory is
   *    always ≥ disk), inject + persist. Remaining asks → {ok, waiting,
   *    interrupts}; emptied → hijack this response into the continuation
   *    SSE stream (resolved → run-resumed → continuation frames → done).
   * 3. Cold session (no active AgentSession) — load state from disk, match
   *    the persisted pendingInterrupts (tool-call id or question id), inject
   *    via colts respond(), remove, save; emptied → rebuild the session
   *    (AgentSession.resume) and stream the continuation (Rust 9995668).
   */
  fastify.post('/api/chat/:sessionId/respond', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { sessionDir?: string };
    const body = request.body as { requestId?: string; response?: unknown };

    if (!body.requestId) {
      return { error: 'requestId is required' };
    }

    const agentSession = sessionManager().getAgentSession(sessionId);
    if (agentSession) {
      // Tier 1 — parked bridge promise (memory-first, unchanged semantics).
      if (agentSession.respondHumanInput(body.requestId, body.response)) {
        return { ok: true };
      }
      // Tier 2 — in-memory state. Only when idle: injecting into a busy
      // session's pre-run snapshot would be rolled back by that run's
      // afterRun persistence.
      if (!agentSession.busy) {
        const outcome = await agentSession.respondViaState(body.requestId, body.response);
        if (outcome.status === 'invalid') {
          reply.code(400);
          return { error: outcome.error };
        }
        if (outcome.status === 'answered') {
          if (outcome.remaining.length > 0) {
            return {
              ok: true,
              waiting: true,
              interrupts: humanRequestPayloads(outcome.remaining),
            };
          }
          return streamRespondContinuation(reply, agentSession, {
            requestId: body.requestId,
            response: body.response,
            sessionId,
            sessionManager: sessionManager(),
          });
        }
      }
      return { error: 'Request not found or already answered' };
    }

    // Tier 3 — cold session: recover from the persisted pendingInterrupts.
    const ctx = await resolveSessionContext(sessionId, query.sessionDir, {
      sessionManager: sessionManager(),
    });
    if (!ctx) {
      reply.code(404);
      return { error: 'Session not found' };
    }
    const stateKey = ctx.store.isDirBound ? undefined : sessionId;
    const state = await ctx.store.loadState(stateKey);
    if (!state) {
      reply.code(404);
      return { error: 'Session state not found' };
    }
    const pending = findPendingInterrupt(state, body.requestId);
    if (!pending) {
      // Explicit guidance (the sanctioned cold fallback): the session is not
      // active and nothing on disk matches — tell the caller how to proceed
      // instead of a bare "not found".
      reply.code(404);
      return {
        error:
          'No pending human request matches this requestId. ' +
          'The session is not active — send a message first to activate it, then answer the re-surfaced request.',
      };
    }
    const converted = hitlResponseFromValue(pending.request, body.response);
    if (!converted.ok) {
      // Boundary validation (garbage in → 400 out, before any injection
      // mutates the persisted state).
      reply.code(400);
      return { error: converted.error };
    }
    let next = hitlRespond(state, pending.request, converted.response);
    next = removePendingInterrupt(next, pending.request.toolCallId);
    await ctx.store.saveState(stateKey, next);
    const remaining = (next.context.pendingInterrupts ?? []).map((p) => p.request);
    if (remaining.length > 0) {
      // Parallel double-ask, partially answered: report what is still open
      // (Rust 9995668's {ok, waiting, interrupts} shape).
      return { ok: true, waiting: true, interrupts: humanRequestPayloads(remaining) };
    }

    // All answered — rebuild the session from disk and stream the
    // continuation as this response (Rust rebuild_active_run + 续跑).
    if (!sessionManager().tryReserveAgentSession(sessionId)) {
      reply.code(409);
      return startingConflict(
        'the session is being assembled from disk (cold start); retry shortly'
      );
    }
    let rebuilt: AgentSession | null = null;
    try {
      rebuilt = await assembleResumeSession(
        sessionId,
        {
          sessionManager: sessionManager(),
          configManager: configManager(),
          resourceManager: resourceManager(),
        },
        ctx
      );
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        reply.code(410);
        return { error: 'Session expired, please start a new conversation' };
      }
      throw error;
    } finally {
      if (rebuilt) {
        sessionManager().setAgentSession(sessionId, rebuilt);
      } else {
        sessionManager().cancelAgentSessionReservation(sessionId);
      }
    }
    return streamRespondContinuation(reply, rebuilt, {
      requestId: body.requestId,
      response: body.response,
      sessionId,
      sessionManager: sessionManager(),
    });
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

    // Inline agent block replaces the agent file (host-owned persona;
    // agents/*.md is only the standalone-daemon assembly source).
    const agentDetail: AgentDetail | null = body.agent
      ? {
          id: name,
          name: body.agent.name ?? name,
          instructions: body.agent.instructions,
          path: '',
          skillDirs: [],
          mcpPaths: [],
          skillCount: 0,
        }
      : await resourceManager().getAgent(name);
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
      runtime: defaultNodeHostEnv,
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
        // 替换语义:内联 mcpServers 给了 → 路径轴(agent/config.runner 回退)整体旁路
        mcpConfigPaths: body.config?.tools?.mcpServers
          ? []
          : (body.config?.tools?.mcpConfigPaths ??
            agentDetail.mcpPaths ??
            rc?.mcpConfigPaths ??
            []),
        builtinFilter: body.config?.tools?.builtinFilter ?? rc?.tools?.builtinTools,
        // Node 专属 web 工具（jsdom 爬虫）——引擎 core 不含，由 daemon 组装注入
        injectFactory: (deps) => createWebTools({ deps, provider: searchConfig?.provider }),
        // MCP 加载器（引擎 core 不捆绑 MCP 加载）
        mcpLoader: (paths) =>
          loadMCPTools(
            body.config?.tools?.mcpServers
              ? { servers: body.config.tools.mcpServers }
              : { configPaths: paths }
          ),
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
      compression: normalizeCompression(body.config?.compression) ?? rc?.compression?.enabled,
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
    const ctx = await resolveSessionContext(sessionId, body.sessionDir, {
      sessionManager: sessionManager(),
    });
    if (!ctx) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    const { info, store, sessionDir } = ctx;

    // Lazily resume AgentSession on first resume chat.
    //
    // R2P-161（对齐 Rust 32e79ce/098adbd 地基C）：冷路径 create 竞态。
    // 判空与占位之间零 await——两个并发首条消息（双击发送/前端重试）
    // 只有一个能拿到装配槽，另一个同步吃 409；否则各自 await
    // AgentSession.resume 后互相覆盖注册（孤儿 runner/LLM client 泄漏 +
    // 同目录双重落盘）。
    let agentSession = sessionManager().getAgentSession(sessionId);
    if (!agentSession) {
      if (!sessionManager().tryReserveAgentSession(sessionId)) {
        // Slot already taken: another request is assembling this session
        // (or it just became active) — same mutual-exclusion semantics as
        // the busy check below.
        reply
          .code(409)
          .send(
            startingConflict('the session is being assembled from disk (cold start); retry shortly')
          );
        return;
      }
      try {
        try {
          agentSession = await assembleResumeSession(
            sessionId,
            {
              sessionManager: sessionManager(),
              configManager: configManager(),
              resourceManager: resourceManager(),
            },
            { info, store, sessionDir }
          );
        } catch (error) {
          if (error instanceof SessionNotFoundError) {
            reply.code(410).send({ error: 'Session expired, please start a new conversation' });
            return;
          }
          throw error;
        }
      } finally {
        // 成功：setAgentSession 结算占位并发布真身；失败（含 410/throw）：
        // 清除占位，槽位不卡死——后续请求可重试装配。
        if (agentSession) {
          sessionManager().setAgentSession(sessionId, agentSession);
        } else {
          sessionManager().cancelAgentSessionReservation(sessionId);
        }
      }
    }

    // Reject if session is already processing a message
    if (agentSession.busy) {
      reply
        .code(409)
        .send(
          busyConflict(
            'a run is in progress on this session; wait for it to finish or POST /stop before sending'
          )
        );
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
      runtime: defaultNodeHostEnv,
      llmClientFactory: (providers) => LLMClient.quickInit({ providers }),
      workspacePath,
      agentName: runnerOpts.primaryAgent,
      agentInstructions: runnerOpts.systemPrompt,
      subAgents: runnerOpts.subAgents,
      crewId: id,
      model: body.model ?? runnerOpts.model,
      // Node 专属：合并 sandbox 配置并构造实例（引擎 core 不捆绑 sandbox 运行时）
      sandbox: withSandboxInstance(config.sandbox, body.config?.sandbox ?? true, workspacePath),
      skills: {
        dirs: [
          ...(body.config?.skills?.dirs ?? runnerOpts.skillDirs ?? rc?.skillDirs ?? []),
          BUILTIN_SKILLS_DIR,
        ],
      },
      tools: {
        // 替换语义:内联 mcpServers 给了 → 路径轴旁路(镜像 Rust 契约)
        mcpConfigPaths: body.config?.tools?.mcpServers
          ? []
          : (body.config?.tools?.mcpConfigPaths ?? rc?.mcpConfigPaths ?? []),
        builtinFilter: body.config?.tools?.builtinFilter ?? rc?.tools?.builtinTools,
        // Node 专属 web 工具（jsdom 爬虫）——引擎 core 不含，由 daemon 组装注入
        injectFactory: (deps) => createWebTools({ deps, provider: searchConfig?.provider }),
        // MCP 加载器（引擎 core 不捆绑 MCP 加载）
        mcpLoader: (paths) =>
          loadMCPTools(
            body.config?.tools?.mcpServers
              ? { servers: body.config.tools.mcpServers }
              : { configPaths: paths }
          ),
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
      compression: normalizeCompression(body.config?.compression) ?? rc?.compression?.enabled,
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

/**
 * Resolve a session's meta/store/dir from id-or-dir addressing (R2P-165②).
 *
 * An explicit `sessionDir` ("notebook dir is the session") bypasses the
 * standard {root}/sessions tree — identity comes from the persisted meta.yaml
 * in that directory. Returns null when the session cannot be resolved (callers
 * map that to 404). Shared by the resume-chat route and the respond route's
 * cold tier.
 */
async function resolveSessionContext(
  sessionId: string,
  sessionDir: string | undefined,
  deps: { sessionManager: DecoratedFastifyInstance['sessionManager'] }
): Promise<{ info: SessionMeta; store: SessionStore; sessionDir: string } | null> {
  if (sessionDir) {
    const meta = await readMeta(sessionDir, defaultNodeHostEnv);
    if (!meta) return null;
    return { info: meta, store: SessionStore.fromDir(sessionDir, defaultNodeHostEnv), sessionDir };
  }
  const meta = await deps.sessionManager.getInfo(sessionId);
  if (!meta) return null;
  const store = deps.sessionManager.getSessionStore(meta.workspacePath);
  return { info: meta, store, sessionDir: store.getSessionDir(sessionId) };
}

/**
 * Assemble a resumed AgentSession from a resolved session context — the
 * rebuild path shared by the resume-chat route and the respond route's cold
 * tier (R2P-165②, the TS counterpart of Rust 9995668's rebuild_active_run).
 * The route's sessionId (not info.id) keys the session so registration and
 * AgentSession.sessionId agree. Throws SessionNotFoundError when the on-disk
 * session has expired; the caller maps it.
 */
async function assembleResumeSession(
  sessionId: string,
  deps: {
    sessionManager: DecoratedFastifyInstance['sessionManager'];
    configManager: DecoratedFastifyInstance['configManager'];
    resourceManager: DecoratedFastifyInstance['resourceManager'];
  },
  ctx: { info: SessionMeta; store: SessionStore; sessionDir: string }
): Promise<AgentSession> {
  const { info, store, sessionDir } = ctx;
  const agentDetail = await deps.resourceManager.getAgent(info.agentName);
  const config = deps.configManager.get();

  // Crew session: if the persisted runnerConfig carried a crewId, reload
  // the crew config and rebuild subAgents so the delegate tool is wired
  // on resume. Non-crew sessions have no crewId → subAgents stays
  // undefined and behavior is unchanged.
  let resumeSubAgents: AgentSessionResumeOptions['subAgents'];
  const crewId = info.runnerConfig?.crewId;
  if (crewId) {
    try {
      const crewConfig = await deps.resourceManager.loadCrewConfig(crewId);
      resumeSubAgents = crewToRunnerOptions(crewConfig).subAgents;
    } catch {
      // Crew was deleted between session creation and resume — proceed
      // without subAgents. The primary agent still runs; it just can't
      // delegate. Surface the situation in logs later if needed.
    }
  }

  return AgentSession.resume(
    sessionDir,
    {
      sessionId,
      workspacePath: info.workspacePath,
      agentName: info.agentName,
      agentConfigPath: agentDetail?.path,
      sessionStore: store,
      sessionManager: deps.sessionManager,
      runtime: defaultNodeHostEnv,
      subAgents: resumeSubAgents,
      // Node 专属：与 create 路径同款合并 + 实例构造（引擎 core 不捆绑 sandbox）。
      // override 取会话快照的 sandbox 开关（无快照值时默认 true，与 create 一致）
      sandbox: withSandboxInstance(
        config.sandbox,
        info.runnerConfig?.sandbox ?? true,
        info.workspacePath
      ),
      llmClientFactory: (providers) => LLMClient.quickInit({ providers }),
    },
    config
  );
}

/**
 * Stream the post-respond continuation as THIS response (R2P-165②, aligned
 * with Rust 9995668's "响应即续跑 SSE 流"): the waiting run's original chat
 * stream already closed (waiting-human is a run terminal), so the resolved
 * acknowledgement and the resumed turn both live on the respond response.
 *
 * Wire sequence (matches skill-ui's pinned reducer contract):
 *   human-input-resolved → run-resumed → continuation frames → done.
 * CON5 disconnect handling mirrors streamAgentSession.
 */
async function streamRespondContinuation(
  reply: FastifyReply,
  agentSession: AgentSession,
  opts: {
    requestId: string;
    response: unknown;
    sessionId: string;
    sessionManager: DecoratedFastifyInstance['sessionManager'];
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

  const resolvedData = { requestId: opts.requestId, response: opts.response };
  writeSSE(reply, 'human-input-resolved', resolvedData);
  agentSession.emitCockpitEvent({ event: 'human-input-resolved', data: resolvedData });
  // Host-synthesized latch reopener: the waiting done closed the turn on the
  // client — continuation tokens must not be dropped as out-of-turn noise.
  writeSSE(reply, 'run-resumed', {});
  agentSession.emitCockpitEvent({ event: 'run-resumed', data: {} });

  opts.sessionManager.updateStatus(opts.sessionId, 'running');
  try {
    for await (const sse of agentSession.continueRun()) {
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
