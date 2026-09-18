/**
 * AgentSession — wraps wrangler EnhancedRunner with SSE streaming and AskHuman bridging.
 *
 * Full lifecycle: create -> handleMessage (streaming) -> stop.
 * Bridges colts AskHuman tool -> SSE -> frontend for human-in-the-loop interaction.
 */

// R2P-201：daemon 生产代码零 colts/llm-client 直驱——内核状态/HITL/runner
// 词汇全部经 @agentskillmania/wrangler 定向再导出触达。
import {
  EnhancedRunner,
  SessionStore,
  createAgentState,
  addUserMessage,
  updateState,
  deserializeState,
  FilesystemSkillProvider,
  removePendingInterrupt,
  resolveDefaultModel,
  respond as hitlRespond,
} from '@agentskillmania/wrangler';
import type {
  AgentState,
  RunStreamEvent,
  RunOptions,
  RunnerEventMap,
  HumanRequest,
  HumanAnswer,
  HitlHumanResponse,
  PendingInterrupt,
  AskHumanHandler,
  HumanResponse,
  HostEnv,
  ILLMProvider,
  ISkillProvider,
  LLMProviderEntry,
  LimitsConfig,
  ResolvedRunnerConfig,
  SandboxConfig,
  SubAgentConfig,
  Tool,
} from '@agentskillmania/wrangler';

import type { SSEEvent, DaemonConfig } from '../types.js';
import { truncateStateFile } from '../utils.js';
import { mergeSandboxConfig } from './sandbox-config.js';
import type { SessionOverview, SessionInfo, SessionStatus } from './session-diagnostics.js';
import type { RunnerFeatureFlags } from './session-diagnostics.js';

// Register the Node SkillFsOps implementation once at daemon startup
// (daemon.ts → wrangler ensureNodeSkillFsOps) so any
// FilesystemSkillProvider constructed here (or elsewhere in the daemon)
// resolves node:fs via the global registration point. Idempotent.

/**
 * Bridge between AskHumanHandler closure and AgentSession instance.
 * The handler is created before the session exists, so this object
 * serves as a mutable indirection layer.
 */
interface AskHumanBridge {
  sseSender: ((event: SSEEvent) => void) | null;
  /**
   * Multiple concurrent cockpit observers. Each long-lived SSE connection
   * registers a sender and unregisters on disconnect, so several clients
   * (refresh, multi-tab) can observe the same session without overwriting
   * each other.
   */
  cockpitSenders: Set<(event: SSEEvent) => void>;
  pendingHumanInput: Map<
    string,
    { resolve: (value: HumanResponse) => void; reject: (reason?: unknown) => void }
  >;
}

/** Options for resuming an AgentSession from disk */
export interface AgentSessionResumeOptions {
  sessionId: string;
  workspacePath: string;
  agentName: string;
  agentInstructions?: string;
  agentConfigPath?: string;
  sessionStore?: SessionStore;
  sessionManager?: SessionManagerRef;
  /** HostEnv — injected into EnhancedRunner.resume. Node host: defaultNodeHostEnv. */
  runtime?: HostEnv;
  /** Sub-agent configs to rebuild crew delegation on resume */
  subAgents?: SubAgentConfig[];
  /** Sandbox config with host-constructed instance (Node 宿主职责，镜像 create 路径) */
  sandbox?: import('@agentskillmania/wrangler').SandboxConfig;
  /**
   * Compression policy read fresh from config.yaml (R2P-239, mirrors Rust
   * 934d8ce: tuning is NOT restored from session meta — the route re-reads
   * config on every resume). Wins over the meta snapshot's enabled flag.
   */
  compression?: AgentSessionOptions['compression'];
  /** quickInit 创建器（Node 宿主传 wrangler createLLMClient）——daemon core 不捆绑内置 LLM */
  llmClientFactory?: (providers: LLMProviderEntry[]) => ILLMProvider;
}

/** Options for creating an AgentSession */
export interface AgentSessionOptions {
  sessionId?: string;
  /** HostEnv — injected into EnhancedRunner. Browser extensions pass BrowserHostEnv; omit for Node. */
  runtime?: HostEnv;
  /**
   * LLM provider injection — browser extensions pass FetchLlmProvider.
   * Omit for Node (uses createLLMClient with pi-ai).
   */
  llmClient?: ILLMProvider;
  /** quickInit 创建器（Node 宿主传 wrangler createLLMClient）——daemon core 不捆绑内置 LLM */
  llmClientFactory?: (providers: LLMProviderEntry[]) => ILLMProvider;
  workspacePath: string;
  agentName: string;
  agentInstructions?: string;
  model?: string;
  sessionBaseDir?: string;
  sessionStore?: SessionStore;
  /** SessionManager instance for reading runtime status + idle-TTL activity touch (R2P-121). */
  sessionManager?: SessionManagerRef;
  /** Agent definition file path. */
  agentConfigPath?: string;
  // Structured EnhancedRunner option groups (see EnhancedRunnerOptions)
  skills?: {
    dirs?: string[];
    /** External skill provider — BundledSkillProvider for extensions. */
    provider?: ISkillProvider;
  };
  tools?: {
    mcpConfigPaths?: string[];
    /** MCP 工具加载器（透传 EnhancedRunner.tools.mcpLoader） */
    mcpLoader?: (paths: string[]) => Promise<Tool<import('zod').ZodTypeAny>[]>;
    /** 宿主注入工具（透传 EnhancedRunner.tools.inject） */
    inject?: Tool<import('zod').ZodTypeAny>[];
    /** 宿主注入工具工厂（透传 EnhancedRunner.tools.injectFactory，引擎传解析后的 ToolDeps） */
    injectFactory?: (
      deps: import('@agentskillmania/wrangler').ToolDeps
    ) => Tool<import('zod').ZodTypeAny>[];
    builtinFilter?: Record<string, boolean>;
    /** External ToolDeps injection — BrowserToolDeps for extensions. */
    deps?: import('@agentskillmania/wrangler').ToolDeps;
  };
  session?: { enabled?: boolean };
  todolist?: { enabled?: boolean };
  specPlan?: { enabled?: boolean };
  commands?: { enabled?: boolean };
  /** Sandbox config: boolean (legacy) or full execution-parameter object. */
  sandbox?: boolean | SandboxConfig;
  thinking?: { enabled?: boolean; promptLevel?: boolean };
  a2ui?: { enabled?: boolean };
  search?: { provider?: 'sogou' | 'bing' };
  /**
   * Compression policy (R2P-239). The daemon merges the request-level
   * `{enabled}` with config.yaml tuning fields before handing it here;
   * EnhancedRunner receives `false` (off) or the tuning subset
   * (strategy/threshold/keepRecent — colts DefaultContextCompressor
   * constructor params). Legacy bare boolean still accepted.
   */
  compression?:
    | boolean
    | {
        enabled?: boolean;
        strategy?: 'summarize' | 'truncate';
        threshold?: number;
        keepRecent?: number;
      };
  /** Sub-agent configs — enables the 'delegate' tool for crew delegation */
  subAgents?: SubAgentConfig[];
  /** Crew identifier — persisted into runnerConfig snapshot so resume can reload crew config */
  crewId?: string;
  /** Execution limits (maxInputLength, maxSteps, requestTimeout, maxToolOutput, toolTimeout) */
  limits?: LimitsConfig;
}

/** Default agent instructions when none provided */
const DEFAULT_INSTRUCTIONS = `You are a capable AI assistant. You can:
1. Read and write workspace files (file_* tools)
2. Search the internet for information (web_search tool)
3. Execute shell commands (shell tool)
4. Load skills for complex tasks (load_skill tool)
5. Ask the user questions when uncertain (ask_human tool)
6. Manage task lists (todo_* tools)

Please respond in the same language as the user's message.`;

/**
 * SessionManager 视图（AgentSession 依赖的窄接口）：运行状态查询 +
 * 闲置 TTL 活动触碰（R2P-121，对齐 Rust Session::touch 只在轮驱动入口
 * 调用）。touchAgentSession 可选——旧宿主/测试桩只给 getStatus 也能跑。
 */
