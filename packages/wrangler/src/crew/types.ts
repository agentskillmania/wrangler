import type { AgentDefinition } from '../agent/types.js';
import type { ILLMProvider, AskHumanHandler } from '@agentskillmania/colts';

// ─── Agent roles ───

export type AgentRole = 'primary' | 'liaison' | 'worker';

export type AgentInstanceStatus = 'idle' | 'running';

export interface AgentInstanceInfo {
  readonly id: string;
  readonly role: AgentRole;
  readonly definitionName: string;
  readonly status: AgentInstanceStatus;
  readonly partnerId?: string;
  readonly taskId?: string;
  readonly queueSize: number;
}

// ─── Task ───

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TaskInfo {
  readonly id: string;
  readonly workerDefinitionName: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly result?: string;
  readonly workerId: string;
  readonly liaisonId: string;
  readonly createdAt: number;
  readonly completedAt?: number;
}

// ─── Shared todolist ───

export type CrewTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface CrewTodoItem {
  readonly id: string;
  readonly content: string;
  readonly status: CrewTodoStatus;
  readonly assignee?: string;
}

// ─── Crew state (read-only) ───

export type CrewStatus = 'idle' | 'running' | 'stopped' | 'error';

export interface CrewState {
  readonly id: string;
  readonly status: CrewStatus;
  readonly primaryId: string;
  readonly agents: ReadonlyMap<string, AgentInstanceInfo>;
  readonly tasks: ReadonlyMap<string, TaskInfo>;
  readonly todolist: readonly CrewTodoItem[];
}

// ─── External input ───

export type CrewInput = { type: 'user_message'; content: string } | { type: 'stop' };

// ─── External events ───

export interface CrewUserResponseEvent {
  readonly type: 'user_response';
  readonly content: string;
}

export interface CrewTaskStartedEvent {
  readonly type: 'task_started';
  readonly taskId: string;
  readonly workerType: string;
  readonly description: string;
}

export interface CrewTaskCompletedEvent {
  readonly type: 'task_completed';
  readonly taskId: string;
  readonly result: string;
}

export interface CrewTaskFailedEvent {
  readonly type: 'task_failed';
  readonly taskId: string;
  readonly error: string;
}

export interface CrewTodolistUpdatedEvent {
  readonly type: 'todolist_updated';
  readonly todolist: readonly CrewTodoItem[];
}

export interface CrewAgentCreatedEvent {
  readonly type: 'agent_created';
  readonly agentId: string;
  readonly role: AgentRole;
  readonly definitionName: string;
}

export interface CrewAgentDestroyedEvent {
  readonly type: 'agent_destroyed';
  readonly agentId: string;
}

export interface CrewErrorEvent {
  readonly type: 'error';
  readonly error: Error;
}

export interface CrewToolInvokedEvent {
  readonly type: 'tool_invoked';
  readonly agentId: string;
  readonly toolName: string;
  readonly args: unknown;
}

export interface CrewToolCompletedEvent {
  readonly type: 'tool_completed';
  readonly agentId: string;
  readonly toolName: string;
  readonly result: string;
  readonly duration: number;
}

export interface CrewAgentAdvancedEvent {
  readonly type: 'agent_advanced';
  readonly agentId: string;
  readonly role: AgentRole;
  readonly duration: number;
  readonly resultType: string;
}

export interface CrewMessageRoutedEvent {
  readonly type: 'message_routed';
  readonly from: string;
  readonly to: string;
  readonly contentPreview: string;
}

export type CrewOutputEvent =
  | CrewUserResponseEvent
  | CrewTaskStartedEvent
  | CrewTaskCompletedEvent
  | CrewTaskFailedEvent
  | CrewTodolistUpdatedEvent
  | CrewAgentCreatedEvent
  | CrewAgentDestroyedEvent
  | CrewErrorEvent
  | CrewToolInvokedEvent
  | CrewToolCompletedEvent
  | CrewAgentAdvancedEvent
  | CrewMessageRoutedEvent;

export type CrewEventHandler = (event: CrewOutputEvent) => void;

// ─── Internal messages ───

export interface CrewMessage {
  readonly from: string;
  readonly content: string;
  readonly timestamp: number;
}

// ─── Static config ───

export interface CrewConfig {
  readonly meta: {
    readonly name: string;
    readonly description: string;
    readonly primaryAgent: string;
  };
  readonly memory: string;
  readonly agentDefs: Readonly<Record<string, AgentDefinition>>;
  readonly skillDirs: readonly string[];
}

// ─── Crew constructor options ───

export interface CrewOptions {
  readonly llmClient: ILLMProvider;
  readonly defaultModel?: string;
  readonly askHumanHandler?: AskHumanHandler;
}
