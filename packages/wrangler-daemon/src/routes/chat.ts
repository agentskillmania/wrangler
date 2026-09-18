import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Sandbox } from '@agentskillmania/sandbox';
import type { SessionMeta } from '@agentskillmania/wrangler';
import {
  SessionNotFoundError,
  SessionStore,
  createLLMClient,
  crewToRunnerOptions,
  readMeta,
  removePendingInterrupt,
  respond as hitlRespond,
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
  frameToSse,
} from '../core/agent-session.js';
import type {
  AgentSessionOptions,
  AgentSessionResumeOptions,
  HistoryEntry,
} from '../core/agent-session.js';
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
 * 都收(undefined = 请求未给)。与 Rust daemon 的 CompressionValue(untagged
 * 双形状)同语义;strategy/threshold/keepRecent 不在请求级暴露——属
 * config.yaml 的部署级配置(Rust 934d8ce 同款边界)。
 */
function normalizeCompression(v: boolean | { enabled?: boolean } | undefined):
  | {
      enabled?: boolean;
    }
  | undefined {
  return typeof v === 'boolean' ? { enabled: v } : v;
}

/**
 * 请求级 `{enabled}` 与 config.yaml 调优字段(strategy/threshold/keepRecent)
 * 的字段级合并(R2P-239,对齐 Rust 934d8ce 的 CompressionGroup 通路——
 * 此前 TS 在这里塌缩成布尔,调优字段根本到不了 colts DefaultContextCompressor,
 * 构造参数 threshold/strategy 白支持)。两边都未给、或合并后既无开关又无
 * 调优字段 = undefined(回落 runner 默认:开启 + summarize)。
 */