export interface SessionManagerRef {
  getStatus(id: string): string;
  touchAgentSession?(id: string): void;
}

/**
 * Single agent session backed by wrangler EnhancedRunner.
 *
 * Wraps colts AgentRunner through wrangler's EnhancedRunner for full
 * tool/skill/session support. Streams SSE events to the frontend and
 * bridges AskHuman tool calls to interactive UI prompts.
 */
export { mergeSandboxConfig } from './sandbox-config.js';

// ─── HITL wire helpers（R2P-165，镜像 Rust wrangler::hitl 门面）──────────
//
// 未答中断的 wire 形状单源：human-input 帧、waiting-human done 帧的
// requests 数组、respond 路由的 interrupts 清单共用 humanRequestPayloads
// （对齐 Rust `interrupt_payloads`——前端一套解析器）。

/**
 * Serialize human requests into the `human-input` frame payload shape.
 *
 * Question requests → {requestId, questions, context}; tool-confirm →
 * {requestId, confirm:{toolName, arguments}}. Used for the additive
 * `requests` full-list field (waiting-human done frame, respond route's
 * remaining-interrupt payloads) so array consumers see the same shape the
 * single-request fields have always used.
 */
export function humanRequestPayloads(
  requests: HumanRequest[]
): Array<{ requestId: string; questions?: unknown; context?: unknown; confirm?: unknown }> {
  return requests.map((r) =>
    r.type === 'question'
      ? { requestId: r.toolCallId, questions: r.questions, context: r.context }
      : { requestId: r.toolCallId, confirm: { toolName: r.toolName, arguments: r.args } }
  );
}

/**
 * Find an unanswered interrupt by request id: tool-call id or any question id
 * matches (the frontend answers question-type requests by question id).
 * Mirrors Rust `find_pending_interrupt` dual matching.
 */
export function findPendingInterrupt(
  state: AgentState,
  requestId: string
): PendingInterrupt | undefined {
  return (state.context.pendingInterrupts ?? []).find(
    (p) =>
      p.request.toolCallId === requestId ||
      (p.request.type === 'question' && p.request.questions.some((q) => q.id === requestId))
  );
}

/**
 * Convert a respond-route JSON body into the typed hitl HumanResponse.
 *
 * Question answers are validated at the boundary (garbage in → 400 out,
 * before any injection mutates state): the payload must be an answers map
 * `{[questionId]: {type: 'direct' | 'free-text', value}}` — non-objects and
 * entries missing (or with an unknown) `type` are rejected with a diagnosable
 * message instead of being serialized into the tool result the LLM reads.
 * Tool-confirm stays lenient like Rust `response_from_value`: `approved`
 * absent → rejection (false).
 */
export function hitlResponseFromValue(
  request: HumanRequest,
  value: unknown
): { ok: true; response: HitlHumanResponse } | { ok: false; error: string } {
  if (request.type === 'tool-confirm') {
    const v = (typeof value === 'object' && value !== null ? value : {}) as {
      approved?: unknown;
    };
    return { ok: true, response: { type: 'tool-confirm', approved: v.approved === true } };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      error: `Invalid question response: expected an answers object keyed by question id, got ${JSON.stringify(
        value
      )?.slice(0, 80)}`,
    };
  }
  for (const [qid, answer] of Object.entries(value)) {
    const type = (answer as { type?: unknown } | null)?.type;
    if (type !== 'direct' && type !== 'free-text') {
      return {
        ok: false,
        error: `Invalid answer for question '${qid}': expected {type: 'direct' | 'free-text', value}, got ${JSON.stringify(
          answer
        )?.slice(0, 80)}`,
      };
    }
  }
  return {
    ok: true,
    response: { type: 'question', answers: value as Record<string, HumanAnswer> },
  };
}

/**
 * Translate the daemon-level compression policy into the EnhancedRunner input
 * (R2P-239): `false` / `{enabled:false}` → false (off); everything else → the
 * tuning subset (strategy/threshold/keepRecent) the colts
 * DefaultContextCompressor constructor consumes; absent tuning → undefined
 * (runner default: enabled, strategy summarize — Rust 934d8ce's usable
 * default). `enabled: true` is dropped: it is the runner's default already.
 */
function toRunnerCompression(
  v: AgentSessionOptions['compression']
):
  | false
  | undefined
  | { strategy?: 'summarize' | 'truncate'; threshold?: number; keepRecent?: number } {
  if (v === false || (typeof v === 'object' && v !== null && v.enabled === false)) {
    return false;
  }
  if (v === undefined || v === true) {
    return undefined;
  }
  const { enabled: _enabled, ...tuning } = v;
  return tuning;
}

// ─── 会话级事件通道（R2P-122，P2-b seq 的结构前提）─────────────────────
//
// 对齐 Rust session/live.rs：会话拥有自己的事件通道，run 帧（轮内从
// runner 事件映射而来）与人类输入桥的帧经 pushEvent 汇入——「先落史后
// 广播，落下的史就是广播的帧」（同一 seq 空间）。R2P-151 起 seq 随
// frameToSse 注入 data 上 SSE 线协议（重连去重/补洞的依据），常驻
// events 流（routes/chat.ts）与每请求的 chat 流共用该入口。

/**
 * 一条会话事件通道的历史帧（对齐 Rust session/live.rs 的 HistoryFrame）。
 * seq 是会话内单调全序，断线重连按它去重（≤ 已见）与补洞（> 已见）。
 */
export interface HistoryEntry {
  seq: number;
  event: string;
  data: unknown;
}

/**
 * 滚动历史的安全阀（对齐 Rust HISTORY_CAP = 500_000）：防内存失控的
 * 保险丝，正常会话到不了——超上限丢最旧。
 */
export const HISTORY_CAP = 500_000;

/**
 * 把一条会话通道的历史帧包成 SSE wire 帧（R2P-151，对齐 Rust
 * core/sse.rs 的 `frame_to_sse`）：把 seq 注入 data 对象——重放段与
 * 直播段同用这一个入口，wire 形状单源，客户端按 `data.seq` 去重
 * （≤ 已见）/补洞（> 已见）。timestamp 已在 runner 事件 handler 落帧
 * 时注入（注入时点与 Rust 不同、wire 形状相同）；非对象 data 保持
 * 原样（对齐 Rust `as_object_mut` 守卫——seq 只进对象）。
 */
export function frameToSse(frame: HistoryEntry): SSEEvent {
  const data =
    typeof frame.data === 'object' && frame.data !== null && !Array.isArray(frame.data)
      ? { ...(frame.data as Record<string, unknown>), seq: frame.seq }
      : frame.data;
  return { event: frame.event, data };
}

export class AgentSession {
  readonly sessionId: string;
  readonly workspacePath: string;
  readonly agentName: string;
  readonly model: string;
  private runner: EnhancedRunner;
  private state: AgentState;
  /** LLM provider — 默认 LLMClient（pi-ai），浏览器注入 FetchLlmProvider */
  private _llmClient!: ILLMProvider;
  private abortController: AbortController | null = null;
  private bridge: AskHumanBridge;
  private sessionStore: SessionStore | undefined;
  private readonly sessionManager?: SessionManagerRef;
  private readonly agentConfigPath?: string;
  private _busy = false;
  /** Max input length in characters, enforced in handleMessage. */
  private readonly maxInputLength?: number;
  /** Latest LLM request captured from llm:request stream events */
  private lastLLMRequest: {
    messages: unknown[];
    tools?: unknown[];
    skill?: string;
    model?: string;
    contextWindow?: number;
  } | null = null;
  /** Full system prompt extracted from first message of llm-request */
  private lastSystemPrompt: string | null = null;

