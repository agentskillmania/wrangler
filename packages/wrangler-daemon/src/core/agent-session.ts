/**
 * AgentSession — wraps wrangler EnhancedRunner with SSE streaming and AskHuman bridging.
 *
 * Full lifecycle: create -> handleMessage (streaming) -> stop.
 * Bridges colts AskHuman tool -> SSE -> frontend for human-in-the-loop interaction.
 */

import { LLMClient } from '@agentskillmania/llm-client';
import { EnhancedRunner, SessionStore } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { AgentState, RunStreamEvent } from '@agentskillmania/colts';
import type { AskHumanHandler, HumanResponse } from '@agentskillmania/colts';
import type { SSEEvent, DaemonConfig } from '../types.js';

/**
 * Bridge between AskHumanHandler closure and AgentSession instance.
 * The handler is created before the session exists, so this object
 * serves as a mutable indirection layer.
 */
interface AskHumanBridge {
  sseSender: ((event: SSEEvent) => void) | null;
  cockpitSender: ((event: SSEEvent) => void) | null;
  pendingHumanInput: Map<
    string,
    { resolve: (value: HumanResponse) => void; reject: (reason?: unknown) => void }
  >;
}

/** Options for creating an AgentSession */
export interface AgentSessionOptions {
  sessionId?: string;
  workspacePath: string;
  agentName: string;
  agentInstructions?: string;
  model?: string;
  skillDirs?: string[];
  mcpConfigPaths?: string[];
  sessionBaseDir?: string;
  sessionStore?: SessionStore;
  // EnhancedRunner options — all optional with defaults matching current behavior
  builtinTools?: {
    fileRead?: boolean;
    fileWrite?: boolean;
    fileEdit?: boolean;
    glob?: boolean;
    grep?: boolean;
    shell?: boolean;
    webSearch?: boolean;
    webFetch?: boolean;
    python?: boolean;
    git?: boolean;
  };
  enableSession?: boolean;
  enableTodolist?: boolean;
  enableCommands?: boolean;
  sandbox?: boolean;
  thinkingEnabled?: boolean;
  a2ui?: { enabled: boolean };
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
  private abortController: AbortController | null = null;
  private bridge: AskHumanBridge;
  private sessionStore: SessionStore | undefined;
  private _busy = false;

  /** Async event queue for streaming */
  private eventQueue: SSEEvent[] = [];
  private eventWaiters: Array<(event: SSEEvent | null) => void> = [];

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
    this.sessionId = options.sessionId ?? state.id;
    this.workspacePath = options.workspacePath;
    this.agentName = options.agentName;
    this.model = options.model ?? 'deepseek-chat';
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
    const bridge: AskHumanBridge = {
      sseSender: null,
      cockpitSender: null,
      pendingHumanInput: new Map(),
    };

