/**
 * AgentSession — wraps wrangler EnhancedRunner with SSE streaming and AskHuman bridging.
 *
 * Full lifecycle: create -> handleMessage (streaming) -> stop.
 * Bridges colts AskHuman tool -> SSE -> frontend for human-in-the-loop interaction.
 */

import { createAgentState, addUserMessage, updateState } from '@agentskillmania/colts';
import type {
  AgentState,
  RunStreamEvent,
  RunOptions,
  RunnerEventMap,
} from '@agentskillmania/colts';
import type { AskHumanHandler, HumanResponse } from '@agentskillmania/colts';
import type { LLMClient } from '@agentskillmania/llm-client';
import {
  EnhancedRunner,
  SessionStore,
  createLLMClient,
  readMeta,
  resolveDefaultModel,
  writeMeta,
} from '@agentskillmania/wrangler';
import type {
  SessionMeta,
  SubAgentConfig,
  LimitsConfig,
  SandboxConfig,
} from '@agentskillmania/wrangler';

import type { SSEEvent, DaemonConfig } from '../types.js';
import type { SessionOverview, SessionInfo, SessionStatus } from './session-diagnostics.js';
import type { RunnerFeatureFlags } from './session-diagnostics.js';

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
  sessionManager?: { getStatus(id: string): string };
  /** Sub-agent configs to rebuild crew delegation on resume */
  subAgents?: SubAgentConfig[];
}

/**
 * Merge sandbox config sources field-by-field (lower → higher precedence):
 * daemon config.yaml `sandbox` defaults ← request-body `sandbox` (boolean
 * legacy form only overrides `enabled`). The sandbox package's own
 * config.yaml/env are NOT part of this chain — the wrangler layer drives the
 * sandbox purely via constructor params.
 */
export function mergeSandboxConfig(
  base: SandboxConfig | undefined,
  override: SandboxConfig | boolean | undefined
): SandboxConfig {
  const fromOverride = typeof override === 'object' && override !== null ? override : {};
  const enabled =
    typeof override === 'boolean' ? override : (fromOverride.enabled ?? base?.enabled ?? true);
  return {
    enabled,
    timeout: fromOverride.timeout ?? base?.timeout,
    allowNetwork: fromOverride.allowNetwork ?? base?.allowNetwork,
    commandPolicy: fromOverride.commandPolicy ?? base?.commandPolicy,
    networkPolicy: fromOverride.networkPolicy ?? base?.networkPolicy,
  };
}

