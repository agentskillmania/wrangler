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
import { AgentInstance } from './agent-instance.js';
import { MessageRouter } from './message-router.js';
import { Scheduler } from './scheduler.js';
import { CrewTodoList } from './crew-todolist.js';

export class Crew {
  private config: CrewConfig;
  private options: CrewOptions;
  private agents = new Map<string, AgentInstance>();
  private tasks = new Map<string, TaskInfo>();
  private todolist = new CrewTodoList();
  private router = new MessageRouter();
  private scheduler: Scheduler;
  private handlers = new Map<string, Set<CrewEventHandler>>();
  private _status: CrewState['status'] = 'idle';
  private _id: string;
  private primaryId = '';
  private taskIdCounter = 0;

  constructor(config: CrewConfig, options: CrewOptions) {
    this.config = config;
    this.options = options;
    this._id = `crew-${Date.now()}`;
    this.scheduler = new Scheduler({
      router: this.router,
      onAdvance: (agent) => this.advanceAgent(agent),
      emit: (e) => this.emit(e),
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

  private handleUserMessage(content: string): void {
    let primary = this.findPrimary();
    if (!primary) {
      primary = new AgentInstance({
        id: 'primary-1',
        role: 'primary',
        definitionName: this.config.meta.primaryAgent,
      });
      this.agents.set(primary.id, primary);
      this.primaryId = primary.id;
      this.emit({
        type: 'agent_created',
        agentId: primary.id,
        role: 'primary',
        definitionName: this.config.meta.primaryAgent,
      });
    }

    this.router.enqueue(primary.id, { from: 'user', content, timestamp: Date.now() });

    this._status = 'running';
    this.scheduler.scheduleOnce(this.agents).then(() => {
      if (!this.hasPendingWork()) {
        this._status = 'idle';
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async advanceAgent(_agent: AgentInstance): Promise<void> {
    // Will be implemented in integration layer:
    // 1. Create colts AgentRunner for this agent
    // 2. Inject dequeued messages as crew messages
    // 3. Advance the agent
    // 4. Process tool calls (route messages, create tasks, etc.)
  }

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