  /** Async event queue for streaming */
  private eventQueue: SSEEvent[] = [];
  private eventWaiters: Array<(event: SSEEvent | null) => void> = [];
  /** Event history for cockpit replay — new connections receive full sequence */
  private eventHistory: SSEEvent[] = [];
  private readonly MAX_HISTORY = 500;
  // ─── 会话级事件通道（R2P-122）───
  /** 滚动历史（会话内存态，随对象生灭——驱逐即失，盘回放是 P2-b） */
  private readonly history: HistoryEntry[] = [];
  /** 通道订阅者（每请求一流在这里 attach；退订即摘除） */
  private readonly channelSubscribers = new Set<(entry: HistoryEntry) => void>();
  /** 帧序号分配器（会话内单调递增，pushEvent 唯一分配点；对齐 Rust frame_seq） */
  private frameSeq = 0;
  /**
   * 轮次编号（R2P-152，对齐 Rust 1b24852 的 turn_seq/current_turn）：每次
   * driveTurn 开跑 +1，本驱动的 done 帧经 pushEvent 注入此值——等待方按
   * 值精确归属（消费轮的 done 不误满足用户轮）。busy 拒绝路径不进
   * driveTurn，不耗号（跳号允许，单调性才是契约）。单线程 JS 无并发
   * 驱动（busy 闩锁），Rust 的分配器/当前值双字段在此塌缩为一个计数器。
   */
  private turnSeq = 0;

  private constructor(
    runner: EnhancedRunner,
    state: AgentState,
    bridge: AskHumanBridge,
    options: AgentSessionOptions
  ) {
    this.runner = runner;
    this.state = state;
    this.bridge = bridge;
    this.sessionStore = options.sessionStore;
    this.sessionManager = options.sessionManager;
    this.agentConfigPath = options.agentConfigPath;
    this.sessionId = options.sessionId ?? state.id;
    this.workspacePath = options.workspacePath;
    this.agentName = options.agentName;
    this.model = runner.getConfig().model;
    this.maxInputLength = options.limits?.maxInputLength;
    // session-title 接线（R2P-232，对齐 Rust 2287cc1 的 set_naming_event_sink
    // + Weak 闭包 sink）：命名中间件 Phase-2 LLM 改题成功（先落盘）后经晚
    // 绑定槽通知本会话。帧走 cockpit 通道（广播 + 滚动历史），与 Rust 经
    // 会话通道 emit（落史+序号+广播）同构——主轮 done 与标题 LLM 完成时序
    // 不定，帧可能晚于 chat SSE 关闭才入史，这正是滚动历史存在的意义。
    // 载荷只有 title（与 ACP 翻译层逐字段一致的最小契约形状）。
    this.runner.setSessionTitleListener((title) => {
      this.emitCockpitEvent({ event: 'session-title', data: { title } });
    });
  }

  /**
   * Create a new AgentSession with EnhancedRunner and LLM client.
   *
   * Sets up the LLM client, AskHuman bridge, and EnhancedRunner with
   * all wrangler tools (builtin, MCP, session, todolist, skills).
   *
   * @param options - Session creation options
   * @param config - Daemon configuration with LLM credentials
   * @returns Initialized AgentSession ready to handle messages
   */
  static async create(options: AgentSessionOptions, config: DaemonConfig): Promise<AgentSession> {
    const bridge = AgentSession._createBridge();
    const defaultModel = resolveDefaultModel(config.llm.providers);
    const llmModel = options.model ?? defaultModel;
    // 注入的 llmClient（浏览器 FetchLlmProvider）优先；否则要求宿主提供工厂
    const llmClient =
      options.llmClient ??
      options.llmClientFactory?.(config.llm.providers) ??
      (() => {
        throw new Error(
          'AgentSession requires llmClient or llmClientFactory (e.g. (providers) => LLMClient.quickInit({ providers }))'
        );
      })();

    const askHumanHandler = AgentSession._createAskHumanHandler(bridge);

    // Structured runner config: daemon config.yaml defaults merged with the
    // request-body config groups, field-level. The full sandbox object
    // (timeout/allowNetwork/policies) is passed through — not just `enabled`.
    const mergedSandbox = mergeSandboxConfig(config.sandbox, options.sandbox);

    // Create skill provider: injected provider takes priority; otherwise
    // build from dirs using the globally registered SkillFsOps (nodeFsOps
    // registered above — daemon.ts also registers it at startup).
    const skillProvider =
      options.skills?.provider ??
      (options.skills?.dirs?.length ? new FilesystemSkillProvider(options.skills.dirs) : undefined);

    const runner = await EnhancedRunner.create({
      runtime:
        options.runtime ??
        (() => {
          throw new Error(
            'AgentSessionOptions.runtime is required — Node host: new NodeHostEnv() from @agentskillmania/wrangler/host-env/node-host-env; browser: BrowserHostEnv'
          );
        })(),
      llm: { client: llmClient, model: llmModel },
      workspacePath: options.workspacePath,
      sandbox: mergedSandbox,
      thinking: options.thinking,
      tools: {
        ...options.tools,
        mcpConfigPaths: options.tools?.mcpConfigPaths ?? [],
        askHumanHandler,
      },
      session: {
        enabled: options.session?.enabled ?? true,
        baseDir: options.sessionBaseDir,
        // Pass sessionDir so EnhancedRunner builds a dir-bound store and
        // SessionMiddleware writes to the correct directory.
        sessionDir: options.sessionStore?.isDirBound
          ? options.sessionStore.getSessionDir(undefined)
          : undefined,
      },
      todolist: { enabled: options.todolist?.enabled ?? true },
      specPlan: { enabled: options.specPlan?.enabled ?? true },
      commands: { enabled: options.commands?.enabled ?? true },
      a2ui: options.a2ui,
      skills: { ...options.skills, provider: skillProvider },
      search: options.search,
      // API boolean→策略对象:R2P-239 起 compression 透传调优字段
      // (strategy/threshold/keepRecent),不再塌缩成布尔。
      compression: toRunnerCompression(options.compression),
      delegation: { subAgents: options.subAgents },
      crewId: options.crewId,
      limits: options.limits,
    });

    // Build tool definitions from runner for state synchronization
    const runnerTools = runner.getToolInfo().map((t) => ({
      name: t.name,
      description: t.description,
    }));

    // Resume from previous state if available
    let state: AgentState;
    if (options.sessionStore && options.sessionId) {
      const previousState = await options.sessionStore.loadState(options.sessionId);
      if (previousState) {
        // Synchronize config with current runner settings
        state = updateState(previousState, (draft) => {
          draft.config.name = options.agentName;
          draft.config.instructions = options.agentInstructions ?? draft.config.instructions;
          draft.config.tools = runnerTools;
        });
      } else {
        state = createAgentState({
          name: options.agentName,
          tools: runnerTools,
          instructions: options.agentInstructions ?? DEFAULT_INSTRUCTIONS,
        });
      }
    } else {
      state = createAgentState({
        name: options.agentName,
        tools: runnerTools,
        instructions: options.agentInstructions ?? DEFAULT_INSTRUCTIONS,
      });
    }

    const session = new AgentSession(runner, state, bridge, options);
    session._llmClient = llmClient;
    return session;
  }

  /**
   * Resume an AgentSession from a persisted session directory.
   *
   * Delegates to EnhancedRunner.resume() to reconstruct the runner and state
   * from the runnerConfig snapshot stored on disk.
   */
  static async resume(
    sessionDir: string,
    options: AgentSessionResumeOptions,
    config: DaemonConfig
  ): Promise<AgentSession> {
    const bridge = AgentSession._createBridge();
    const llmModel = resolveDefaultModel(config.llm.providers);
    if (!options.llmClientFactory) {
      throw new Error(
        'AgentSession.resume requires llmClientFactory (e.g. (providers) => LLMClient.quickInit({ providers }))'
      );
    }
    if (!options.runtime) {
      throw new Error(
        'AgentSession.resume requires options.runtime — Node host: defaultNodeHostEnv from @agentskillmania/wrangler/host-env/node-host-env'
      );
    }
    const llmClient = options.llmClientFactory(config.llm.providers);
    const askHumanHandler = AgentSession._createAskHumanHandler(bridge);

    const { runner, state } = await EnhancedRunner.resume(sessionDir, {
      runtime: options.runtime,
      llm: { client: llmClient, model: llmModel },
      askHumanHandler,
      subAgents: options.subAgents,
      sandbox: options.sandbox,
      // R2P-239：config.yaml 现读的压缩策略随 resume 注入（宿主提供的
      // 优先于 meta 快照——Rust merge_opt_opt 同序）。
      compression: toRunnerCompression(options.compression),
    });

    const session = new AgentSession(runner, state, bridge, {
      sessionId: options.sessionId,
      workspacePath: options.workspacePath,
      agentName: options.agentName,
      agentInstructions: options.agentInstructions,
      agentConfigPath: options.agentConfigPath,
      sessionStore: options.sessionStore,
      sessionManager: options.sessionManager,
      model: runner.getConfig().model,
    });
    session._llmClient = llmClient;
    return session;
  }