/** Options for creating an AgentSession */
export interface AgentSessionOptions {
  sessionId?: string;
  workspacePath: string;
  agentName: string;
  agentInstructions?: string;
  model?: string;
  sessionBaseDir?: string;
  sessionStore?: SessionStore;
  /** SessionManager instance for reading runtime status. */
  sessionManager?: { getStatus(id: string): string };
  /** Agent definition file path. */
  agentConfigPath?: string;
  // Structured EnhancedRunner option groups (see EnhancedRunnerOptions)
  skills?: { dirs?: string[] };
  tools?: {
    mcpConfigPaths?: string[];
    builtinFilter?: Record<string, boolean>;
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
  compression?: boolean;
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
 * Single agent session backed by wrangler EnhancedRunner.
 *
 * Wraps colts AgentRunner through wrangler's EnhancedRunner for full
 * tool/skill/session support. Streams SSE events to the frontend and
 * bridges AskHuman tool calls to interactive UI prompts.
 */
export class AgentSession {
  readonly sessionId: string;
  readonly workspacePath: string;
  readonly agentName: string;
  readonly model: string;

  private runner: EnhancedRunner;
  private state: AgentState;
  private _llmClient!: LLMClient;
  private abortController: AbortController | null = null;
  private bridge: AskHumanBridge;
  private sessionStore: SessionStore | undefined;
  private readonly sessionManager?: { getStatus(id: string): string };
  private readonly agentConfigPath?: string;
  private _busy = false;
  /** Max input length in characters, enforced in handleMessage. */
  private readonly maxInputLength?: number;
  /** Latest LLM request captured from llm:request stream events */
  private lastLLMRequest: { messages: unknown[]; tools?: unknown[]; skill?: string } | null = null;
  /** Full system prompt extracted from first message of llm-request */
  private lastSystemPrompt: string | null = null;

  /** Async event queue for streaming */
  private eventQueue: SSEEvent[] = [];
  private eventWaiters: Array<(event: SSEEvent | null) => void> = [];
  /** Event history for cockpit replay — new connections receive full sequence */
  private eventHistory: SSEEvent[] = [];
  private readonly MAX_HISTORY = 500;

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
    const llmClient = createLLMClient(config.llm.providers);

    const askHumanHandler = AgentSession._createAskHumanHandler(bridge);

    // Structured runner config: daemon config.yaml defaults merged with the
    // request-body config groups, field-level. The full sandbox object
    // (timeout/allowNetwork/policies) is passed through — not just `enabled`.
    const mergedSandbox = mergeSandboxConfig(config.sandbox, options.sandbox);

    const runner = await EnhancedRunner.create({
      llm: { client: llmClient, model: llmModel },
      workspacePath: options.workspacePath,
      sandbox: mergedSandbox,
      thinking: options.thinking,
      tools: {
        ...options.tools,
        mcpConfigPaths: options.tools?.mcpConfigPaths ?? [],
        askHumanHandler,
      },
      session: { enabled: options.session?.enabled ?? true, baseDir: options.sessionBaseDir },
      todolist: { enabled: options.todolist?.enabled ?? true },
      specPlan: { enabled: options.specPlan?.enabled ?? true },
      commands: { enabled: options.commands?.enabled ?? true },
      a2ui: options.a2ui,
      skills: options.skills,
      search: options.search,
      // API boolean: undefined = default enabled; false = disabled.
      compression: options.compression === false ? false : undefined,
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
    const llmClient = createLLMClient(config.llm.providers);
    const askHumanHandler = AgentSession._createAskHumanHandler(bridge);

    const { runner, state } = await EnhancedRunner.resume(sessionDir, {
      llm: { client: llmClient, model: llmModel },
      askHumanHandler,
      subAgents: options.subAgents,
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
      const requestId = `human-${Date.now()}`;
      const payload: SSEEvent = { event: 'human-input', data: { requestId, questions, context } };
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

  /**
   * Save current state to disk via SessionStore.
   */
  async saveState(): Promise<void> {
    if (this.sessionStore) {
      if (this.sessionStore.isDirBound) {
        // Directory-bound store (explicit sessionDir): sessionId is not
        // accepted — write state + meta directly into the bound directory
        // (mirrors the daemon's persist_session for explicit dirs).
        const dir = this.sessionStore.getSessionDir(undefined);
        await this.sessionStore.saveState(undefined, this.state);
        const now = new Date().toISOString();
        const existing = await readMeta(dir);
        const meta: SessionMeta = {
          id: existing?.id ?? this.sessionId,
          title: existing?.title,
          titleSource: existing?.titleSource,
          workspacePath: this.workspacePath,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          agentName: this.agentName,
          runnerConfig: { model: this.model },
          source: existing?.source,
          metadata: existing?.metadata,
        };
        await writeMeta(dir, meta);
      } else {
        await this.sessionStore.saveState(this.sessionId, this.state);
      }
    }
  }

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
      model: this.model,
      stepCount: ctx?.stepCount ?? 0,
      messageCount: ctx?.messages?.length ?? 0,
      tokensIn: ctx?.totalTokens?.input,
      tokensOut: ctx?.totalTokens?.output,
      tokensTotal:
        ctx?.totalTokens?.input != null && ctx?.totalTokens?.output != null
          ? ctx.totalTokens.input + ctx.totalTokens.output
          : undefined,
      estimatedContextSize: ctx?.estimatedContextSize,
      contextWindow: runnerConfig.contextWindow,
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
    this._busy = true;
    this.abortController = new AbortController();
    this.eventQueue = [];
    this.eventWaiters = [];
    this.eventHistory = [];
    this.lastSystemPrompt = null;
    this.doneFlag = false;

    this.bridge.sseSender = (event: SSEEvent) => this.pushEvent(event);

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
        this._busy = false;
        return;
      }
    }
    this.state = addUserMessage(this.state, message, this.maxInputLength);

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
        'llm:request',
        'llm:response',
        'todo:list',
        'compressing',
        'compressed',
        'waiting-human',
        'complete',
        'error',
      ];

      const handlers: Record<string, (data: unknown) => void> = {};
      for (const type of eventTypes) {
        handlers[type] = (data: unknown) => {
          const eventObj = data && typeof data === 'object' ? { type, ...data } : { type };
          const mapped = AgentSession.mapEvent(eventObj as RunStreamEvent);
          const events = Array.isArray(mapped) ? mapped : [mapped];
          for (const sse of events) {
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
        await this.saveState().catch(() => {});
        this._busy = false;
        this.sendStateSnapshot();
        this.signalDone();
        this.bridge.sseSender = null;
      }
    };

    consumeStream();

    while (true) {
      const event = await this.pullEvent();
      if (event === null) break;
      yield event;
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

  // ─── Event queue internals ───

  private pushEvent(event: SSEEvent): void {
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

      case 'step:end':
        return {
          event: 'step-end',
          data: {
            step: event.step,
            tokens: (event as unknown as { result: { tokens?: unknown } }).result?.tokens,
            duration: (event as unknown as { result: { duration?: unknown } }).result?.duration,
          },
        };

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
            result: event.result,
          },
        };

      case 'llm:request':
        return {
          event: 'llm-request',
          data: {
            messages: (event as unknown as { messages: unknown }).messages,
            tools: (event as unknown as { tools: unknown }).tools,
            skill: (event as unknown as { skill: unknown }).skill,
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
        return {
          event: 'compressed',
          data: { summary: event.summary, removedCount: event.removedCount },
        };

      case 'waiting-human':
        return { event: 'waiting-human', data: { request: event.request } };

      case 'complete': {
        // RunResult carries tokens, totalSteps, duration, and (for success) the answer.
        // Surface them so the client can display final metrics.
        const result = (event as unknown as { result: Record<string, unknown> }).result;
        return {
          event: 'done',
          data: {
            type: result?.type,
            answer: result?.answer,
            totalSteps: result?.totalSteps,
            tokens: result?.tokens,
            duration: result?.duration,
          },
        };
      }

      case 'error':
        return {
          event: 'error',
          data: {
            message: (event as unknown as { error: { message: string } }).error.message,
          },
        };

      default:
        return { event: event.type, data: event };
    }
  }

  /** Get the LLMClient instance (for model metadata queries) */
  get llmClient(): LLMClient {
    return this._llmClient;
  }
}
