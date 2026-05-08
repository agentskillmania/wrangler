import { describe, it, expect } from 'vitest';
import { CrewRunner } from '../../../src/crew/crew-runner.js';
import type { CrewState, CrewConfig, CrewEvent } from '../../../src/crew/types.js';

export function createTestState(overrides?: Partial<CrewState>): CrewState {
  return {
    crewId: 'test-crew-id',
    sessionDir: '/tmp/test-session',
    todolist: [],
    agents: { pm: 'idle', developer: 'idle' },
    tasks: {},
    userChat: [],
    groupChat: [],
    ...overrides,
  };
}

export function createTestConfig(): CrewConfig {
  return {
    meta: { name: 'test-crew', description: 'Test', primaryAgent: 'pm' },
    memory: 'Test memory',
    agentDefs: {},
    skillDirs: [],
  };
}

describe('CrewRunner', () => {
  const runner = new CrewRunner(createTestConfig());

  it('processes user_message event', async () => {
    const state = createTestState();
    const event: CrewEvent = { type: 'user_message', content: 'Build feature X' };

    const result = await runner.processEvent(state, event);

    expect(result.state.userChat).toHaveLength(1);
    expect(result.state.userChat[0].content).toBe('Build feature X');
    expect(result.state.userChat[0].role).toBe('user');
    expect(result.actions.some((a) => a.type === 'run_agent')).toBe(true);
  });

  it('processes task_completed event', async () => {
    const state = createTestState({
      tasks: {
        'task-1': {
          taskId: 'task-1',
          assignedAgent: 'developer:1',
          description: 'Implement X',
          status: 'running',
          conversation: [],
        },
      },
    });
    const event: CrewEvent = {
      type: 'task_completed',
      taskId: 'task-1',
      agentName: 'developer:1',
      result: 'Done',
    };

    const result = await runner.processEvent(state, event);

    expect(result.state.tasks['task-1'].status).toBe('completed');
    expect(result.state.tasks['task-1'].result).toBe('Done');
    expect(result.state.groupChat.length).toBeGreaterThan(0);
  });

  it('processes task_failed event', async () => {
    const state = createTestState({
      tasks: {
        'task-2': {
          taskId: 'task-2',
          assignedAgent: 'developer:1',
          description: 'Fix bug',
          status: 'running',
          conversation: [],
        },
      },
    });
    const event: CrewEvent = {
      type: 'task_failed',
      taskId: 'task-2',
      agentName: 'developer:1',
      error: 'Build failed',
    };

    const result = await runner.processEvent(state, event);

    expect(result.state.tasks['task-2'].status).toBe('failed');
    expect(result.state.groupChat.some((m) => m.content.includes('Build failed'))).toBe(true);
  });

  it('processes agent_message event', async () => {
    const state = createTestState();
    const event: CrewEvent = {
      type: 'agent_message',
      from: 'developer:1',
      to: 'pm',
      content: 'I need more context on task X',
    };

    const result = await runner.processEvent(state, event);

    expect(result.state.groupChat).toHaveLength(1);
    expect(result.state.groupChat[0].content).toContain('I need more context');
  });

  it('does not mutate original state', async () => {
    const state = createTestState();
    const originalChat = [...state.userChat];
    const event: CrewEvent = { type: 'user_message', content: 'test' };

    await runner.processEvent(state, event);

    expect(state.userChat).toEqual(originalChat);
  });

  it('resets agent status to idle on task completion', async () => {
    const state = createTestState({
      agents: { pm: 'idle', developer: 'running' },
      tasks: {
        'task-3': {
          taskId: 'task-3',
          assignedAgent: 'developer',
          description: 'Do something',
          status: 'running',
          conversation: [],
        },
      },
    });
    const event: CrewEvent = {
      type: 'task_completed',
      taskId: 'task-3',
      agentName: 'developer',
      result: 'Done',
    };

    const result = await runner.processEvent(state, event);

    expect(result.state.agents['developer']).toBe('idle');
  });
});
