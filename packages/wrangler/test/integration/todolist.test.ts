/**
 * Integration Test: Todolist
 *
 * US1: 创建和使用任务列表工具
 * US2: 上下文自动注入
 * US3: todolist 持久化
 * US4: todolist 与 session 组合使用
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createTodolistSupport,
  createEmptyTodoList,
  addTodo,
  updateTodo,
} from '../../src/todolist/index.js';
import { createSessionSupport } from '../../src/session/support.js';
import type { TodoList } from '../../src/todolist/types.js';

describe('US1: 创建和使用任务列表工具', () => {
  it('createTodolistSupport returns tools and middleware', () => {
    let list: TodoList | null = null;
    const todo = createTodolistSupport({
      getList: () => list,
      setList: (l) => {
        list = l;
      },
    });

    expect(todo.tools).toHaveLength(1);
    expect(todo.tools[0].name).toBe('todolist');
    expect(todo.middleware.name).toBe('todolist');
  });

  it('tool executes create action', async () => {
    let list: TodoList | null = null;
    const todo = createTodolistSupport({
      getList: () => list,
      setList: (l) => {
        list = l;
      },
    });

    const result = await todo.tools[0].execute({
      action: 'create',
      subject: 'Implement feature',
    });

    expect(result).toContain('Implement feature');
    expect(result).toContain('[ ]');
    expect(list).not.toBeNull();
    expect(list!.items).toHaveLength(1);
  });

  it('tool executes update action', async () => {
    let list: TodoList | null = createEmptyTodoList();
    list = addTodo(list, 'Task 1');
    const todo = createTodolistSupport({
      getList: () => list,
      setList: (l) => {
        list = l;
      },
    });

    const result = await todo.tools[0].execute({
      action: 'update',
      id: 1,
      status: 'completed',
    });

    expect(result).toContain('[x]');
    expect(list!.items[0].status).toBe('completed');
  });

  it('tool executes delete action', async () => {
    let list: TodoList | null = createEmptyTodoList();
    list = addTodo(list, 'Task 1');
    list = addTodo(list, 'Task 2');
    const todo = createTodolistSupport({
      getList: () => list,
      setList: (l) => {
        list = l;
      },
    });

    const result = await todo.tools[0].execute({
      action: 'delete',
      id: 1,
    });

    expect(result).not.toContain('Task 1');
    expect(result).toContain('Task 2');
    expect(list!.items).toHaveLength(1);
  });

  it('tool executes list action', async () => {
    let list: TodoList | null = createEmptyTodoList();
    list = addTodo(list, 'Task 1');
    const todo = createTodolistSupport({
      getList: () => list,
      setList: (l) => {
        list = l;
      },
    });

    const result = await todo.tools[0].execute({ action: 'list' });
    expect(result).toContain('Task 1');
  });

  it('tool returns error for unknown action', async () => {
    let list: TodoList | null = createEmptyTodoList();
    const todo = createTodolistSupport({
      getList: () => list,
      setList: (l) => {
        list = l;
      },
    });

    const result = await todo.tools[0].execute({ action: 'foobar' as any });
    expect(result).toContain('Error');
  });
});

describe('US2: 上下文自动注入', () => {
  it('middleware injects todolist into instructions', async () => {
    let list: TodoList | null = createEmptyTodoList();
    list = addTodo(list, 'Important task');
    list = updateTodo(list, 1, { status: 'in_progress' });

    const todo = createTodolistSupport({
      getList: () => list,
      setList: (l) => {
        list = l;
      },
    });

    const { createAgentState } = await import('@agentskillmania/colts');
    const state = createAgentState({
      name: 'test-agent',
      instructions: 'You are helpful.',
      tools: [],
    });

    const result = await todo.middleware.beforeStep!({
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(result).toBeDefined();
    expect(result!.state!.config.instructions).toContain('=== Current Task List ===');
    expect(result!.state!.config.instructions).toContain('Important task');
    expect(result!.state!.config.instructions).toContain('[~]');
    expect(result!.state!.config.instructions).toContain('You are helpful.');
  });

  it('middleware does not inject for empty list', async () => {
    const list: TodoList | null = createEmptyTodoList();
    const todo = createTodolistSupport({
      getList: () => list,
      setList: () => {},
    });

    const { createAgentState } = await import('@agentskillmania/colts');
    const state = createAgentState({
      name: 'test-agent',
      instructions: 'You are helpful.',
      tools: [],
    });

    const result = await todo.middleware.beforeStep!({
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(result).toBeUndefined();
  });

  it('middleware does not inject for null list', async () => {
    const todo = createTodolistSupport({
      getList: () => null,
      setList: () => {},
    });

    const { createAgentState } = await import('@agentskillmania/colts');
    const state = createAgentState({
      name: 'test-agent',
      instructions: 'You are helpful.',
      tools: [],
    });

    const result = await todo.middleware.beforeStep!({
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(result).toBeUndefined();
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

  it('saves and loads todolist via SessionStore', async () => {
    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    await session.store.createWithId('1745800100-todo-test', 'GLM-4.7');

    const list = addTodo(createEmptyTodoList(), 'Task 1');
    await session.store.saveTodoList('1745800100-todo-test', list);

    const loaded = await session.store.loadTodoList('1745800100-todo-test');
    expect(loaded).not.toBeNull();
    expect(loaded!.items).toHaveLength(1);
    expect(loaded!.items[0].subject).toBe('Task 1');
  });

  it('returns null for non-existent todolist', async () => {
    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    await session.store.createWithId('1745800101-no-todo', 'GLM-4.7');
    const loaded = await session.store.loadTodoList('1745800101-no-todo');
    expect(loaded).toBeNull();
  });

  it('overwrites previous todolist on save', async () => {
    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    await session.store.createWithId('1745800102-overwrite', 'GLM-4.7');

    let list = addTodo(createEmptyTodoList(), 'Task 1');
    await session.store.saveTodoList('1745800102-overwrite', list);

    list = addTodo(list, 'Task 2');
    list = updateTodo(list, 1, { status: 'completed' });
    await session.store.saveTodoList('1745800102-overwrite', list);

    const loaded = await session.store.loadTodoList('1745800102-overwrite');
    expect(loaded!.items).toHaveLength(2);
    expect(loaded!.items[0].status).toBe('completed');
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

  it('todolist + session tools coexist without conflict', async () => {
    let todoList: TodoList | null = null;

    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    const todo = createTodolistSupport({
      getList: () => todoList,
      setList: (l) => {
        todoList = l;
      },
    });

    // Both sets of tools should work together
    expect(session.tools.length).toBeGreaterThan(0);
    expect(todo.tools).toHaveLength(1);

    // Use todolist tool
    const result = await todo.tools[0].execute({
      action: 'create',
      subject: 'Combined test',
    });
    expect(result).toContain('Combined test');
    expect(todoList).not.toBeNull();
  });

  it('todolist state persists alongside session state', async () => {
    let todoList: TodoList | null = null;

    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    const todo = createTodolistSupport({
      getList: () => todoList,
      setList: (l) => {
        todoList = l;
      },
    });

    const sessionId = await session.store.createWithId('1745800200-persist', 'GLM-4.7');

    // Create a task via tool
    await todo.tools[0].execute({ action: 'create', subject: 'Persist test' });
    expect(todoList).not.toBeNull();

    // Save todolist to session
    await session.store.saveTodoList(sessionId, todoList!);

    // Simulate restore: clear in-memory, load from disk
    todoList = null;
    const loaded = await session.store.loadTodoList(sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.items[0].subject).toBe('Persist test');
  });
});
