import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentState, Tool } from '@agentskillmania/colts';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import { AgentInstance } from './agent-instance.js';
import { createCreateTaskTool, createSendMessageTool } from './crew-tools.js';
import { MessageRouter } from './message-router.js';
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
import { EnhancedRunner } from '../runner/enhanced-runner.js';
import { BingScrapeSearchProvider } from '../tools/builtin/bing-scrape-search.js';
import { discoverGlobalConfigPath } from '../tools/mcp/config-merger.js';

export class Crew {
  private config: CrewConfig;
  private options: CrewOptions;
  private agents = new Map<string, AgentInstance>();
  private tasks = new Map<string, TaskInfo>();
  private router = new MessageRouter();
  private handlers = new Map<string, Set<CrewEventHandler>>();
  private _status: CrewState['status'] = 'idle';
  private _id: string;
  private primaryId = '';
  private taskIdCounter = 0;
  private agentIdCounter = 0;
  private abortController = new AbortController();
  // CONC3: total scheduling budget — prevents infinite inter-agent message loops
  private totalRounds = 0;
  private static readonly MAX_TOTAL_ROUNDS = 500;

  constructor(config: CrewConfig, options: CrewOptions) {
    this.config = config;
    this.options = options;
    this._id = `crew-${Date.now()}`;
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
    // Reset advanceCount for all agents on new user message
    for (const agent of this.agents.values()) {
      agent.advanceCount = 0;
    }

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
    // CONC3: enforce crew-level total scheduling budget to prevent infinite
    // inter-agent message loops (A→B→A→B... each agent stays under its own
    // MAX_ADVANCES=200, but the crew as a whole can loop indefinitely).
    this.totalRounds++;
    if (this.totalRounds > Crew.MAX_TOTAL_ROUNDS) {
      this._status = 'stopped';
      this.emit({
        type: 'error',
        error: new Error(
          `Crew exceeded total scheduling budget (${Crew.MAX_TOTAL_ROUNDS} rounds). Possible infinite message loop between agents.`
        ),
      });
      return;
    }

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
    const MAX_ADVANCES = 200;
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

    await this.ensureRunner(agent);

    // Inject crew messages into agent state as user messages
    let state = agent.agentState!;
    for (const msg of messages) {
      const prefix = msg.from === 'user' ? '' : `[${msg.from}] `;
      state = addUserMessage(state, prefix + msg.content);
    }

    // Run the agent (ReAct loop until completion)
    const runResult = await agent.runner!.run(state, {
      signal: this.abortController.signal,
    });
    agent.agentState = runResult.state as AgentState;

    if (runResult.result.type === 'success') {
      const answer = runResult.result.answer ?? '';

      // Worker → auto-route result directly to Primary
      if (agent.role === 'worker') {
        this.router.enqueue(this.primaryId, {
          from: agent.id,
          content: answer,
          timestamp: Date.now(),
        });

        // Mark task as completed with the actual result
        if (agent.taskId) {
          this.completeTask(agent.taskId, answer);
        }
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

      // Route error to Primary so upstream knows
      if (agent.role === 'worker') {
        this.router.enqueue(this.primaryId, {
          from: agent.id,
          content: `[error] ${errorMsg}`,
          timestamp: Date.now(),
        });
      }

      // Primary always emits user_response on failure so the caller knows
      if (agent.role === 'primary') {
        this.emit({ type: 'user_response', content: `Error: ${errorMsg}` });
      }
    }
  }

  // ─── Runner setup ───

  private async ensureRunner(agent: AgentInstance): Promise<void> {
    if (agent.runner) return;

    const agentDef = this.config.agentDefs[agent.definitionName];
    const model = agentDef?.model ?? this.options.defaultModel ?? 'gpt-4';

    // Resolve sandbox: agent-level > crew-level > false
    const useSandbox = agentDef?.sandbox ?? this.config.meta.sandbox ?? false;

    // Custom instructions take priority for ad-hoc workers, then catalog definition
    const instructions =
      agent.customInstructions ??
      agentDef?.instructions ??
      `You are a ${agent.definitionName} agent.`;

    let systemPrompt = instructions;

    // Inject agent catalog into Primary context
    if (agent.role === 'primary') {
      systemPrompt += '\n\n' + this.buildAgentCatalog();
    }

    const commTools = this.createCommTools(agent);
    const runner = await EnhancedRunner.create({
      llmClient: this.options.llmClient,
      model,
      workspacePath: this.options.workspaceDeps?.workspacePath ?? process.cwd(),
      extraTools: commTools,
      mcpConfigPaths: this.buildMCPConfigPaths(),
      searchProvider: this.options.searchProvider ?? new BingScrapeSearchProvider(),
      skillDirs: [...this.config.skillDirs],
      thinkingEnabled: agentDef?.thinking?.enabled,
      sandbox: useSandbox,
    });

    // Track callId → toolName for tool:end mapping
    const pendingToolNames = new Map<string, string>();

    runner.on('tool:start', (e: unknown) => {
      const event = e as { action: { id: string; tool: string; arguments: unknown } };
      pendingToolNames.set(event.action.id, event.action.tool);
      this.emit({
        type: 'tool_invoked',
        agentId: agent.id,
        toolName: event.action.tool,
        args: event.action.arguments,
      });
    });

    runner.on('tool:end', (e: unknown) => {
      const event = e as { result: unknown; callId?: string };
      const toolName = (event.callId && pendingToolNames.get(event.callId)) ?? 'unknown';
      if (event.callId) pendingToolNames.delete(event.callId);
      this.emit({
        type: 'tool_completed',
        agentId: agent.id,
        toolName,
        result: String(event.result),
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

      case 'worker':
        return [];
    }
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
    const workerId = `worker-${++this.agentIdCounter}`;

    // Create worker with partnerId pointing to Primary
    const worker = this.createAgentInstance(
      'worker',
      workerType,
      workerId,
      primaryId,
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
      createdAt: Date.now(),
    });

    this.emit({ type: 'task_started', taskId, workerType, description });

    // Enqueue task description directly to worker
    this.router.enqueue(workerId, {
      from: primaryId,
      content: description,
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
      }
    }
  }

  private completeTask(taskId: string, result: string): void {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'running') {
      this.tasks.set(taskId, { ...task, status: 'completed', result, completedAt: Date.now() });
      this.emit({ type: 'task_completed', taskId, result });
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
    const crewDir = this.options.workspaceDeps?.workspacePath;
    if (crewDir) {
      const crewMcp = join(crewDir, 'mcp.json');
      if (existsSync(crewMcp)) {
        paths.push(crewMcp);
      }
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
      const desc = def.description ?? 'No description';
      lines.push(`- ${name}: ${desc}`);
    }
    return lines.join('\n');
  }
}
