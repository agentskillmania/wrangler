/**
 * US2: 多 agent 并行协调
 *
 * 作为开发者，CrewRunner 以事件驱动方式协调多个 agent 并行工作，
 * primary agent 负责用户交互和任务分配。
 *
 * No LLM required — pure state/store/runner logic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CrewRunner } from '../../src/crew/crew-runner.js';
import { CrewStore } from '../../src/crew/crew-store.js';
import { LocalCrewExecutor } from '../../src/crew/crew-executor.js';
import type { CrewConfig, CrewState, CrewEvent } from '../../src/crew/types.js';

function createTestConfig(): CrewConfig {
  return {
    meta: { name: 'test-crew', description: 'Test', primaryAgent: 'pm' },
    memory: 'All code needs tests.',
    agentDefs: {
      pm: { meta: { name: 'pm' }, instructions: 'You are a PM.' },
      developer: { meta: { name: 'developer' }, instructions: 'You are a developer.' },
    },
    skillDirs: [],
  };
}

function createTestState(overrides?: Partial<CrewState>): CrewState {
  return {
    crewId: 'test-crew-id',
    sessionDir: '',
    todolist: [],
    agents: { pm: 'idle', developer: 'idle' },
    tasks: {},
    userChat: [],
    groupChat: [],
    ...overrides,
  };
}

describe('US2: 多 agent 并行协调', () => {
  let tmpDir: string;
  let store: CrewStore;
  let runner: CrewRunner;
  let config: CrewConfig;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `wrangler-intg-crew-parcoord-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    config = createTestConfig();
    runner = new CrewRunner(config);
    store = new CrewStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('user_message triggers run_agent action for primary agent', async () => {
    const state = createTestState({ sessionDir: tmpDir });
    const event: CrewEvent = { type: 'user_message', content: 'Build feature X' };

    const result = await runner.processEvent(state, event);

    expect(result.state.userChat).toHaveLength(1);
    expect(result.state.userChat[0].role).toBe('user');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('run_agent');
    expect(result.actions[0].agentName).toBe('pm');
  });

  it('task_completed updates task status and notifies group chat', async () => {
    const state = createTestState({
      sessionDir: tmpDir,
      agents: { pm: 'idle', developer: 'running' },
      tasks: {
        'task-1': {
          taskId: 'task-1',
          assignedAgent: 'developer',
          description: 'Implement X',
          status: 'running',
          conversation: [],
        },
      },
    });

    const event: CrewEvent = {
      type: 'task_completed',
      taskId: 'task-1',
      agentName: 'developer',
      result: 'Feature implemented',
    };

    const result = await runner.processEvent(state, event);

    expect(result.state.tasks['task-1'].status).toBe('completed');
    expect(result.state.tasks['task-1'].result).toBe('Feature implemented');
    expect(result.state.agents['developer']).toBe('idle');
    expect(result.state.groupChat).toHaveLength(1);
    expect(result.state.groupChat[0].content).toContain('completed');
    expect(result.state.groupChat[0].content).toContain('Feature implemented');
  });

  it('task_failed updates task status with error', async () => {
    const state = createTestState({
      sessionDir: tmpDir,
      agents: { pm: 'idle', developer: 'running' },
      tasks: {
        'task-2': {
          taskId: 'task-2',
          assignedAgent: 'developer',
          description: 'Fix bug',
          status: 'running',
          conversation: [],
        },
      },
    });

    const event: CrewEvent = {
      type: 'task_failed',
      taskId: 'task-2',
      agentName: 'developer',
      error: 'Build failed: type error',
    };

    const result = await runner.processEvent(state, event);

    expect(result.state.tasks['task-2'].status).toBe('failed');
    expect(result.state.groupChat[0].role).toBe('error');
    expect(result.state.groupChat[0].content).toContain('Build failed');
  });

  it('agent_message broadcasts to group chat', async () => {
    const state = createTestState({ sessionDir: tmpDir });
    const event: CrewEvent = {
      type: 'agent_message',
      from: 'developer',
      to: 'pm',
      content: 'Need more context on the API',
    };

    const result = await runner.processEvent(state, event);

    expect(result.state.groupChat).toHaveLength(1);
    expect(result.state.groupChat[0].content).toContain('developer');
    expect(result.state.groupChat[0].content).toContain('Need more context');
  });

  it('LocalCrewExecutor processes events end-to-end', async () => {
    const state = createTestState({ sessionDir: tmpDir });
    const executor = new LocalCrewExecutor(config, runner, store, state);

    const actions = await executor.handleUserInput('Implement login feature');

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('run_agent');

    const stateAfter = executor.getState();
    expect(stateAfter.agents['pm']).toBe('running');

    const taskIds = Object.keys(stateAfter.tasks);
    expect(taskIds.length).toBeGreaterThan(0);
    const taskId = taskIds[0];
    const taskMeta = await store.readTaskMeta(taskId);
    expect(taskMeta).not.toBeNull();
    expect(taskMeta!.assignedAgent).toBe('pm');
    expect(taskMeta!.status).toBe('running');

    await executor.pushEvent({
      type: 'task_completed',
      taskId,
      agentName: 'pm',
      result: 'Login feature done',
    });

    const finalState = executor.getState();
    expect(finalState.tasks[taskId].status).toBe('completed');
    expect(finalState.agents['pm']).toBe('idle');
  });

  it('does not mutate input state', async () => {
    const state = createTestState({ sessionDir: tmpDir });
    const originalUserChat = [...state.userChat];
    const originalGroupChat = [...state.groupChat];

    await runner.processEvent(state, { type: 'user_message', content: 'test' });
    await runner.processEvent(state, {
      type: 'task_completed',
      taskId: 't1',
      agentName: 'pm',
      result: 'done',
    });

    expect(state.userChat).toEqual(originalUserChat);
    expect(state.groupChat).toEqual(originalGroupChat);
  });
});
