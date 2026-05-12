import type {
  AgentRole,
  AgentInstanceInfo,
  AgentInstanceStatus,
  CrewMessage,
  CrewRunner,
} from './types.js';
import type { AgentState } from '@agentskillmania/colts';

export interface AgentInstanceOptions {
  id: string;
  role: AgentRole;
  definitionName: string;
  partnerId?: string;
  taskId?: string;
  customInstructions?: string;
}

export class AgentInstance {
  readonly id: string;
  readonly role: AgentRole;
  readonly definitionName: string;
  readonly partnerId?: string;
  readonly taskId?: string;
  readonly customInstructions?: string;

  private _status: AgentInstanceStatus = 'idle';
  private _queue: CrewMessage[] = [];

  /** colts runner — set by Crew when creating the agent */
  runner?: CrewRunner;
  /** colts agent state — updated each advance, persisted across turns */
  agentState?: AgentState;
  /** Set when relay_to_primary is called during current advance; blocks auto-route to Worker */
  relayFlag = false;
  /** Number of times this agent has been advanced; used to detect infinite routing loops */
  advanceCount = 0;

  constructor(options: AgentInstanceOptions) {
    this.id = options.id;
    this.role = options.role;
    this.definitionName = options.definitionName;
    this.partnerId = options.partnerId;
    this.taskId = options.taskId;
    this.customInstructions = options.customInstructions;
  }

  get status(): AgentInstanceStatus {
    return this._status;
  }

  get queueSize(): number {
    return this._queue.length;
  }

  get hasMessages(): boolean {
    return this._queue.length > 0;
  }

  enqueue(message: CrewMessage): void {
    this._queue.push(message);
  }

  dequeue(): CrewMessage[] {
    const msgs = [...this._queue];
    this._queue = [];
    return msgs;
  }

  setRunning(): void {
    this._status = 'running';
  }

  setIdle(): void {
    this._status = 'idle';
  }

  toInfo(): AgentInstanceInfo {
    return {
      id: this.id,
      role: this.role,
      definitionName: this.definitionName,
      status: this._status,
      partnerId: this.partnerId,
      taskId: this.taskId,
      queueSize: this._queue.length,
    };
  }
}
