/**
 * Integration Test: Todolist
 *
 * US1: 创建和使用任务列表工具
 * US2: Assembler renders todo list
 * US3: todolist 持久化
 * US4: todolist 与 session 组合使用
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentState, updateState } from '@agentskillmania/colts';
import { MarkdownMessageAssembler } from '../../src/runner/markdown-assembler.js';
import {
  createTodolistSupport,
  createEmptyTodoList,
  addTodo,
  updateTodo,
} from '../../src/todolist/index.js';
import { createSessionSupport } from '../../src/session/support.js';
import type { TodoList } from '../../src/todolist/types.js';

describe('US1: 创建和使用任务列表工具', () => {
  it('createTodolistSupport returns tools and middleware with no args', () => {
    const todo = createTodolistSupport();

    expect(todo.tools).toHaveLength(1);
    expect(todo.tools[0].name).toBe('todolist');
    expect(todo.middleware.name).toBe('todolist');
  });

  it('tool returns { _todo: true, actions } for create action', async () => {
    const todo = createTodolistSupport();

    const result = await todo.tools[0].execute({
      actions: [{ action: 'create', subject: 'Implement feature' }],
    });

    expect(result).toEqual({
      _todo: true,
      actions: [{ action: 'create', subject: 'Implement feature' }],
    });
  });

  it('middleware afterStep applies create to state.context.todoList', async () => {
    const todo = createTodolistSupport();
    const state = createAgentState({
      name: 'test-agent',
      instructions: 'You are helpful.',
      tools: [],
    });

    const toolResult = await todo.tools[0].execute({
      actions: [{ action: 'create', subject: 'New task' }],
    });

    const afterStepCtx = {
      result: {
        type: 'continue',
        toolResult,
        actions: [],
        tokens: { input: 0, output: 0, total: 0, cost: { input: 0, output: 0, total: 0 } },
      },
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    };

    const result = await todo.middleware.afterStep!(afterStepCtx);

    expect(result).toBeDefined();
    expect(result!.state!.context.todoList).toBeDefined();
    expect(result!.state!.context.todoList!.items).toHaveLength(1);
    expect(result!.state!.context.todoList!.items[0].subject).toBe('New task');
  });

  it('middleware afterStep applies update to change status', async () => {
    const todo = createTodolistSupport();
    const state = updateState(
      createAgentState({
        name: 'test-agent',
        instructions: 'You are helpful.',
        tools: [],
      }),
      (draft) => {
        draft.context.todoList = addTodo(createEmptyTodoList(), 'Task 1');
      }
    );

    const toolResult = await todo.tools[0].execute({
      actions: [{ action: 'update', id: 1, status: 'completed' }],
    });

    const afterStepCtx = {
      result: {
        type: 'continue',
        toolResult,
        actions: [],
        tokens: { input: 0, output: 0, total: 0, cost: { input: 0, output: 0, total: 0 } },
      },
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    };

    const result = await todo.middleware.afterStep!(afterStepCtx);

    expect(result!.state!.context.todoList!.items[0].status).toBe('completed');
  });

  it('middleware afterStep applies delete to remove items', async () => {
    const todo = createTodolistSupport();
    const state = updateState(
      createAgentState({
        name: 'test-agent',
        instructions: 'You are helpful.',
        tools: [],
      }),
      (draft) => {
        let list = addTodo(createEmptyTodoList(), 'Task 1');
        list = addTodo(list, 'Task 2');
        draft.context.todoList = list;
      }
    );

    const toolResult = await todo.tools[0].execute({
      actions: [{ action: 'delete', id: 1 }],
    });

    const afterStepCtx = {
      result: {
        type: 'continue',
        toolResult,
        actions: [],
        tokens: { input: 0, output: 0, total: 0, cost: { input: 0, output: 0, total: 0 } },
      },
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    };

    const result = await todo.middleware.afterStep!(afterStepCtx);

    expect(result!.state!.context.todoList!.items).toHaveLength(1);
    expect(result!.state!.context.todoList!.items[0].subject).toBe('Task 2');
  });

  it('middleware afterStep applies reset to replace entire list', async () => {
    const todo = createTodolistSupport();
    const state = updateState(
      createAgentState({
        name: 'test-agent',
        instructions: 'You are helpful.',
        tools: [],
      }),
      (draft) => {
        let list = addTodo(createEmptyTodoList(), 'Old task 1');
        list = addTodo(list, 'Old task 2');
        draft.context.todoList = list;
      }
    );

    const toolResult = await todo.tools[0].execute({
      actions: [
        {
          action: 'reset',
          tasks: [
            { subject: 'New task A', status: 'pending' },
            { subject: 'New task B', status: 'in_progress' },
          ],
        },
      ],
    });

    const afterStepCtx = {
      result: {
        type: 'continue',
        toolResult,
        actions: [],
        tokens: { input: 0, output: 0, total: 0, cost: { input: 0, output: 0, total: 0 } },
      },
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    };

    const result = await todo.middleware.afterStep!(afterStepCtx);

    expect(result!.state!.context.todoList!.items).toHaveLength(2);
    expect(result!.state!.context.todoList!.items[0].subject).toBe('New task A');
    expect(result!.state!.context.todoList!.items[0].status).toBe('pending');
    expect(result!.state!.context.todoList!.items[1].subject).toBe('New task B');
    expect(result!.state!.context.todoList!.items[1].status).toBe('in_progress');
  });

  it('middleware afterStep applies batch mixed actions in order', async () => {
    const todo = createTodolistSupport();
    const state = updateState(
      createAgentState({
        name: 'test-agent',
        instructions: 'You are helpful.',
        tools: [],
      }),
      (draft) => {
        let list = addTodo(createEmptyTodoList(), 'Task 1');
        list = addTodo(list, 'Task 2');
        draft.context.todoList = list;
      }
    );

    const toolResult = await todo.tools[0].execute({
      actions: [
        { action: 'create', subject: 'Task 3' },
        { action: 'update', id: 1, status: 'completed' },
        { action: 'delete', id: 2 },
      ],
    });

    const afterStepCtx = {
      result: {
        type: 'continue',
        toolResult,
        actions: [],
        tokens: { input: 0, output: 0, total: 0, cost: { input: 0, output: 0, total: 0 } },
      },
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    };

    const result = await todo.middleware.afterStep!(afterStepCtx);

    expect(result!.state!.context.todoList!.items).toHaveLength(2);
    expect(result!.state!.context.todoList!.items[0].subject).toBe('Task 1');
    expect(result!.state!.context.todoList!.items[0].status).toBe('completed');
    expect(result!.state!.context.todoList!.items[1].subject).toBe('Task 3');
  });

  it('middleware afterStep ignores non-todo toolResult', async () => {
    const todo = createTodolistSupport();
    const state = updateState(
      createAgentState({
        name: 'test-agent',
        instructions: 'You are helpful.',
        tools: [],
      }),
      (draft) => {
        draft.context.todoList = addTodo(createEmptyTodoList(), 'Original task');
      }
    );

    const afterStepCtx = {
      result: {
        type: 'continue',
        toolResult: { someOtherResult: true },
        actions: [],
        tokens: { input: 0, output: 0, total: 0, cost: { input: 0, output: 0, total: 0 } },
      },
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    };

    const result = await todo.middleware.afterStep!(afterStepCtx);

    // Should not modify state
    expect(result).toBeUndefined();
  });
});

describe('US2: Assembler renders todo list', () => {
  it('when todoList has items, assembler output contains ## Current Task List with formatted items', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = updateState(
      createAgentState({
        name: 'test-agent',
        instructions: 'You are helpful.',
        tools: [],
      }),
      (draft) => {
        let list = addTodo(createEmptyTodoList(), 'Task 1');
        list = updateTodo(list, 1, { status: 'in_progress' });
        list = addTodo(list, 'Task 2');
        draft.context.todoList = list;
      }
    );

    const messages = assembler.build(state, { model: 'gpt-4' });
    const systemPrompt = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(systemPrompt).toContain('## Current Task List');
    expect(systemPrompt).toContain('- [~] 1. Task 1');
    expect(systemPrompt).toContain('- [ ] 2. Task 2');
  });

  it('when todoList is empty, assembler output does NOT contain ## Current Task List', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = updateState(
      createAgentState({
        name: 'test-agent',
        instructions: 'You are helpful.',
        tools: [],
      }),
      (draft) => {
        draft.context.todoList = createEmptyTodoList();
      }
    );

    const messages = assembler.build(state, { model: 'gpt-4' });
    const systemPrompt = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(systemPrompt).not.toContain('## Current Task List');
  });

  it('when todoList is undefined (auto-initialized to empty), no section appears', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = createAgentState({
      name: 'test-agent',
      instructions: 'You are helpful.',
      tools: [],
    });

    const messages = assembler.build(state, { model: 'gpt-4' });
    const systemPrompt = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(systemPrompt).not.toContain('## Current Task List');
  });

  it('## Current Task List section appears after ## Instructions and before ## Available Skills', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = updateState(
      createAgentState({
        name: 'test-agent',
        instructions: 'You are helpful.',
        tools: [],
      }),
      (draft) => {
        draft.context.todoList = addTodo(createEmptyTodoList(), 'Task 1');
      }
    );

    const messages = assembler.build(state, {
      model: 'gpt-4',
      skillProvider: {
        listSkills: () => [{ name: 'test-skill', description: 'A test skill' }],
      },
    });
    const systemPrompt = typeof messages[0].content === 'string' ? messages[0].content : '';

    const instructionsIdx = systemPrompt.indexOf('## Instructions');
    const taskListIdx = systemPrompt.indexOf('## Current Task List');
    const skillsIdx = systemPrompt.indexOf('## Available Skills');

    expect(instructionsIdx).toBeLessThan(taskListIdx);
    expect(taskListIdx).toBeLessThan(skillsIdx);
    expect(instructionsIdx).toBeLessThan(skillsIdx);
  });
});

describe('US3: todolist 持久化', () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-todo-intg-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true }).catch(() => {});
  });

  it('create state with todoList, saveState, loadState → todoList fully restored', async () => {
    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    const sessionId = await session.store.createWithId('test-persist-todo', 'GLM-4.7');

    const state = updateState(
      createAgentState({
        name: 'test-agent',
        instructions: 'You are helpful.',
        tools: [],
      }),
      (draft) => {
        let list = addTodo(createEmptyTodoList(), 'Task 1');
        list = updateTodo(list, 1, { status: 'completed' });
        list = addTodo(list, 'Task 2');
        draft.context.todoList = list;
      }
    );

    await session.store.saveState(sessionId, state);

    const loaded = await session.store.loadState(sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.context.todoList).toBeDefined();
    expect(loaded!.context.todoList!.items).toHaveLength(2);
    expect(loaded!.context.todoList!.items[0].subject).toBe('Task 1');
    expect(loaded!.context.todoList!.items[0].status).toBe('completed');
    expect(loaded!.context.todoList!.items[1].subject).toBe('Task 2');
    expect(loaded!.context.todoList!.items[1].status).toBe('pending');
  });

  it('state without todoList, saveState, loadState → todoList is undefined', async () => {
    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    const sessionId = await session.store.createWithId('test-no-todo', 'GLM-4.7');

    const state = createAgentState({
      name: 'test-agent',
      instructions: 'You are helpful.',
      tools: [],
    });

    await session.store.saveState(sessionId, state);

    const loaded = await session.store.loadState(sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.context.todoList).toBeUndefined();
  });
});

describe('US4: todolist 与 session 组合使用', () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-combo-intg-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true }).catch(() => {});
  });

  it('both sets of tools work without conflict', () => {
    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    const todo = createTodolistSupport();

    // Both sets of tools should work together
    expect(session.tools.length).toBeGreaterThan(0);
    expect(todo.tools).toHaveLength(1);

    // Session tools have names
    session.tools.forEach((t) => {
      expect(t.name).toBeDefined();
      expect(typeof t.name).toBe('string');
    });

    // Todo has todolist tool
    expect(todo.tools[0].name).toBe('todolist');
  });

  it('full cycle: tool execute → afterStep apply → saveState → loadState → verify todoList restored', async () => {
    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    const todo = createTodolistSupport();
    const sessionId = await session.store.createWithId('test-full-cycle', 'GLM-4.7');

    // Start with empty state
    const initialState = createAgentState({
      name: 'test-agent',
      instructions: 'You are helpful.',
      tools: [],
    });

    // Execute tool: create task
    const toolResult = await todo.tools[0].execute({
      actions: [{ action: 'create', subject: 'Full cycle test' }],
    });

    // Apply via afterStep
    const afterStepCtx = {
      result: {
        type: 'continue' as const,
        toolResult,
        actions: [],
        tokens: { input: 0, output: 0, total: 0, cost: { input: 0, output: 0, total: 0 } },
      },
      state: initialState,
      stepNumber: 0,
      runnerOptions: {} as any,
    };

    const afterResult = await todo.middleware.afterStep!(afterStepCtx);
    expect(afterResult!.state!.context.todoList).toBeDefined();
    expect(afterResult!.state!.context.todoList!.items).toHaveLength(1);

    // Save state
    await session.store.saveState(sessionId, afterResult!.state!);

    // Load state
    const loaded = await session.store.loadState(sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.context.todoList).toBeDefined();
    expect(loaded!.context.todoList!.items).toHaveLength(1);
    expect(loaded!.context.todoList!.items[0].subject).toBe('Full cycle test');
  });

  it('middleware beforeStep auto-initializes empty todoList', async () => {
    const todo = createTodolistSupport();
    const state = createAgentState({
      name: 'test-agent',
      instructions: 'You are helpful.',
      tools: [],
    });

    expect(state.context.todoList).toBeUndefined();

    const beforeStepCtx = {
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    };

    const result = await todo.middleware.beforeStep!(beforeStepCtx);

    expect(result).toBeDefined();
    expect(result!.state!.context.todoList).toBeDefined();
    expect(result!.state!.context.todoList!.items).toHaveLength(0);
  });
});