  /** Create an AskHumanBridge instance. */
  private static _createBridge(): AskHumanBridge {
    return {
      sseSender: null,
      cockpitSenders: new Set(),
      pendingHumanInput: new Map(),
    };
  }

  /** Create an AskHumanHandler wired to the given bridge. */
  private static _createAskHumanHandler(bridge: AskHumanBridge): AskHumanHandler {
    return async ({ questions, context }) => {
      // Collision-proof frontend requestId (R2P-165①, aligned with the kernel's
      // host-bridge id convention `human-<uuid>`): `human-${Date.now()}` collides
      // when the LLM issues two ask_human calls in one batch — both park under
      // the same pendingHumanInput key, so the first respond resolves the WRONG
      // promise and the second answer lands on an already-settled entry.
      const requestId = `human-${globalThis.crypto.randomUUID()}`;
      // Full-list field (R2P-165③, additive for array consumers): the blocking
      // bridge surfaces one frame per ask, so this frame's list is the single
      // request it carries; the complete list reaches the frontend via the
      // waiting-human done frame and the respond route's `interrupts` payload.
      // The entry is hand-built (NOT via humanRequestPayloads): that helper
      // keys `requestId` off the request's toolCallId, but the bridge id and
      // the toolCallId are DUAL namespaces here — the frontend must answer
      // with the bridge-invented `human-<uuid>` (the pendingHumanInput key),
      // while the toolCallId is only minted by the parked promise's owner and
      // is unknown at emission time.
      const payload: SSEEvent = {
        event: 'human-input',
        data: {
          requestId,
          questions,
          context,
          requests: [{ requestId, questions, context }],
        },
      };
      bridge.sseSender?.(payload);
      for (const sender of bridge.cockpitSenders) sender(payload);
      return new Promise<HumanResponse>((resolve, reject) => {
        bridge.pendingHumanInput.set(requestId, { resolve, reject });
      });
    };
  }

  /** Fan out an event to all registered cockpit senders. */
  private _broadcastToCockpit(event: SSEEvent): void {
    for (const sender of this.bridge.cockpitSenders) sender(event);
  }

  /** Whether the session is currently processing a message */
  get busy(): boolean {
    return this._busy;
  }

  /**
   * Get current agent state.
   *
   * @returns The current immutable AgentState
   */
  getState(): AgentState {
    return this.state;
  }

  /** 解析后的 runner 配置（诊断/启动信息用，避免暴露整个 runner） */
  getRunnerConfig(): ResolvedRunnerConfig {
    return this.runner.getConfig();
  }

  // NOTE: saveState() was removed — persistence is now solely handled by
  // SessionMiddleware.afterRun inside EnhancedRunner.run(). The middleware
  // writes to the same store (dir-bound or standard) that EnhancedRunner
  // creates from the sessionDir we pass in create/resume.

  /**
   * Build unified diagnostics snapshot combining runner capabilities, agent state,
   * latest LLM context, and session metadata.
   *
   * @returns Unified AgentDiagnostics payload
   */
  private async buildDiagnostics(): Promise<Record<string, unknown>> {
    const sessionOverview = await this.buildSessionOverview();
    const sessionInfo = this.buildSessionInfo();
    const config = this.runner.getConfig();

    const features: RunnerFeatureFlags = {
      sandbox: config.sandbox,
      thinkingEnabled: config.thinkingEnabled,
      enablePromptThinking: config.enablePromptThinking,
      a2uiEnabled: config.a2ui?.enabled ?? false,
      compressorEnabled: config.compressorEnabled,
      enableSession: config.enableSession,
      enableTodolist: config.enableTodolist,
      enableCommands: config.enableCommands,
    };

    return {
      runner: {
        features,
        tools: this.runner.getToolInfo(),
        skills: this.runner.getSkillInfo(),
      },
      agent: this.state,
      llm: this.lastLLMRequest,
      systemPrompt: this.lastSystemPrompt,
      session: {
        overview: sessionOverview,
        info: sessionInfo,
      },
    };
  }

  /**
   * Build session overview from SessionStore metadata and agent context.
   * Reads persisted metadata (title, timestamps) from disk.
   */
  private async buildSessionOverview(): Promise<SessionOverview> {
    const meta = this.sessionStore
      ? await this.sessionStore.getMeta(this.sessionStore.isDirBound ? undefined : this.sessionId)
      : null;
    const runnerConfig = this.runner.getConfig();
    const ctx = this.state?.context;

    return {
      title: meta?.title,
      agentName: this.state?.config?.name ?? '',
      model: this.lastLLMRequest?.model ?? this.model,
      stepCount: ctx?.stepCount ?? 0,
      messageCount: ctx?.messages?.length ?? 0,
      tokensIn: ctx?.totalTokens?.input,
      tokensOut: ctx?.totalTokens?.output,
      tokensTotal:
        ctx?.totalTokens?.input != null && ctx?.totalTokens?.output != null
          ? ctx.totalTokens.input + ctx.totalTokens.output
          : undefined,
      estimatedContextSize: ctx?.estimatedContextSize,
      contextWindow: this.lastLLMRequest?.contextWindow ?? runnerConfig.contextWindow,
      status: (this.sessionManager?.getStatus(this.sessionId) ?? 'idle') as SessionStatus,
      createdAt: meta?.createdAt ?? new Date().toISOString(),
      updatedAt: meta?.updatedAt ?? new Date().toISOString(),
    };
  }

  /**
   * Build session info with paths and configuration details.
   * Synchronous — only reads from in-memory state and config.
   */
  private buildSessionInfo(): SessionInfo {
    const runnerConfig = this.runner.getConfig();
    const ctx = this.state?.context;

    return {
      sessionId: this.sessionId,
      agentName: this.state?.config?.name ?? '',
      agentConfigPath: this.agentConfigPath,
      model: this.model,
      tokensIn: ctx?.totalTokens?.input,
      tokensOut: ctx?.totalTokens?.output,
      tokensTotal:
        ctx?.totalTokens?.input != null && ctx?.totalTokens?.output != null
          ? ctx.totalTokens.input + ctx.totalTokens.output
          : undefined,
      workspacePath: this.workspacePath ?? '',
      sessionPath: this.sessionStore
        ? this.sessionStore.isDirBound
          ? this.sessionStore.getSessionDir(undefined)
          : this.sessionStore.getSessionDir(this.sessionId)
        : undefined,
      skillDirs: runnerConfig.skillDirs ?? [],
      mcpConfigPaths: runnerConfig.mcpConfigPaths ?? [],
    };
  }

