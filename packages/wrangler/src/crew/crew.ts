import type {
  CrewConfig,
  CrewOptions,
  CrewInput,
  CrewOutputEvent,
  CrewState,
  CrewEventHandler,
  AgentInstanceInfo,
  TaskInfo,
} from './types.js';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { AgentInstance } from './agent-instance.js';
import { MessageRouter } from './message-router.js';
import { CrewTodoList } from './crew-todolist.js';
import { buildLiaisonPrompt } from './liaison-prompt.js';
import {
  createCreateTaskTool,
  createSendMessageTool,
  createRelayToPrimaryTool,
  createReadCrewTodolistTool,
  createUpdateCrewTodolistTool,
} from './crew-tools.js';

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
  private scheduling = false;

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
      todolist: this.todolist.snapshot(),
    });
  }

  pushInput(input: CrewInput): void {
    if (input.type === 'stop') {
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

  // ─── Scheduling loop ───

  private runScheduler(): void {
    if (this.scheduling) return;
    this.scheduling = true;
    this._status = 'running';

    this.scheduleLoop().finally(() => {
      this.scheduling = false;
      if (!this.hasPendingWork()) {
        this._status = 'idle';
      }
    });
  }

  private async scheduleLoop(): Promise<void> {
    let maxIterations = 100;
    while (maxIterations-- > 0) {
      let didWork = false;

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

        try {
          await this.advanceAgent(agent, messages);
        } catch (e) {
          this.emit({
            type: 'error',
            error: e instanceof Error ? e : new Error(String(e)),
          });
        } finally {
          agent.setIdle();
        }

        didWork = true;
        break; // restart loop to pick up new messages from tool calls
      }

      if (!didWork) break;
    }
  }

  // ─── Agent advancement ───

  private async advanceAgent(
    agent: AgentInstance,
    messages: import('./types.js').CrewMessage[]
  ): Promise<void> {
    this.ensureRunner(agent);

    // Inject crew messages into agent state as user messages
    let state = agent.agentState!;
    for (const msg of messages) {
      const prefix = msg.from === 'user' ? '' : `[${msg.from}] `;
      state = addUserMessage(state, prefix + msg.content);
    }

    // Run the agent (ReAct loop until completion)
    const runResult = await agent.runner!.run(state);
    agent.agentState = runResult.state;

    // Emit user_response only for primary when no pending tasks remain
    if (runResult.result.type === 'success' && agent.role === 'primary') {
      const hasPending = [...this.tasks.values()].some((t) => t.status === 'running');
      if (!hasPending) {
        this.emit({ type: 'user_response', content: runResult.result.answer });
      }
    }
  }

  // ─── Runner setup ───

  private ensureRunner(agent: AgentInstance): void {
    if (agent.runner) return;

    const model = this.options.defaultModel ?? 'gpt-4';
    const agentDef = this.config.agentDefs[agent.definitionName];
    const instructions = agentDef?.instructions ?? `You are a ${agent.definitionName} agent.`;

    const tools = this.createToolsForRole(agent);
    const systemPrompt =
      agent.role === 'liaison'
        ? buildLiaisonPrompt({
            workerType: agent.partnerId
              ? (this.agents.get(agent.partnerId)?.definitionName ?? 'worker')
              : 'worker',
            memory: this.config.memory,
          })
        : instructions;

    const runner = new AgentRunner({
      model,
      llmClient: this.options.llmClient,
      tools,
      systemPrompt,
    });

    agent.runner = runner;
    agent.agentState = createAgentState({
      name: agent.definitionName,
      instructions: systemPrompt,
      tools: [],
    });
  }

  private createToolsForRole(
    agent: AgentInstance
  ): import('@agentskillmania/colts').Tool<import('zod').ZodTypeAny>[] {
    const todolistTools = [
      createReadCrewTodolistTool({ getTodolist: () => [...this.todolist.items] }),
      createUpdateCrewTodolistTool({
        onUpdate: async (itemId, status) => {
          this.todolist.update(itemId, status);
          this.emit({ type: 'todolist_updated', todolist: this.todolist.snapshot() });
        },
      }),
    ];

    switch (agent.role) {
      case 'primary':
        return [
          createCreateTaskTool({
            onCreateTask: async (workerType, task) => this.createTask(workerType, task, agent.id),
          }),
          createSendMessageTool({
            onSend: async (to, content) => {
              this.router.enqueue(to, { from: agent.id, content, timestamp: Date.now() });
            },
          }),
          ...todolistTools,
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
              // Mark task as completed when liaison relays result back
              if (agent.taskId) {
                const task = this.tasks.get(agent.taskId);
                if (task) {
                  this.tasks.set(agent.taskId, { ...task, status: 'completed' });
                }
              }
            },
          }),
          ...todolistTools,
        ];

      case 'worker':
        return [...todolistTools];
    }
  }

  // ─── Task creation ───

  private createTask(workerType: string, description: string, primaryId: string): string {
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

    // Create worker
    const worker = this.createAgentInstance('worker', workerType, workerId, liaisonId, taskId);
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
    role: import('./types.js').AgentRole,
    definitionName: string,
    id?: string,
    partnerId?: string,
    taskId?: string
  ): AgentInstance {
    const instance = new AgentInstance({
      id: id ?? `${role}-${++this.agentIdCounter}`,
      role,
      definitionName,
      partnerId,
      taskId,
    });
    return instance;
  }

  // ─── Helpers ───

  private findPrimary(): AgentInstance | undefined {
    for (const agent of this.agents.values()) {
      if (agent.role === 'primary') return agent;
    }
    return undefined;
  }

  private hasPendingWork(): boolean {
    for (const agent of this.agents.values()) {
      if (agent.hasMessages) return true;
    }
    return this.router.agentsWithMessages().length > 0;
  }
}
