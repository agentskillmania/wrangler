import type {
  CrewConfig,
  CrewOptions,
  CrewInput,
  CrewOutputEvent,
  CrewState,
  CrewEventHandler,
  AgentInstanceInfo,
  TaskInfo,
  CrewMessage,
  AgentRole,
} from './types.js';
import type { Tool, AgentState } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { AgentInstance } from './agent-instance.js';
import { MessageRouter } from './message-router.js';
import { CrewTodoList } from './crew-todolist.js';
import { buildLiaisonPrompt } from './liaison-prompt.js';
import { buildTimeContext } from '../agent/system-prompt.js';
import {
  createCreateTaskTool,
  createSendMessageTool,
  createRelayToPrimaryTool,
  createReadCrewTodolistTool,
  createUpdateCrewTodolistTool,
} from './crew-tools.js';
import { createBuiltinTools } from '../tools/builtin/index.js';
import { loadMCPTools } from '../tools/mcp/index.js';
import { discoverGlobalConfigPath } from '../tools/mcp/config-merger.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export class Crew {
  private config: CrewConfig;
  private options: CrewOptions;
  private agents = new Map<string, AgentInstance>();
  private tasks = new Map<string, TaskInfo>();
  private todolist = new CrewTodoList();
  private router = new MessageRouter();
  private handlers = new Map<string, Set<CrewEventHandler>>();
  private _status: CrewState['status'] = 'idle';
  private _id: string;
  private primaryId = '';
  private taskIdCounter = 0;
  private agentIdCounter = 0;
  private abortController = new AbortController();
  private builtinTools: Tool<ZodTypeAny>[];
  private mcpTools: Tool<ZodTypeAny>[] = [];
  private mcpToolsLoaded = false;
  private todoIdByTaskId = new Map<string, string>();

  constructor(config: CrewConfig, options: CrewOptions) {
    this.config = config;
    this.options = options;
    this._id = `crew-${Date.now()}`;
    this.builtinTools = createBuiltinTools({
      workspacePath: options.workspaceDeps?.workspacePath ?? process.cwd(),
      searchProvider: options.searchProvider,
      sandbox: options.sandbox,
    });
  }

  get state(): CrewState {
    const agents = new Map<string, AgentInstanceInfo>();
    for (const [id, agent] of this.agents) {
      agents.set(id, agent.toInfo());
    }
    return Object.freeze({
      id: this._id,
      status: this._status,
      primaryId: this.primaryId,
      agents,
      tasks: new Map(this.tasks),
      todolist: this.todolist.snapshot(),
    });
  }

  pushInput(input: CrewInput): void {
    if (input.type === 'stop') {
      this.abortController.abort();
      this._status = 'stopped';
      return;
    }
    if (input.type === 'user_message') {
      this.handleUserMessage(input.content);
    }
  }

  on(event: string, handler: CrewEventHandler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  private emit(event: CrewOutputEvent): void {
    const set = this.handlers.get(event.type);
    if (set) {
      for (const handler of set) {
        handler(event);
      }
    }
  }

  // ─── User message handling ───

  private handleUserMessage(content: string): void {
    let primary = this.findPrimary();
    if (!primary) {
      primary = this.createAgentInstance('primary', this.config.meta.primaryAgent);
      this.primaryId = primary.id;
      this.agents.set(primary.id, primary);
      this.emit({
        type: 'agent_created',
        agentId: primary.id,
        role: 'primary',
        definitionName: this.config.meta.primaryAgent,
      });
    }

    this.router.enqueue(primary.id, { from: 'user', content, timestamp: Date.now() });
    this.runScheduler();
  }

  // ─── Scheduling — fire-and-forget ───

  private runScheduler(): void {
    this._status = 'running';
    this.scheduleRound();
  }

  /** Start advancing all idle agents with messages. Returns immediately. */
  private scheduleRound(): void {
    for (const agent of this.agents.values()) {
      if (agent.status !== 'idle') continue;

      // Transfer messages from router to agent's queue
      const routed = this.router.dequeue(agent.id);
      for (const msg of routed) {
        agent.enqueue(msg);
      }

      if (!agent.hasMessages) continue;

      const messages = agent.dequeue();
      agent.setRunning();

      // Fire-and-forget: advance independently, callback triggers next round
      this.advanceAgent(agent, messages)
        .catch((e) => {
          this.emit({
            type: 'error',
            error: e instanceof Error ? e : new Error(String(e)),
          });
        })
        .finally(() => {
          agent.setIdle();
          // Check if crew was stopped
          if (this._status === 'stopped') return;
          // Agent completion may have produced auto-routed messages or tool calls
          // that created new agents — kick a new scheduling round
          this.scheduleRound();
          // Emit user_response for primary when all work is truly done
          if (
            agent.role === 'primary' &&
            !this.hasRunningTasks() &&
            !this.hasRunningAgents() &&
            !this.hasPendingWork()
          ) {
            const answer = agent.lastAnswer ?? '';
            this.emit({ type: 'user_response', content: answer });
          }
          // Update overall status
          if (!this.hasPendingWork() && !this.hasRunningAgents()) {
            this._status = 'idle';
          }
        });
    }
  }

  // ─── Agent advancement ───

  private async advanceAgent(agent: AgentInstance, messages: CrewMessage[]): Promise<void> {
    // Max-hop guard: prevent infinite auto-routing loops
    const MAX_ADVANCES = 50;
    agent.advanceCount++;
    if (agent.advanceCount > MAX_ADVANCES) {
      this.emit({
        type: 'error',
        error: new Error(
          `Agent ${agent.id} exceeded max advances (${MAX_ADVANCES}). Possible infinite routing loop.`
        ),
      });
      this.failAgentTask(agent, 'Exceeded max advances');
      return;
    }

    this.ensureRunner(agent);

    // Reset relay flag at start of each advance
    agent.relayFlag = false;

    // Inject crew messages into agent state as user messages
    let state = agent.agentState!;
    for (const msg of messages) {
      const prefix = msg.from === 'user' ? '' : `[${msg.from}] `;
      state = addUserMessage(state, prefix + msg.content);
    }

    // Run the agent (ReAct loop until completion)
    const startTime = Date.now();
    const runResult = await agent.runner!.run(state, {
      signal: this.abortController.signal,
    });
    const duration = Date.now() - startTime;
    agent.agentState = runResult.state as AgentState;

    this.emit({
      type: 'agent_advanced',
      agentId: agent.id,
      role: agent.role,
      duration,
      resultType: runResult.result.type,
    });

    if (runResult.result.type === 'success') {
      const answer = runResult.result.answer ?? '';

      // Worker → auto-route to Liaison
      if (agent.role === 'worker' && agent.partnerId) {
        this.router.enqueue(agent.partnerId, {
          from: agent.id,
          content: answer,
          timestamp: Date.now(),
        });
        this.emit({
          type: 'message_routed',
          from: agent.id,
          to: agent.partnerId,
          contentPreview: answer.slice(0, 100),
        });
      }

      // Liaison → auto-route to Worker (unless relay_to_primary was called)
      if (agent.role === 'liaison' && !agent.relayFlag && agent.partnerId) {
        this.router.enqueue(agent.partnerId, {
          from: agent.id,
          content: answer,
          timestamp: Date.now(),
        });
        this.emit({
          type: 'message_routed',
          from: agent.id,
          to: agent.partnerId,
          contentPreview: answer.slice(0, 100),
        });
      }

      // Save answer for potential user_response emission in .finally()
      if (agent.role === 'primary') {
        agent.lastAnswer = answer;
      }
    } else {
      // Handle non-success results: error, max_steps, abort
      const errResult = runResult.result;
      const errorMsg =
        errResult.type === 'error'
          ? (errResult as { error: Error }).error.message
          : `Agent run ended with status: ${errResult.type}`;

      this.emit({
        type: 'error',
        error: new Error(`Agent ${agent.id} (${agent.role}): ${errorMsg}`),
      });

      this.failAgentTask(agent, errorMsg);

      // Route error to partner so upstream knows
      if (agent.partnerId) {
        this.router.enqueue(agent.partnerId, {
          from: agent.id,
          content: `[error] ${errorMsg}`,
          timestamp: Date.now(),
        });
        this.emit({
          type: 'message_routed',
          from: agent.id,
          to: agent.partnerId,
          contentPreview: `[error] ${errorMsg}`,
        });
      }

      // Primary always emits user_response on failure so the caller knows
      if (agent.role === 'primary') {
        this.emit({ type: 'user_response', content: `Error: ${errorMsg}` });
      }
    }
  }

  // ─── Runner setup ───

  private ensureRunner(agent: AgentInstance): void {
    if (agent.runner) return;

    const agentDef = this.config.agentDefs[agent.definitionName];
    const model = agentDef?.meta?.model ?? this.options.defaultModel ?? 'gpt-4';

    // Custom instructions take priority for ad-hoc workers, then catalog definition
    const instructions =
      agent.customInstructions ??
      agentDef?.instructions ??
      `You are a ${agent.definitionName} agent.`;

    // Load MCP tools once (lazy loading on first agent creation)
    if (!this.mcpToolsLoaded) {
      const mcpConfigPaths = this.buildMCPConfigPaths();
      loadMCPTools({ configPaths: mcpConfigPaths })
        .then((tools) => {
          this.mcpTools = tools;
          this.mcpToolsLoaded = true;
        })
        .catch(() => {
          // MCP tools are optional - failure is OK
          this.mcpToolsLoaded = true;
        });
    }

    const tools = this.createToolsForRole(agent);
    let systemPrompt =
      agent.role === 'liaison'
        ? buildLiaisonPrompt({
            workerType: agent.partnerId
              ? (this.agents.get(agent.partnerId)?.definitionName ?? 'worker')
              : 'worker',
            memory: this.config.memory,
          })
        : instructions;

    // Inject agent catalog into Primary context
    if (agent.role === 'primary') {
      systemPrompt += '\n\n' + this.buildAgentCatalog();
    }

    // Runner gets time context; state gets the assembled agent prompt.
    // The message assembler combines both into the final system message.
    const runnerOptions = {
      model,
      llmClient: this.options.llmClient,
      tools,
      systemPrompt: buildTimeContext(),
      skillDirectories: [...this.config.skillDirs],
    };
    const runner = this.options.runnerFactory
      ? this.options.runnerFactory(runnerOptions)
      : new AgentRunner(runnerOptions);

    // Track callId → toolName for tool:end mapping
    const pendingToolNames = new Map<string, string>();

    runner.on('tool:start', (e: { action: { id: string; tool: string; arguments: unknown } }) => {
      pendingToolNames.set(e.action.id, e.action.tool);
      this.emit({
        type: 'tool_invoked',
        agentId: agent.id,
        toolName: e.action.tool,
        args: e.action.arguments,
      });
    });

    runner.on('tool:end', (e: { result: unknown; callId?: string }) => {
      const toolName = (e.callId && pendingToolNames.get(e.callId)) ?? 'unknown';
      if (e.callId) pendingToolNames.delete(e.callId);
      this.emit({
        type: 'tool_completed',
        agentId: agent.id,
        toolName,
        result: String(e.result),
        duration: 0,
      });
    });

    agent.runner = runner;
    agent.agentState = createAgentState({
      name: agent.definitionName,
      instructions: systemPrompt,
      tools: [],
    });
  }

  private createToolsForRole(agent: AgentInstance): Tool<ZodTypeAny>[] {
    return [
      ...this.createCommTools(agent),
      ...this.builtinTools,
      ...this.mcpTools,
      ...this.createTodolistTools(),
    ];
  }

  private createCommTools(agent: AgentInstance): Tool<ZodTypeAny>[] {
    switch (agent.role) {
      case 'primary':
        return [
          createCreateTaskTool({
            onCreateTask: async (workerType, task, instructions) =>
              this.createTask(workerType, task, agent.id, instructions),
          }),
          createSendMessageTool({
            onSend: async (to, content) => {
              this.router.enqueue(to, { from: agent.id, content, timestamp: Date.now() });
            },
          }),
        ];

      case 'liaison':
        return [
          createRelayToPrimaryTool({
            onRelay: async (content) => {
              this.router.enqueue(this.primaryId, {
                from: agent.id,
                content,
                timestamp: Date.now(),
              });
              agent.relayFlag = true;
              if (agent.taskId) {
                this.completeTask(agent.taskId);
              }
            },
          }),
        ];

      case 'worker':
        return [];
    }
  }

  private createTodolistTools(): Tool<ZodTypeAny>[] {
    return [
      createReadCrewTodolistTool({ getTodolist: () => [...this.todolist.items] }),
      createUpdateCrewTodolistTool({
        onUpdate: async (itemId, status) => {
          this.todolist.update(itemId, status);
          this.emit({ type: 'todolist_updated', todolist: this.todolist.snapshot() });
        },
      }),
    ];
  }

  // ─── Task creation ───

  private createTask(
    workerType: string,
    description: string,
    primaryId: string,
    instructions?: string
  ): string {
    // Resolve worker definition from catalog or ad-hoc instructions
    const workerDef = this.config.agentDefs[workerType];
    if (!workerDef && !instructions) {
      throw new Error(
        `Unknown worker type: ${workerType}. Available: ${Object.keys(this.config.agentDefs).join(', ')}. Or provide instructions.`
      );
    }

    const taskId = `task-${++this.taskIdCounter}`;
    const liaisonId = `liaison-${++this.agentIdCounter}`;
    const workerId = `worker-${this.agentIdCounter}`;

    // Create liaison
    const liaison = this.createAgentInstance('liaison', 'liaison', liaisonId, workerId, taskId);
    this.agents.set(liaison.id, liaison);
    this.emit({
      type: 'agent_created',
      agentId: liaison.id,
      role: 'liaison',
      definitionName: 'liaison',
    });

    // Create worker (with optional custom instructions for ad-hoc creation)
    const worker = this.createAgentInstance(
      'worker',
      workerType,
      workerId,
      liaisonId,
      taskId,
      instructions
    );
    this.agents.set(worker.id, worker);
    this.emit({
      type: 'agent_created',
      agentId: worker.id,
      role: 'worker',
      definitionName: workerType,
    });

    // Store task
    this.tasks.set(taskId, {
      id: taskId,
      workerDefinitionName: workerType,
      description,
      status: 'running',
      workerId,
      liaisonId,
      createdAt: Date.now(),
    });

    this.emit({ type: 'task_started', taskId, workerType, description });

    // Auto-populate todolist so agents can track progress
    const todoId = this.todolist.add(`${workerType}: ${description}`, workerId);
    this.todoIdByTaskId.set(taskId, todoId);
    this.todolist.update(todoId, 'in_progress');
    this.emit({ type: 'todolist_updated', todolist: this.todolist.snapshot() });

    // Enqueue task description to liaison
    this.router.enqueue(liaisonId, {
      from: primaryId,
      content: `新任务：${description}，请传达给 ${workerType}`,
      timestamp: Date.now(),
    });

    return taskId;
  }

  // ─── Agent instance factory ───

  private createAgentInstance(
    role: AgentRole,
    definitionName: string,
    id?: string,
    partnerId?: string,
    taskId?: string,
    customInstructions?: string
  ): AgentInstance {
    const instance = new AgentInstance({
      id: id ?? `${role}-${++this.agentIdCounter}`,
      role,
      definitionName,
      partnerId,
      taskId,
      customInstructions,
    });
    return instance;
  }

  // ─── Helpers ───

  private failAgentTask(agent: AgentInstance, reason: string): void {
    if (agent.taskId) {
      const task = this.tasks.get(agent.taskId);
      if (task && task.status === 'running') {
        this.tasks.set(agent.taskId, { ...task, status: 'failed' });
        this.emit({ type: 'task_failed', taskId: agent.taskId, error: reason });
        this.updateTodoForTask(agent.taskId, 'pending');
      }
    }
  }

  private completeTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'running') {
      this.tasks.set(taskId, { ...task, status: 'completed' });
      this.emit({ type: 'task_completed', taskId, result: '' });
      this.updateTodoForTask(taskId, 'completed');
    }
  }

  private updateTodoForTask(taskId: string, status: 'pending' | 'in_progress' | 'completed'): void {
    const todoId = this.todoIdByTaskId.get(taskId);
    if (todoId) {
      this.todolist.update(todoId, status);
      this.emit({ type: 'todolist_updated', todolist: this.todolist.snapshot() });
    }
  }

  private findPrimary(): AgentInstance | undefined {
    for (const agent of this.agents.values()) {
      if (agent.role === 'primary') return agent;
    }
    return undefined;
  }

  private hasRunningTasks(): boolean {
    for (const task of this.tasks.values()) {
      if (task.status === 'running') return true;
    }
    return false;
  }

  private hasPendingWork(): boolean {
    for (const agent of this.agents.values()) {
      if (agent.hasMessages) return true;
    }
    return this.router.agentsWithMessages().length > 0;
  }

  private hasRunningAgents(): boolean {
    for (const agent of this.agents.values()) {
      if (agent.status === 'running') return true;
    }
    return false;
  }

  private buildMCPConfigPaths(): string[] {
    // Explicit config takes priority
    if (this.options.mcpConfigPaths !== undefined) {
      return this.options.mcpConfigPaths;
    }

    const paths: string[] = [];
    const globalPath = discoverGlobalConfigPath();
    if (existsSync(globalPath)) {
      paths.push(globalPath);
    }
    const localPath = join(this.options.workspaceDeps?.workspacePath ?? process.cwd(), 'mcp.json');
    if (existsSync(localPath)) {
      paths.push(localPath);
    }
    return paths;
  }

  private buildAgentCatalog(): string {
    const entries = Object.entries(this.config.agentDefs).filter(
      ([name]) => name !== this.config.meta.primaryAgent
    );
    if (entries.length === 0) return 'No predefined worker agents available.';

    const lines = ['Available worker agents (prefer these over ad-hoc creation):'];
    for (const [name, def] of entries) {
      const desc = def.meta.description ?? 'No description';
      lines.push(`- ${name}: ${desc}`);
    }
    return lines.join('\n');
  }
}
