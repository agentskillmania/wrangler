import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalCrewExecutor } from '../../../src/crew/crew-executor.js';
import { CrewRunner } from '../../../src/crew/crew-runner.js';
import { CrewStore } from '../../../src/crew/crew-store.js';
import type { CrewState } from '../../../src/crew/types.js';
import { createTestConfig } from './crew-runner.test.js';

describe('LocalCrewExecutor', () => {
  let tmpDir: string;
  let store: CrewStore;
  let runner: CrewRunner;
  let config: ReturnType<typeof createTestConfig>;

  function createTestState(overrides?: Partial<CrewState>): CrewState {
    return {
      crewId: 'test-crew-id',
      sessionDir: tmpDir,
      todolist: [],
      agents: { pm: 'idle', developer: 'idle' },
      tasks: {},
      userChat: [],
      groupChat: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `crew-executor-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    config = createTestConfig();
    runner = new CrewRunner(config);
    store = new CrewStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('handles user input and produces run_agent action', async () => {
    const executor = new LocalCrewExecutor(config, runner, store, createTestState());
    const actions = await executor.handleUserInput('Build feature X');

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('run_agent');
    expect(actions[0].agentName).toBe('pm');
  });

  it('updates state after processing user message', async () => {
    const executor = new LocalCrewExecutor(config, runner, store, createTestState());
    await executor.handleUserInput('Hello');

    const state = executor.getState();
    expect(state.userChat).toHaveLength(1);
    expect(state.userChat[0].content).toBe('Hello');
  });

  it('creates task in store when executing run_agent action', async () => {
    const executor = new LocalCrewExecutor(config, runner, store, createTestState());
    await executor.handleUserInput('Do work');

    const state = executor.getState();
    const taskIds = Object.keys(state.tasks);
    expect(taskIds.length).toBeGreaterThan(0);

    const taskId = taskIds[0];
    const meta = await store.readTaskMeta(taskId);
    expect(meta).not.toBeNull();
    expect(meta!.assignedAgent).toBe('pm');
    expect(meta!.status).toBe('running');
  });

  it('marks agent as running when task starts', async () => {
    const executor = new LocalCrewExecutor(config, runner, store, createTestState());
    await executor.handleUserInput('Do work');

    const state = executor.getState();
    expect(state.agents['pm']).toBe('running');
  });

  it('processes task_completed event', async () => {
    const executor = new LocalCrewExecutor(config, runner, store, createTestState());
    const actions = await executor.handleUserInput('Do work');

    const state1 = executor.getState();
    const taskId = Object.keys(state1.tasks)[0];

    // Simulate task completion
    const completionActions = await executor.pushEvent({
      type: 'task_completed',
      taskId,
      agentName: 'pm',
      result: 'Work done',
    });

    const finalState = executor.getState();
    expect(finalState.tasks[taskId].status).toBe('completed');
    expect(finalState.tasks[taskId].result).toBe('Work done');
    expect(finalState.groupChat.length).toBeGreaterThan(0);
  });

  it('does not mutate state object directly', async () => {
    const initialState = createTestState();
    const executor = new LocalCrewExecutor(config, runner, store, initialState);

    await executor.handleUserInput('test');

    // Original state should be unchanged (LocalCrewExecutor maintains its own copy)
    expect(initialState.userChat).toHaveLength(0);
  });
});