    const llmModel = options.model ?? config.llm.model;
    const llmClient = new LLMClient({ baseUrl: config.llm.baseUrl });
    llmClient.registerProvider({ name: 'openai', maxConcurrency: 10 });
    llmClient.registerApiKey({
      key: config.llm.apiKey,
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: llmModel, maxConcurrency: 3 }],
    });

    const askHumanHandler: AskHumanHandler = async ({ questions, context }) => {
      const requestId = `human-${Date.now()}`;
      bridge.sseSender?.({ event: 'human-input', data: { requestId, questions, context } });
      bridge.cockpitSender?.({ event: 'human-input', data: { requestId, questions, context } });
      return new Promise<HumanResponse>((resolve, reject) => {
        bridge.pendingHumanInput.set(requestId, { resolve, reject });
      });
    };

    const runner = await EnhancedRunner.create({
      llmClient,
      model: llmModel,
      workspacePath: options.workspacePath,
      sandbox: options.sandbox ?? true,
      thinkingEnabled: options.thinkingEnabled ?? true,
      builtinTools: options.builtinTools,
      enableSession: options.enableSession ?? true,
      enableTodolist: options.enableTodolist ?? true,
      enableCommands: options.enableCommands ?? true,
      a2ui: options.a2ui,
      skillDirs: options.skillDirs,
      mcpConfigPaths: options.mcpConfigPaths ?? [],
      sessionBaseDir: options.sessionBaseDir,
      askHumanHandler,
    });

    // Resume from previous state if available
    let state: AgentState;
    if (options.sessionStore && options.sessionId) {
      const previousState = await options.sessionStore.loadState(options.sessionId);
      if (previousState) {
        state = previousState;
      } else {
        state = createAgentState({
          name: options.agentName,
          tools: [],
          instructions: options.agentInstructions ?? DEFAULT_INSTRUCTIONS,
        });
      }
    } else {
      state = createAgentState({
        name: options.agentName,
        tools: [],
        instructions: options.agentInstructions ?? DEFAULT_INSTRUCTIONS,
      });
    }

    return new AgentSession(runner, state, bridge, options);
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
      await this.sessionStore.saveState(this.sessionId, this.state);
    }
  }

  /**
   * Set cockpit event sender for SSE streaming.
   *
   * @param sender - Callback that receives SSE events, or null to clear
   */
  setCockpitSender(sender: ((event: SSEEvent) => void) | null): void {
    this.bridge.cockpitSender = sender;
  }

  /**
   * Send current AgentState to cockpit.
   *
   * Called after each conversation round completes.
   */
  sendStateSnapshot(): void {
    this.bridge.cockpitSender?.({ event: 'agent-state', data: this.state });
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
   * @yields SSEEvent for each event in the agent execution stream
   */
  async *handleMessage(message: string): AsyncIterable<SSEEvent> {
    if (this._busy) {
      yield { event: 'error', data: { message: 'Session is busy processing a message' } };
      return;
    }
    this._busy = true;
    this.abortController = new AbortController();
    this.eventQueue = [];
    this.eventWaiters = [];

    this.bridge.sseSender = (event: SSEEvent) => this.pushEvent(event);
    this.state = addUserMessage(this.state, message);

    const consumeStream = async () => {
      try {
        const stream = this.runner.runStream(this.state, {
          signal: this.abortController!.signal,
        });

        const iterator = stream[Symbol.asyncIterator]();
        let iterResult = await iterator.next();
        while (!iterResult.done) {
          const mapped = AgentSession.mapEvent(iterResult.value as RunStreamEvent);
          const events = Array.isArray(mapped) ? mapped : [mapped];
          for (const sse of events) {
            this.pushEvent(sse);
            this.bridge.cockpitSender?.(sse);
          }
          iterResult = await iterator.next();
        }
        // Generator return value contains final state
        if (iterResult.value?.state) {
          this.state = iterResult.value.state;
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          this.pushEvent({ event: 'done', data: { aborted: true } });
        } else {
          this.pushEvent({ event: 'error', data: { message: String(err) } });
        }
      } finally {
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
    return new Promise((resolve) => {
      this.eventWaiters.push(resolve);
    });
  }

  private signalDone(): void {
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
  static mapEvent(event: RunStreamEvent): SSEEvent | SSEEvent[] {
    switch (event.type) {
      case 'step:start':
        return { event: 'step-start', data: { step: event.step } };

      case 'step:end':
        return { event: 'step-end', data: { step: event.step } };

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
            id: event.action.id,
            name: event.action.tool,
            args: event.action.arguments,
          },
        };

      case 'tools:start':
        return event.actions.map((action) => ({
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
        return Object.entries(event.results).map(([callId, result]) => ({
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
        return { event: 'subagent-start', data: { name: event.name, task: event.task } };

      case 'subagent:end':
        return {
          event: 'subagent-end',
          data: {
            name: event.name,
            result: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
          },
        };

      case 'llm:request':
        return {
          event: 'llm-request',
          data: {
            messages: event.messages,
            tools: event.tools,
            skill: event.skill,
          },
        };

      case 'llm:response':
        return {
          event: 'llm-response',
          data: {
            text: event.text,
            toolCalls: event.toolCalls,
          },
        };

      case 'compressing':
        return { event: 'compressing', data: {} };

      case 'compressed':
        return {
          event: 'compressed',
          data: { summary: event.summary, removedCount: event.removedCount },
        };

      case 'waiting-human':
        return { event: 'waiting-human', data: { request: event.request } };

      case 'complete':
        return { event: 'done', data: {} };

      case 'error':
        return { event: 'error', data: { message: event.error.message } };
    }
  }
}
