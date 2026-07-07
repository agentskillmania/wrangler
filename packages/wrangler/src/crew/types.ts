import type { ILLMProvider, AskHumanHandler } from '@agentskillmania/colts';

import type { ParsedAgent } from '../agent/agent-parser.js';
import type { SearchProvider } from '../tools/builtin/web-search.js';

// ─── Agent roles ───

export type AgentRole = 'primary' | 'worker';

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

export type TaskStatus = 'running' | 'completed' | 'failed';

export interface TaskInfo {
  readonly id: string;
  readonly workerDefinitionName: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly result?: string;
  readonly workerId: string;
  readonly createdAt: number;
  readonly completedAt?: number;
}

// ─── Crew state (read-only) ───

export type CrewStatus = 'idle' | 'running' | 'stopped' | 'error';

export interface CrewState {
  readonly id: string;
  readonly status: CrewStatus;
  readonly primaryId: string;
  readonly agents: ReadonlyMap<string, AgentInstanceInfo>;
  readonly tasks: ReadonlyMap<string, TaskInfo>;
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

export interface CrewAgentCreatedEvent {
  readonly type: 'agent_created';
  readonly agentId: string;
  readonly role: AgentRole;
  readonly definitionName: string;
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

export type CrewOutputEvent =
  | CrewUserResponseEvent
  | CrewTaskStartedEvent
  | CrewTaskCompletedEvent
  | CrewTaskFailedEvent
  | CrewAgentCreatedEvent
  | CrewErrorEvent
  | CrewToolInvokedEvent
  | CrewToolCompletedEvent;

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
    readonly sandbox?: boolean;
  };
  readonly memory: string;
  readonly agentDefs: Readonly<Record<string, ParsedAgent>>;
  readonly skillDirs: readonly string[];
}

// ─── Crew constructor options ───

export interface CrewOptions {
  readonly llmClient: ILLMProvider;
  readonly defaultModel?: string;
  readonly askHumanHandler?: AskHumanHandler;
  readonly workspaceDeps?: { workspacePath: string };
  readonly searchProvider?: SearchProvider;
  readonly sandbox?: boolean;
  /** Explicit MCP config paths. Empty array = skip MCP loading entirely. Undefined = auto-discover. */
  readonly mcpConfigPaths?: string[];
}
