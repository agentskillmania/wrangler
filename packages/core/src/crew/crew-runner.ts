// packages/core/src/crew/crew-runner.ts

import { produce } from 'immer';
import type { CrewConfig, CrewState, CrewEvent, CrewResult, ConversationMessage } from './types.js';

export class CrewRunner {
  constructor(private config: CrewConfig) {}

  async processEvent(state: CrewState, event: CrewEvent): Promise<CrewResult> {
    switch (event.type) {
      case 'user_message':
        return this.handleUserMessage(state, event.content);
      case 'task_completed':
        return this.handleTaskCompleted(state, event);
      case 'task_failed':
        return this.handleTaskFailed(state, event);
      case 'agent_message':
        return this.handleAgentMessage(state, event);
      default:
        return { state, actions: [] };
    }
  }

  private handleUserMessage(state: CrewState, content: string): CrewResult {
    const userMsg: ConversationMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    const newState = produce(state, (draft) => {
      draft.userChat = [...draft.userChat, userMsg];
    });

    return {
      state: newState,
      actions: [
        {
          type: 'run_agent',
          agentName: this.config.meta.primaryAgent,
          taskId: `user-${Date.now()}`,
          context: {
            taskId: `user-${Date.now()}`,
            description: content,
            crewMemory: this.config.memory,
            todolist: [...state.todolist],
          },
        },
      ],
    };
  }

  private handleTaskCompleted(
    state: CrewState,
    event: Extract<CrewEvent, { type: 'task_completed' }>
  ): CrewResult {
    const notification: ConversationMessage = {
      role: 'system',
      content: `${event.agentName} completed task ${event.taskId}: ${event.result}`,
      timestamp: Date.now(),
    };

    const newState = produce(state, (draft) => {
      const task = draft.tasks[event.taskId];
      if (task) {
        draft.tasks[event.taskId] = {
          ...task,
          status: 'completed' as const,
          result: event.result,
        };
      }
      draft.groupChat = [...draft.groupChat, notification];
      const agentKey = event.agentName.split(':')[0];
      draft.agents[agentKey] = 'idle';
    });

    return { state: newState, actions: [] };
  }

  private handleTaskFailed(
    state: CrewState,
    event: Extract<CrewEvent, { type: 'task_failed' }>
  ): CrewResult {
    const notification: ConversationMessage = {
      role: 'error',
      content: `${event.agentName} failed task ${event.taskId}: ${event.error}`,
      timestamp: Date.now(),
      errorMessage: event.error,
    };

    const newState = produce(state, (draft) => {
      const task = draft.tasks[event.taskId];
      if (task) {
        draft.tasks[event.taskId] = {
          ...task,
          status: 'failed' as const,
          result: event.error,
        };
      }
      draft.groupChat = [...draft.groupChat, notification];
      const agentKey = event.agentName.split(':')[0];
      draft.agents[agentKey] = 'idle';
    });

    return { state: newState, actions: [] };
  }

  private handleAgentMessage(
    state: CrewState,
    event: Extract<CrewEvent, { type: 'agent_message' }>
  ): CrewResult {
    const msg: ConversationMessage = {
      role: 'system',
      content: `[${event.from} → ${event.to}] ${event.content}`,
      timestamp: Date.now(),
    };

    const newState = produce(state, (draft) => {
      draft.groupChat = [...draft.groupChat, msg];
    });

    return { state: newState, actions: [] };
  }
}