  /**
   * Emit an event to the cockpit SSE stream and record it in history.
   *
   * Used by external callers (e.g. chat route) to inject events that should
   * appear on the observability stream but are not part of the agent's
   * internal event stream.
   *
   * @param event - SSE event to emit
   */
  emitCockpitEvent(event: SSEEvent): void {
    this._broadcastToCockpit(event);
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.MAX_HISTORY) {
      this.eventHistory.shift();
    }
  }

  /**
   * Register a cockpit event sender for SSE streaming.
   *
   * Multiple senders may be registered concurrently (multi-tab observation,
   * client refresh while an old connection drains). Each receives the same
   * stream of events. The returned disposer unregisters this specific sender
   * — callers must call it on disconnect to avoid leaks.
   *
   * On registration the new sender immediately receives:
   *   1. A replay of recent event history (so a fresh connection sees the
   *      full sequence, not just future events)
   *   2. One unified diagnostics snapshot
   *
   * @param sender - Callback that receives SSE events
   * @returns A disposer that removes this sender from the broadcast set
   */
  addCockpitSender(sender: (event: SSEEvent) => void): () => void {
    this.bridge.cockpitSenders.add(sender);
    // Replay recent history so new connections see full event sequence
    for (const event of this.eventHistory) {
      sender(event);
    }
    // Send unified diagnostics snapshot (async — fire and forget)
    this.buildDiagnostics().then((data) => {
      // Only deliver if this sender is still registered by the time the
      // (async) diagnostics build completes.
      if (this.bridge.cockpitSenders.has(sender)) {
        sender({ event: 'agent-diagnostics', data });
      }
    });
    return () => {
      this.bridge.cockpitSenders.delete(sender);
    };
  }

  /**
   * Send unified diagnostics snapshot to cockpit.
   *
   * Called after each conversation round completes.
   */
  sendStateSnapshot(): void {
    this.buildDiagnostics().then((data) => {
      this._broadcastToCockpit({ event: 'agent-diagnostics', data });
    });
  }

  /**
   * Respond to a pending AskHuman request.
   *
   * Called when the frontend sends a human response back to the server.
   * Resolves the pending promise that the AskHuman handler is awaiting.
   *
   * @param requestId - The ID of the pending human input request
   * @param response - The human's response data
   * @returns true if the request was found and resolved, false otherwise
   */
  respondHumanInput(requestId: string, response: unknown): boolean {
    const pending = this.bridge.pendingHumanInput.get(requestId);
    if (!pending) return false;
    pending.resolve(response as HumanResponse);
    this.bridge.pendingHumanInput.delete(requestId);
    this.bridge.sseSender?.({ event: 'human-input-resolved', data: { requestId, response } });
    return true;
  }

  /**
   * Answer a pending interrupt through session STATE (not the in-memory
   * bridge) — the warm-session tier of the respond route (R2P-165②, Rust
   * 09b03af's "温会话内存优先" semantics: the in-memory state is assembled
   * first because it can be AHEAD of disk).
   *
   * Matches `findPendingInterrupt` (tool-call id or question id), injects the
   * answer via colts `respond()`, consumes the entry with
   * `removePendingInterrupt`, updates the in-memory state and writes it
   * through to the session store. Only call this when the session is NOT
   * busy: injecting into the pre-run snapshot while a run is in flight would
   * be rolled back by that run's afterRun persistence.
   *
   * @returns the remaining unanswered requests (possibly empty) — an empty
   *   list means the caller may drive a continuation run (continueRun).
   */
  async respondViaState(
    requestId: string,
    response: unknown
  ): Promise<
    | { status: 'not-found' }
    | { status: 'invalid'; error: string }
    | { status: 'answered'; remaining: HumanRequest[] }
  > {
    const pending = findPendingInterrupt(this.state, requestId);
    if (!pending) return { status: 'not-found' };
    const converted = hitlResponseFromValue(pending.request, response);
    if (!converted.ok) return { status: 'invalid', error: converted.error };
    let next = hitlRespond(this.state, pending.request, converted.response);
    next = removePendingInterrupt(next, pending.request.toolCallId);
    this.state = next;
    // Write-through race latch (R2P-165 返修): the `next` snapshot is stale
    // the moment an await opens — a concurrent handleMessage that completes a
    // whole turn inside the saveState window would have its afterRun
    // persistence rolled back by our late write (memory intact, disk stale;
    // visible on crash/resume). Hold the SAME busy flag turns use: the
    // check-and-set from the route's !busy guard through here is await-free
    // (atomic on JS's single thread), so a turn starting during the write is
    // rejected with the standard busy error instead of interleaving. Released
    // in finally — a failed write must not wedge the session.
    this._busy = true;
    try {
      if (this.sessionStore) {
        await this.sessionStore.saveState(
          this.sessionStore.isDirBound ? undefined : this.sessionId,
          next
        );
      }
    } finally {
      this._busy = false;
    }
    return {
      status: 'answered',
      remaining: (next.context.pendingInterrupts ?? []).map((p) => p.request),
    };
  }

  /**
   * 按轮截断本会话（温会话路径，R2P-154a，对齐 Rust 0a2cc4e /truncate 的
   * 温分支语义）：在 busy 闩锁的临界区内完成 读盘 → 截断 → 写盘 →
   * 内存重载。磁盘是事实，内存跟盘走 —— 否则温会话内存里的旧状态会在
   * 下一次消费轮被取用、随 afterRun 落盘，把截断静默回滚（「回魂」；
   * Rust 侧即 098adbd 给 truncate 收编 send_lock 临界区的动机）。
   *
   * 闩锁与 respondViaState 的写穿盘闩锁同款：check-and-set 到 latch 之间
   * 零 await（单线程 JS 上原子），临界区里并发 handleMessage 被挡在
   * busy 之外；finally 释放，失败不得卡死会话。截到 0 的空态也能被下一
   * 次 send 正常整体覆盖（空 context resume 通路）。
   *
   * @param statePath - 路由解析出的 state.json 绝对路径（sessionDir query
   *   显式目录优先，与 /messages 同款解析）
   * @returns 成功带钳制后的 keptTurns；失败带 HTTP 语义码与文案（调用方
   *   包成响应，不在此处直接回 HTTP）
   */
  async truncateTurns(
    statePath: string,
    keepTurns: number
  ): Promise<
    { ok: true; keptTurns: number } | { ok: false; code: 409 | 404 | 500; error: string }
  > {
    if (this._busy) {
      return { ok: false, code: 409, error: 'Session is busy' };
    }
    this._busy = true;
    try {
      const out = await truncateStateFile(statePath, keepTurns);
      if (!out.ok) return out;
      // 状态同步：截断态重载进内存（deserializeState 即 JSON.parse 的
      // 直通形状，截空后的 state 依然是合法 AgentState）。重载前做最小
      // 形状校验（context 必须是对象）：磁盘上 JSON 合法但形状畸形的
      // state（手改/半损）不能毒化内存——不合则跳过重载保旧内存，对齐
      // Rust load_state 的降级语义（下一轮整体覆盖写盘，畸形内存态会
      // 被冲掉，但在此之前服务的是旧好态而非垃圾）。
      try {
        const parsed: unknown = JSON.parse(out.json);
        const context = (parsed as { context?: unknown } | null)?.context;
        if (typeof context !== 'object' || context === null) {
          return { ok: true, keptTurns: out.keptTurns };
        }
        this.state = deserializeState(out.json);
      } catch {
        return { ok: true, keptTurns: out.keptTurns };
      }
      return { ok: true, keptTurns: out.keptTurns };
    } finally {
      this._busy = false;
    }
  }

  /**
   * Stream process a user message, yielding SSE events.
   *
   * Adds the user message to state, runs the EnhancedRunner stream,
   * maps colts RunStreamEvents to SSEEvents, and yields them to the caller.
   * Handles abort and error cases gracefully.
   *
   * @param message - The user's text message
   * @param options - Optional per-request configuration
   * @param options.thinkingEnabled - Override thinking mode for this request
   * @param options.model - Override model for this request
   * @yields SSEEvent for each event in the agent execution stream
   */
  async *handleMessage(
    message: string,
    options?: { thinkingEnabled?: boolean; model?: string }
  ): AsyncIterable<SSEEvent> {
    if (this._busy) {
      yield { event: 'error', data: { message: 'Session is busy processing a message' } };
      return;
    }

    // Enforce maxInputLength before appending — throws if message exceeds limit.
    // The error propagates out of the async generator, surfaced to the client
    // as an SSE error event by the caller (chat route streamAgentSession).
    if (this.maxInputLength !== undefined) {
      if (message.length > this.maxInputLength) {
        yield {
          event: 'error',
          data: {
            message: `Input exceeds maximum length of ${this.maxInputLength} characters (got ${message.length})`,
          },
        };
        return;
      }
    }

    yield* this.driveTurn((s) => addUserMessage(s, message, this.maxInputLength), options);
  }

  /**
   * ack 语义的后台驱动（R2P-153，对齐 Rust `Session::drive_seeded` 的
   * spawn + begin_turn）：开轮（busy 闩 + turnSeq 自增）与调用方的 busy
   * 检查之间零 await（单线程 JS 上 check-and-begin 原子——async
   * generator 的首个 next() 同步执行到 driveTurn 的第一个 await，开轮
   * 在其中），返回的 turnSeq 就是本轮 done 帧将携带的轮号（等待方按
   * `data.turnSeq === ack.turnSeq` 认领完结）。
   *
   * 与 handleMessage 的请求级流不同，帧不进任何响应：runner 帧经
   * pushEvent 落会话通道（滚动历史 + 广播），常驻 events 流
   * （GET /api/chat/:id/events）是唯一收看面；这里的后台消费只为推着
   * 生成器走完生命周期（否则驱动根本不发生）。
   *
   * 消息超限在开轮前拒绝（对齐 Rust append 失败的 400——调用时 ack
   * 响应尚未发出，路由仍可回 HTTP 错误码；handleMessage 内的同款
   * yield-error 分支在此路径不可达）。驱动异常不静默：error 帧进会话
   * 流（对齐 Rust drive 失败的 `emit_error`——ack 已回，等待方靠 events
   * 流的 error 帧感知失败）。
   *
   * @returns 开轮成功带本轮 turnSeq 与完成 promise（hadError 供路由
   *   映射 SessionManager 状态）；busy/超限带 HTTP 语义码由路由包响应。
   */
  sendMessageInBackground(
    message: string,
    options?: { thinkingEnabled?: boolean; model?: string }
  ):
    | { ok: true; turnSeq: number; completion: Promise<{ hadError: boolean }> }
    | { ok: false; code: 409 | 400; error: string } {
    if (this._busy) {
      return { ok: false, code: 409, error: 'Session is busy processing a message' };
    }
    if (this.maxInputLength !== undefined && message.length > this.maxInputLength) {
      return {
        ok: false,
        code: 400,
        error: `Input exceeds maximum length of ${this.maxInputLength} characters (got ${message.length})`,
      };
    }
    // turnSeq+1 是 driveTurn 即将分配的轮号：busy 复检到此零 await（见上），
    // 没有并发驱动能插进来抢号。
    const turnSeq = this.turnSeq + 1;
    // handleMessage 的静态类型是 AsyncIterable——取显式迭代器驱动（next
    // 在类型上可见；运行时本就是 async generator）。
    const iterator = this.handleMessage(message, options)[Symbol.asyncIterator]();
    const completion = (async (): Promise<{ hadError: boolean }> => {
      try {
        for (;;) {
          const r = await iterator.next();
          if (r.done) return { hadError: false };
        }
      } catch (err) {
        this.pushEvent({ event: 'error', data: { message: `drive failed: ${String(err)}` } });
        return { hadError: true };
      }
    })();
    return { ok: true, turnSeq, completion };
  }

  /**
   * Continue a run from the current state WITHOUT appending a user message
   * (R2P-165②, the daemon counterpart of Rust 9995668's rebuild+续跑).
   *
   * Used by the respond route after the last pending interrupt is answered:
   * the injected tool results already pair the dangling tool_calls, so the
   * LLM continues the turn from history. Same streaming contract as
   * handleMessage.
   *
   * @param options - Optional per-request configuration (model/thinking)
   * @yields SSEEvent for each event in the continuation stream
   */
  async *continueRun(options?: {
    thinkingEnabled?: boolean;
    model?: string;
  }): AsyncIterable<SSEEvent> {
    if (this._busy) {
      yield { event: 'error', data: { message: 'Session is busy processing a message' } };
      return;
    }
    yield* this.driveTurn((s) => s, options);
  }

  /**
   * Shared turn machinery for handleMessage (seed = append user message) and
   * continueRun (seed = identity): busy flag, abort controller, event-queue
   * lifecycle, runner event wiring, and the runner.run() drive loop.
   */
  private async *driveTurn(
    seed: (state: AgentState) => AgentState,
    options?: { thinkingEnabled?: boolean; model?: string }
  ): AsyncIterable<SSEEvent> {
    this._busy = true;
    // 轮次编号 +1（R2P-152，对齐 Rust begin_turn 在驱动入口开轮）：含
    // continueRun/HITL 续跑——消费轮的 done 与用户轮的 done 各带各的
    // turnSeq；send/respond ack 体携带待等的轮次是 Task 3（R2P-153）。
    this.turnSeq += 1;
    // 闲置 TTL 活动触碰（R2P-121，对齐 Rust Session::touch 在轮驱动入口）：
    // handleMessage 与 continueRun（respond 续跑）共用本收口，一处触碰全覆盖。
    // 观察（cockpit SSE / 诊断快照 / 常驻 events 流）不触碰——对齐 Rust 侧
    // agent-state 挂流不 touch。近期有活动的会话即使注册超龄也不可驱逐。
    this.sessionManager?.touchAgentSession?.(this.sessionId);
    this.abortController = new AbortController();
    this.eventQueue = [];
    this.eventWaiters = [];
    this.eventHistory = [];
    this.lastSystemPrompt = null;
    this.doneFlag = false;

    // 本请求的流订阅会话通道（R2P-122）：从 attach 时刻起收增量（不重放
    // 全史——常驻流的重放/补洞走 routes/chat.ts 的 events 端点）。seq 经
    // frameToSse 注入 data 上线（R2P-151）——落下的史就是广播的帧，重连
    // 按 data.seq 对账。seed 是纯状态变换（不发帧）且可能抛
    // （addUserMessage 拒绝）——放在订阅之前，不留「订了没 finally」的窗。
    this.state = seed(this.state);

    const detachChannel = this.subscribe((entry) => {
      this.enqueueSse(frameToSse(entry));
    });

    this.bridge.sseSender = (event: SSEEvent) => this.pushEvent(event);

    const consumeStream = async () => {
      // Register EventEmitter listeners for all event types
      const eventTypes = [
        'step:start',
        'step:end',
        'phase-change',
        'token',
        'thinking',
        'tool:start',
        'tools:start',
        'tool:end',
        'tools:end',
        'skill:loading',
        'skill:loaded',
        'skill:start',
        'skill:end',
        'subagent:start',
        'subagent:end',
        'subagent:token',
        'subagent:thinking',
        'subagent:tool:start',
        'subagent:tool:end',
        'subagent:tools:start',
        'subagent:tools:end',
        'llm:request',
        'llm:response',
        'todo:list',
        'compressing',
        'compressed',
        'session-cleared',
        'complete',
        'error',
        'abort',
      ];

      const handlers: Record<string, (data: unknown) => void> = {};
      for (const type of eventTypes) {
        handlers[type] = (data: unknown) => {
          const eventObj = data && typeof data === 'object' ? { type, ...data } : { type };
          const mapped = AgentSession.mapEvent(eventObj as RunStreamEvent);
          const events = Array.isArray(mapped) ? mapped : [mapped];
          for (const sse of events) {
            // Inject daemon-side timestamp for every event — consumers can
            // use it for ordering and latency measurement.
            if (typeof sse.data === 'object' && sse.data !== null) {
              (sse.data as Record<string, unknown>).timestamp = Date.now();
            }
            this.pushEvent(sse);
            this._broadcastToCockpit(sse);
            this.eventHistory.push(sse);
            if (this.eventHistory.length > this.MAX_HISTORY) {
              this.eventHistory.shift();
            }
            // Capture LLM request for diagnostics
            if (sse.event === 'llm-request' && typeof sse.data === 'object' && sse.data !== null) {
              const d = sse.data as Record<string, unknown>;
              if (Array.isArray(d.messages)) {
                this.lastLLMRequest = {
                  messages: d.messages,
                  tools: Array.isArray(d.tools) ? d.tools : undefined,
                  skill: typeof d.skill === 'string' ? d.skill : undefined,
                  model: typeof d.model === 'string' ? d.model : undefined,
                  contextWindow: typeof d.contextWindow === 'number' ? d.contextWindow : undefined,
                };
                const firstMsg = d.messages[0] as Record<string, unknown> | undefined;
                if (firstMsg && typeof firstMsg.content === 'string') {
                  this.lastSystemPrompt = firstMsg.content;
                }
              }
            }
          }
        };
        this.runner.on(
          type as keyof RunnerEventMap,
          handlers[type] as (...args: unknown[]) => void
        );
      }

      try {
        const runOpts: RunOptions = { signal: this.abortController!.signal };
        if (options?.thinkingEnabled !== undefined) {
          runOpts.thinkingEnabled = options.thinkingEnabled;
        }
        if (options?.model !== undefined) {
          runOpts.model = options.model;
        }
        const { state: finalState } = await this.runner.run(this.state, runOpts);
        this.state = finalState;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          this.pushEvent({ event: 'done', data: { aborted: true } });
        } else {
          this.pushEvent({ event: 'error', data: { message: String(err) } });
        }
      } finally {
        // Unregister all listeners to avoid leaks on subsequent runs
        for (const type of eventTypes) {
          this.runner.off(
            type as keyof RunnerEventMap,
            handlers[type] as (...args: unknown[]) => void
          );
        }
        // Persistence is handled by SessionMiddleware.afterRun inside
        // runner.run() — no manual saveState needed here.
        this._busy = false;
        this.sendStateSnapshot();
        this.signalDone();
        this.bridge.sseSender = null;
      }
    };

    consumeStream();

    try {
      while (true) {
        const event = await this.pullEvent();
        if (event === null) break;
        yield event;
      }
    } finally {
      // 流终止（正常收尾，或消费方 break/throw 触发的提前 return）即退订
      // ——不退订的话残留订阅会把下一轮的帧重复喂进重置后的队列。
      detachChannel();
    }
  }

  /**
   * Stop the current agent execution stream.
   *
   * Aborts the underlying LLM call and tool executions.
   */
  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  // ─── 会话级事件通道（R2P-122，对齐 Rust session/live.rs）───

  /**
   * Subscribe to the session event channel.
   *
   * Listeners receive HistoryEntry increments FROM THE MOMENT OF SUBSCRIPTION
   * (no replay of prior history — replay/seq-gated hole-filling lives in the
   * persistent events route, R2P-151). The returned disposer removes this
   * listener; per-request streams MUST call it when the stream terminates
   * (normal end or early return), or later turns would feed duplicate frames
   * into the reset queue.
   */
  subscribe(listener: (entry: HistoryEntry) => void): () => void {
    this.channelSubscribers.add(listener);
    return () => {
      this.channelSubscribers.delete(listener);
    };
  }

  /**
   * Rolling history snapshot (oldest first, newest last). 常驻 events 流的
   * 断线重放源（R2P-151，`seq > lastSeq` 的条目直出后转入直播）。驱逐/
   * 重建后新 AgentSession 新通道——历史随旧对象走（对齐 Rust：滚动历史
   * 是内存态，随 Session drop 而失）。
   */
  historySnapshot(): HistoryEntry[] {
    return [...this.history];
  }

  /**
   * 下一帧将取的 seq（frameSeq + 1；对齐 Rust `Session::next_seq`）——
   * events 流 history-end 分界帧的空历史分支用：firstSeq 语义是「保留窗
   * 首帧 seq」，空窗时退化为「下一帧将取的 seq」，客户端拿它判对齐。
   */
  nextFrameSeq(): number {
    return this.frameSeq + 1;
  }

  /** 压入一帧滚动历史（超安全阀丢最旧——对齐 Rust push_history）。 */
  private pushHistory(entry: HistoryEntry): void {
    if (this.history.length >= HISTORY_CAP) {
      this.history.shift();
    }
    this.history.push(entry);
  }

  /**
   * 通道的唯一写入点（对齐 Rust Session::emit）：分配 seq → 先同步落史 →
   * 再广播同一帧。同步实现：返回时历史已更新、订阅者已全部收到——
   * 落史与广播无时序窗（落史失败的广播不发生）。seq 会话内单调递增
   * （从 1 起，对齐 Rust frame_seq 的 fetch_add+1），上线注入在
   * frameToSse（重放/直播单源）。done 帧在此注入所属轮次编号 turnSeq
   * （R2P-152，对齐 Rust emit 对 name=="done" 的注入——所有 done 产生
   * 路径单源收口：complete 映射、abort 收尾），且随落史进滚动历史——
   * 常驻流重放段照样可见，重连后 done 归属不丢。
   */
  private pushEvent(event: SSEEvent): void {
    // done 帧注入所属轮次编号。对象守卫与 frameToSse 对称（数组/原始值
    // data 不注入——对齐 Rust serde 只在 Value::Object 上 insert）。
    const data =
      event.event === 'done' &&
      typeof event.data === 'object' &&
      event.data !== null &&
      !Array.isArray(event.data)
        ? { ...(event.data as Record<string, unknown>), turnSeq: this.turnSeq }
        : event.data;
    const entry: HistoryEntry = {
      seq: ++this.frameSeq,
      event: event.event,
      data,
    };
    this.pushHistory(entry);
    // 隔离坏订阅者（对齐 Rust event_tx 发送端与接收端的构造性隔离）：一个
    // listener 抛错不得跳过其余订阅者、不得穿透进 runner 事件 handler 被吞成
    // 合成 error 帧、也不得跳过同帧的 cockpit 广播（那发生在调用方）。
    for (const listener of this.channelSubscribers) {
      try {
        listener(entry);
      } catch {
        /* isolate: 坏订阅者自吞，广播链继续 */
      }
    }
  }

  // ─── Event queue internals ───

  /** 本请求流的入队点（由会话通道的订阅回调喂入；等待者直通，否则排队）。 */
  private enqueueSse(event: SSEEvent): void {
    if (this.eventWaiters.length > 0) {
      const resolve = this.eventWaiters.shift()!;
      resolve(event);
    } else {
      this.eventQueue.push(event);
    }
  }

  private pullEvent(): Promise<SSEEvent | null> {
    if (this.eventQueue.length > 0) {
      return Promise.resolve(this.eventQueue.shift()!);
    }
    if (this.doneFlag) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      this.eventWaiters.push(resolve);
    });
  }

  private doneFlag = false;

  private signalDone(): void {
    this.doneFlag = true;
    while (this.eventWaiters.length > 0) {
      const resolve = this.eventWaiters.shift()!;
      resolve(null);
    }
  }

  // ─── Static event mapping (pure, testable) ───

  /**
   * Map a colts RunStreamEvent to one or more SSEEvents.
   *
   * This is a pure function that translates internal colts event types
   * to frontend-friendly SSE event payloads.
   *
   * @param event - A colts RunStreamEvent from the runner stream
   * @returns Mapped SSEEvent(s)
   */
  /**
   * Safely parse JSON, returning null on failure.
   * @internal
   */
  private static safeJsonParse(s: string): unknown {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  static mapEvent(event: { type: string; [key: string]: unknown }): SSEEvent | SSEEvent[] {
    // Cast to RunStreamEvent for known event field access; subagent: events
    // are accessed via the loose type directly.

    switch (event.type) {
      case 'step:start':
        return { event: 'step-start', data: { step: event.step } };

      case 'step:end': {
        const result = (event as unknown as { result: Record<string, unknown> }).result;
        return {
          event: 'step-end',
          data: {
            step: event.step,
            type: result?.type,
            tokens: result?.tokens,
            duration: result?.duration,
            result,
          },
        };
      }

      case 'phase-change':
        return { event: 'phase-change', data: { from: event.from, to: event.to } };

      case 'token':
        return { event: 'token', data: { delta: event.token } };

      case 'thinking':
        return { event: 'thinking', data: { content: event.content } };

      case 'tool:start':
        return {
          event: 'tool-start',
          data: {
            id: (event as unknown as { action: { id: string } }).action.id,
            name: (event as unknown as { action: { tool: string } }).action.tool,
            args: (event as unknown as { action: { arguments: unknown } }).action.arguments,
          },
        };

      case 'tools:start':
        return (
          event as unknown as {
            actions: Array<{ id: string; tool: string; arguments: unknown }>;
          }
        ).actions.map((action) => ({
          event: 'tool-start' as const,
          data: { id: action.id, name: action.tool, args: action.arguments },
        }));

      case 'tool:end':
        return {
          event: 'tool-end',
          data: {
            callId: event.callId,
            result:
              typeof event.result === 'object'
                ? JSON.stringify(event.result, null, 2)
                : String(event.result),
          },
        };

      case 'tools:end':
        return Object.entries(
          (event as unknown as { results: Record<string, unknown> }).results
        ).map(([callId, result]) => ({
          event: 'tool-end' as const,
          data: {
            callId,
            result: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result),
          },
        }));

      case 'skill:loading':
        return { event: 'skill-loading', data: { name: event.name } };

      case 'skill:loaded':
        return { event: 'skill-loaded', data: { name: event.name, tokenCount: event.tokenCount } };

      case 'skill:start':
        return { event: 'skill-start', data: { name: event.name, task: event.task } };

      case 'skill:end':
        return { event: 'skill-end', data: { name: event.name, result: event.result } };

      case 'subagent:start':
        return {
          event: 'subagent-start',
          data: { name: event.name, task: event.task, subtaskId: event.subtaskId },
        };

      case 'subagent:end': {
        // DelegateResult carries tokens + duration; surface them alongside status
        const rawResult = event.result as Record<string, unknown> | string;
        const parsed =
          typeof rawResult === 'string'
            ? (AgentSession.safeJsonParse(rawResult) as Record<string, unknown> | null)
            : rawResult;
        return {
          event: 'subagent-end',
          data: {
            name: event.name,
            subtaskId: event.subtaskId,
            status: parsed?.status ?? 'unknown',
            answer: parsed?.answer,
            error: parsed?.error,
            totalSteps: parsed?.totalSteps,
            tokens: parsed?.tokens,
            duration: parsed?.duration,
            result: typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult),
          },
        };
      }

      case 'subagent:token':
        return {
          event: 'subagent-token',
          data: {
            subtaskId: event.subtaskId,
            name: event.subagentName,
            delta: event.token,
          },
        };

      case 'subagent:thinking':
        return {
          event: 'subagent-thinking',
          data: {
            subtaskId: event.subtaskId,
            name: event.subagentName,
            content: event.content,
          },
        };

      case 'subagent:tool:start':
        return {
          event: 'subagent-tool-start',
          data: {
            subtaskId: event.subtaskId,
            name: event.subagentName,
            action: (event as unknown as { action: unknown }).action,
          },
        };

      case 'subagent:tool:end':
        return {
          event: 'subagent-tool-end',
          data: {
            subtaskId: event.subtaskId,
            name: event.subagentName,
            callId: (event as unknown as { callId: string }).callId,
            result: event.result,
          },
        };

      // Parallel tool calls inside a sub-agent: the delegate forwards
      // tools:start/tools:end as-is, so split them into per-call frames like
      // the top-level tools:start/tools:end cases — each subagent-tool-start
      // creates a streaming block keyed by call id, each subagent-tool-end
      // completes exactly its own block.
      case 'subagent:tools:start':
        return (
          event as unknown as {
            subtaskId: string;
            subagentName: string;
            actions: Array<{ id: string; tool: string; arguments: unknown }>;
          }
        ).actions.map((action) => ({
          event: 'subagent-tool-start' as const,
          data: {
            subtaskId: event.subtaskId,
            name: event.subagentName,
            action,
          },
        }));

      case 'subagent:tools:end':
        return Object.entries(
          (event as unknown as { results: Record<string, unknown> }).results
        ).map(([callId, result]) => ({
          event: 'subagent-tool-end' as const,
          data: {
            subtaskId: event.subtaskId,
            name: event.subagentName,
            callId,
            result: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result),
          },
        }));

      case 'llm:request':
        return {
          event: 'llm-request',
          data: {
            messages: (event as unknown as { messages: unknown }).messages,
            tools: (event as unknown as { tools: unknown }).tools,
            skill: (event as unknown as { skill: unknown }).skill,
            model: (event as unknown as { model: string }).model,
            contextWindow: (event as unknown as { contextWindow: number }).contextWindow,
          },
        };

      case 'llm:response':
        return {
          event: 'llm-response',
          data: {
            text: event.text,
            toolCalls: event.toolCalls,
            tokens: (event as unknown as { tokens?: unknown }).tokens,
          },
        };

      case 'todo:list': {
        // Normalize to the Rust daemon's wire shape (serde output): omit
        // undefined/null and empty arrays, and rename camelCase `blockedBy`
        // to snake_case `blocked_by` — both daemons must emit identical JSON.
        const items = ((event as unknown as { items?: unknown[] }).items ?? []).map(
          (item: unknown) => {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
              if (v === undefined || v === null) continue;
              if (Array.isArray(v) && v.length === 0) continue;
              out[k === 'blockedBy' ? 'blocked_by' : k] = v;
            }
            return out;
          }
        );
        return { event: 'todo-list', data: { items } };
      }

      case 'compressing':
        return { event: 'compressing', data: {} };

      case 'compressed':
        // `coveredMessages` = messages newly covered THIS round (anchor delta,
        // unambiguous count) — colts 0.5.0-alpha.1 made it required; pass it
        // through so the wire shape matches Rust events.rs `compressed`
        // (summary/removedCount/coveredMessages). Legacy kernels that omit it
        // serialize without the key (undefined is dropped by JSON).
        return {
          event: 'compressed',
          data: {
            summary: event.summary,
            removedCount: event.removedCount,
            coveredMessages: (event as unknown as { coveredMessages?: number }).coveredMessages,
          },
        };

      case 'session-cleared':
        // `/clear` reset the conversation on the backend. The colts runner emits
        // this when messages go from non-empty to empty; tells the client to drop
        // its local view (mirrors Rust `agent_session.rs` RunnerEvent::SessionCleared).
        return { event: 'session-cleared', data: {} };

      case 'complete': {
        // RunResult carries tokens, totalSteps, duration, and (for success) the answer.
        // Surface them so the client can display final metrics.
        const result = (event as unknown as { result: Record<string, unknown> }).result;
        const data: Record<string, unknown> = {
          type: result?.type,
          answer: result?.answer,
          totalSteps: result?.totalSteps,
          tokens: result?.tokens,
          duration: result?.duration,
        };
        // Waiting-human terminal (R2P-165③): carry ALL suspended requests in
        // the additive `requests` array (parallel double-ask — the host must
        // see everything it has to answer before resuming; colts 0.5.0-alpha.1
        // guarantees the field, the fallback covers legacy kernels). Frame
        // shape mirrors the single-request fields via humanRequestPayloads.
        if (result?.type === 'waiting-human') {
          const waiting = result as unknown as {
            request?: HumanRequest;
            requests?: HumanRequest[];
          };
          const all = waiting.requests ?? (waiting.request ? [waiting.request] : []);
          data.requests = humanRequestPayloads(all);
        }
        return { event: 'done', data };
      }

      case 'error': {
        const errEvent = event as unknown as {
          error: { message: string };
          context?: { toolName?: string; step?: number };
        };
        return {
          event: 'error',
          data: {
            message: errEvent.error.message,
            toolName: errEvent.context?.toolName,
            step: errEvent.context?.step,
          },
        };
      }

      case 'abort':
        return {
          event: 'abort',
          data: {
            step: event.step,
            totalSteps: event.totalSteps,
          },
        };

      default:
        return { event: event.type, data: event };
    }
  }

  /** Get the LLM provider instance (for model metadata queries) */
  get llmClient(): ILLMProvider {
    return this._llmClient;
  }

  /** 已注册的斜杠命令（/clear /compact 等）——给 UI 构建快捷命令 */
  getCommandNames(): Array<{ name: string; description: string }> {
    return this.runner.getCommandNames();
  }
}
