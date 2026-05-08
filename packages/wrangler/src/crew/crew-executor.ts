// packages/core/src/crew/crew-executor.ts

import type { CrewConfig, CrewState, CrewEvent, CrewAction } from './types.js';
import { CrewRunner } from './crew-runner.js';
import { CrewStore } from './crew-store.js';
import { produce } from 'immer';

export interface LocalCrewExecutorOptions {
  crewConfig: CrewConfig;
  crewRunner: CrewRunner;
  crewStore: CrewStore;
  initialState: CrewState;
}

export class LocalCrewExecutor {
  private state: CrewState;
  private eventQueue: CrewEvent[] = [];
  private processing = false;

  constructor(
    private config: CrewConfig,
    private runner: CrewRunner,
    private store: CrewStore,
    initialState: CrewState
  ) {
    this.state = initialState;
  }

  getState(): CrewState {
    return this.state;
  }

  async pushEvent(event: CrewEvent): Promise<CrewAction[]> {
    this.eventQueue.push(event);
    if (!this.processing) {
      return this.processQueue();
    }
    return [];
  }

  async handleUserInput(content: string): Promise<CrewAction[]> {
    return this.pushEvent({ type: 'user_message', content });
  }

  private async processQueue(): Promise<CrewAction[]> {
    if (this.processing) return [];
    this.processing = true;

    const allActions: CrewAction[] = [];

    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift()!;
      const result = await this.runner.processEvent(this.state, event);

      this.state = result.state;
      allActions.push(...result.actions);

      // Persist state changes
      await this.persistState();

      // Execute actions
      for (const action of result.actions) {
        await this.executeAction(action);
      }
    }

    this.processing = false;
    return allActions;
  }

  private async executeAction(action: CrewAction): Promise<void> {
    switch (action.type) {
      case 'run_agent':
        await this.executeRunAgent(action);
        break;
      case 'notify_user':
        // Handled by upper layer
        break;
      case 'cancel_task':
        await this.store.updateTaskStatus(action.taskId, 'failed', 'Cancelled');
        break;
    }
  }

  private async executeRunAgent(action: Extract<CrewAction, { type: 'run_agent' }>): Promise<void> {
    const taskId = action.taskId;

    this.state = produce(this.state, (draft) => {
      draft.agents[action.agentName] = 'running';
      draft.tasks[taskId] = {
        taskId,
        assignedAgent: action.agentName,
        description: action.context.description,
        status: 'running',
        conversation: [],
      };
    });

    await this.store.createTask(taskId, {
      taskId,
      assignedAgent: action.agentName,
      description: action.context.description,
      status: 'running',
      createdAt: new Date().toISOString(),
    });
  }

  private async persistState(): Promise<void> {
    if (this.state.todolist.length > 0) {
      await this.store.writeTodolist([...this.state.todolist]);
    }
  }
}