function resolveCompression(
  request: { enabled?: boolean } | undefined,
  config: import('../types.js').RunnerConfig['compression']
): AgentSessionOptions['compression'] {
  if (!request && !config) return undefined;
  const { enabled: _configEnabled, ...tuning } = config ?? {};
  const enabled = request?.enabled ?? config?.enabled;
  if (enabled === undefined && Object.keys(tuning).length === 0) return undefined;
  return { ...tuning, enabled };
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

/**
 * busy 消退宽限（R2P-163，对齐 Rust 76197b9/91c8ae5 的 10×10ms 轮询）。
 *
 * done 帧在 'complete' 事件处理器里同步入队，而 busy 闩在 runner.run()
 * 完全落定后的 finally 才释放——真实 colts runner 在发 'complete' 之后、
 * promise 决议之前还要 await afterRun 落盘。客户端收到 done 立刻续发是
 * 正常使用模式（E2E 多轮测试/快速追问），此窗口内的 busy 是误报：给
 * 100ms 轮询宽限，闩的消退（一次盘写）足够覆盖；真在飞的轮 100ms 后
 * 照常 409。message 闩模式不受影响——handleMessage 自身的 check-and-set
 * 仍零 await 原子。
 */
const BUSY_CLEAR_GRACE_ATTEMPTS = 10;
const BUSY_CLEAR_GRACE_INTERVAL_MS = 10;

/**
 * 常驻 events 流的僵尸看门狗周期（返修 P2-1）：会话对象被驱逐/替换后，
 * 挂在旧对象上的流收不到新帧也不会被关闭——周期校验注册表里的对象
 * 同一性，失配即发 session-evicted 帧并终结流。
 */
const EVENTS_STREAM_WATCHDOG_MS = 5000;

/** Wait (bounded) for the busy latch to clear. Returns the final busy state. */
async function busyCleared(session: AgentSession): Promise<boolean> {
  for (let i = 0; i < BUSY_CLEAR_GRACE_ATTEMPTS; i++) {
    if (!session.busy) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, BUSY_CLEAR_GRACE_INTERVAL_MS));
  }
  return !session.busy;
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
    // No cast: the wrangler-side colts-augmentation (imported via the
    // @agentskillmania/wrangler root) already declares `todoList` on
    // AgentContext — the hand cast duplicated it locally.
    const todoList = state?.context.todoList;
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
   * GET /api/chat/:sessionId/events — 会话级常驻事件流（R2P-151，对齐
   * Rust routes/chat/events.rs 的只读裁剪；返修补 history-end 分界帧与
   * 僵尸流看门狗）。
   *
   * 与请求级的发消息流（POST /api/chat/:id——轮结束即关）不同，这条流
   * 不随某一轮结束而关闭：建连先重放滚动历史里 `seq > lastSeq` 的帧
   * （断线期间的洞补上）+ 一帧 `history-end` 分界（data 带 firstSeq/
   * lastSeq，客户端比对识别裁头 gap 与驱逐重建复位），之后把会话通道
   * 上的全部帧按全序直播下去，只在客户端断开或会话被驱逐/替换时结束
   * （后者发一帧合成 `session-evicted` 再关——僵尸流终结）。没有流级
   * done 收尾——done 只是流上的一种事件。
   *
   * 重放门控在服务端做：`?lastSeq=N` 丢弃 seq≤N 的历史帧（客户端已
   * 见）；缺省 lastSeq=0（全量重放）。重放段与直播段同经 frameToSse
   * （seq 注入 data），wire 形状单源；直播侧再按已发 seq 去重一道，
   * 把「无重帧」做成服务端保证（滚动历史被安全阀裁头时重放起点后移，
   * 直播帧必大于全部重放帧，此守卫通常空转）。
   *
   * 滚动历史是内存态、随 AgentSession 对象生灭：驱逐/重建后新对象新
   * 通道，重放为空（历史随旧对象走——客户端应重读磁盘历史对账，对齐
   * Rust 的 bufferStartSeq 语义裁剪）。冷会话按 `?sessionDir=` 或标准
   * 树物化（订阅本身是活跃信号，与 resume/respond 同一装配路径+互斥）。
   * 只读观察：断开只退订，不 stop 会话。
   */
  fastify.get('/api/chat/:sessionId/events', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { sessionDir?: string; lastSeq?: string };

    let lastSeq = 0;
    if (query.lastSeq !== undefined) {
      const n = Number(query.lastSeq);
      if (!Number.isInteger(n) || n < 0) {
        reply.code(400).send({ error: 'lastSeq must be a non-negative integer' });
        return;
      }
      lastSeq = n;
    }

    // 挂流是高频入口，顺带做一次 TTL 驱逐（对齐 Rust chat_events 的
    // evict_idle()——闲置温会话的回收不依赖"有新会话插入"）。
    sessionManager().evictIdleSessions();

    console.error('[dbg-route] entry, warm=', sessionManager().getAgentSession(sessionId) !== null);
    // 温会话直接挂；冷会话物化（与 resume/respond 同一装配路径）。
    let agentSession = sessionManager().getAgentSession(sessionId);
    if (!agentSession) console.error('[dbg-route] COLD PATH taken');
    if (!agentSession) {
      const ctx = await resolveSessionContext(sessionId, query.sessionDir, {
        sessionManager: sessionManager(),
      });
      if (!ctx) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }
      if (!sessionManager().tryReserveAgentSession(sessionId)) {
        reply
          .code(409)
          .send(
            startingConflict('the session is being assembled from disk (cold start); retry shortly')
          );
        return;
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
          reply.code(410).send({ error: 'Session expired, please start a new conversation' });
          return;
        }
        throw error;
      } finally {
        if (rebuilt) {
          sessionManager().setAgentSession(sessionId, rebuilt);
        } else {
          sessionManager().cancelAgentSessionReservation(sessionId);
        }
      }
      agentSession = rebuilt;
      console.error('[dbg-route] rebuilt registered, active=', sessionManager().activeCount);
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // 头部即刻上线（flushHeaders）：writeHead 只备好头部、要等首次写入才
    // 随行发送——常驻流建连时滚动历史可能为空（驱逐后重建/全新会话），
    // 第一帧可能很久之后才来，不 flush 的话客户端 fetch 挂到首帧。
    reply.raw.flushHeaders();

    // 先订阅再拍历史，两者之间零 await（单线程 JS 上不可能插入发射）：
    // 建连之后才发生的帧走直播，之前的帧走重放——交界处既不漏帧，
    // forward 的 seq 守卫再把可能的重复压成零。
    let lastSentSeq = lastSeq;
    const forward = (entry: HistoryEntry): void => {
      if (entry.seq <= lastSentSeq) return;
      lastSentSeq = entry.seq;
      const wire = frameToSse(entry);
      writeSSE(reply, wire.event, wire.data);
    };
    const detach = agentSession.subscribe(forward);
    const history = agentSession.historySnapshot();
    // 空历史建连：SSE 注释行打底（与 flushHeaders 同点，代理掐断防御）——
    // 注释行不是帧，消费方的 SSE 解析器按规范跳过。
    if (history.length === 0) {
      reply.raw.write(': keep-alive\n\n');
    }
    for (const entry of history) {
      forward(entry);
    }
    // 重放段收尾分界帧（返修 P1）：客户端拿 firstSeq/lastSeq 与自己的
    // lastSeq 比对，即可识别两类失配——裁头 gap（firstSeq > 我的
    // lastSeq+1：保留窗前的帧被安全阀裁掉且我没见过）与驱逐重建复位
    // （lastSeq < 我的：seq 空间随新 AgentSession 重启）。空窗时 firstSeq
    // 退化为下一帧将取的 seq（对齐 Rust next_seq 分支）、lastSeq=0——全新
    // 会话上 firstSeq=1 与 lastSeq=0 自洽（0+1=1）。分界帧是合成帧、无
    // 自身 seq，不以 frameToSse 包装。
    writeSSE(reply, 'history-end', {
      firstSeq: history[0]?.seq ?? agentSession.nextFrameSeq(),
      lastSeq: history.at(-1)?.seq ?? 0,
    });

    // 僵尸流看门狗（返修 P2-1）：会话被驱逐/替换（注册表里不再是本流
    // 订阅的那个对象）后，本流既收不到新帧也不会被任何人关闭——纯漏。
    // 周期校验对象同一性，失配即发一帧合成 session-evicted（客户端拿到
    // 明确信号而非裸 EOF）并终结流。unref：看门狗不得阻止进程退出。
    const watchdog = setInterval(() => {
      if (sessionManager().getAgentSession(sessionId) !== agentSession) {
        writeSSE(reply, 'session-evicted', { sessionId });
        reply.raw.end();
      }
    }, EVENTS_STREAM_WATCHDOG_MS);
    watchdog.unref();
    // 断开即退订+停表（只读观察者，无 CONC5 停轮语义）。Listen on
    // reply.raw (the socket) — the request body is consumed by the time SSE
    // opens. 看门狗自杀终结同样经 end()→close 走到这里（单点清理）。
    reply.raw.on('close', () => {
      clearInterval(watchdog);
      detach();
    });
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
    // Optional chaining mirrors the sibling routes' `body.message?.trim()`
    // boundary pattern: a bodyless POST is a client mistake → 400, not a
    // TypeError dereferencing undefined → 500.
    const keepTurns = (request.body as { keepTurns?: unknown } | undefined)?.keepTurns;

    if (typeof keepTurns !== 'number' || !Number.isInteger(keepTurns) || keepTurns < 0) {
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
      const out = await agentSession.truncateTurns(statePath, keepTurns);
      if (!out.ok) {
        reply.code(out.code);
        // 闩锁内的复检撞上并发轮（路由 busy 检查与 latch 之间被插队）
        // 同样是 busy 分诊。detail 用固定解释文案——out.error 本身就是
        // 'Session is busy'，原样透传会让 detail 与 error 字段逐字重复。
        if (out.code === 409) {
          return busyConflict(
            'a run started between the busy check and the truncate latch; wait for it to finish or POST /stop, then retry'
          );
        }
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
      const out = await truncateStateFile(statePath, keepTurns);
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
      // afterRun persistence. Busy at first sight may be the done-frame
      // clearance window (R2P-163, align Rust 91c8ae5) — wait it out before
      // falling through; a genuinely running turn stays busy past the grace.
      if (!agentSession.busy || (await busyCleared(agentSession))) {
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
      llmClientFactory: createLLMClient,
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
      compression: resolveCompression(
        normalizeCompression(body.config?.compression),
        rc?.compression
      ),
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

    // Reject if session is already processing a message. A busy read right
    // after the previous turn's done frame is usually the clearance window
    // (busy latch released only after afterRun persistence settles) — wait
    // it out before rejecting (R2P-163, align Rust 76197b9).
    if (agentSession.busy && !(await busyCleared(agentSession))) {
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
      llmClientFactory: createLLMClient,
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
      compression: resolveCompression(
        normalizeCompression(body.config?.compression),
        rc?.compression
      ),
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
      // R2P-239：resume 现读 config.yaml 的压缩策略（调优字段不落 meta
      // 快照，对齐 Rust 934d8ce 的 merge_opt_opt——宿主现读优先于快照）。
      compression: resolveCompression(undefined, config.runner?.compression),
      // Node 专属：与 create 路径同款合并 + 实例构造（引擎 core 不捆绑 sandbox）。
      // override 取会话快照的 sandbox 开关（无快照值时默认 true，与 create 一致）
      sandbox: withSandboxInstance(
        config.sandbox,
        info.runnerConfig?.sandbox ?? true,
        info.workspacePath
      ),
      llmClientFactory: createLLMClient,
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
