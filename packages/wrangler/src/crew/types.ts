// packages/core/src/crew/types.ts

import type { AgentDefinition } from '../agent/types.js';
import type { ConversationMessage } from '../session/types.js';
import type { ILLMProvider, AskHumanHandler } from '@agentskillmania/colts';

export type { ConversationMessage };

// ─── Static config (loaded once, immutable during run) ───

export interface CrewMeta {
  name: string;
  description: string;
  primaryAgent: string;
}

export interface CrewConfig {
  meta: CrewMeta;
  memory: string;
  agentDefs: Readonly<Record<string, AgentDefinition>>;
  skillDirs: string[];
}

// ─── Dynamic state (immutable, updated via Immer) ───

export type AgentStatus = 'idle' | 'running' | 'waiting';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface CrewTodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  assignee?: string;
}

export interface TaskState {
  readonly taskId: string;
  readonly assignedAgent: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly conversation: readonly ConversationMessage[];
  readonly result?: string;
}

export interface CrewState {
  readonly crewId: string;
  readonly sessionDir: string;
  readonly todolist: readonly CrewTodoItem[];
  readonly agents: Readonly<Record<string, AgentStatus>>;
  readonly tasks: Readonly<Record<string, TaskState>>;
  readonly userChat: readonly ConversationMessage[];
  readonly groupChat: readonly ConversationMessage[];
}

// ─── Event/Action model ───

export type CrewEvent =
  | { type: 'user_message'; content: string }
  | { type: 'task_completed'; taskId: string; agentName: string; result: string }
  | { type: 'task_failed'; taskId: string; agentName: string; error: string }
  | { type: 'agent_message'; from: string; to: string; content: string };

export interface TaskContext {
  taskId: string;
  description: string;
  crewMemory: string;
  todolist: CrewTodoItem[];
}

export type CrewAction =
  | { type: 'run_agent'; agentName: string; taskId: string; context: TaskContext }
  | { type: 'notify_user'; content: string }
  | { type: 'cancel_task'; taskId: string };

export interface CrewResult {
  state: CrewState;
  actions: CrewAction[];
}

// ─── Task metadata (persisted to tasks/{taskId}/meta.yaml) ───

export interface TaskMeta {
  taskId: string;
  assignedAgent: string;
  description: string;
  status: TaskStatus;
  createdAt: string;
  completedAt?: string;
  result?: string;
}

// ─── Options ───

export interface CrewRunnerOptions {
  llmClient: ILLMProvider;
  defaultModel?: string;
  askHumanHandler?: AskHumanHandler;
}
