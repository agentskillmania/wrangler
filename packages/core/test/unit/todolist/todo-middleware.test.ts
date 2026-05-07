import { describe, it, expect, vi } from 'vitest';
import { createTodolistMiddleware } from '../../../src/todolist/todo-middleware.js';
import { createEmptyTodoList, addTodo, updateTodo } from '../../../src/todolist/todo-state.js';
import { createAgentState } from '@agentskillmania/colts';
import type { TodoList } from '../../../src/todolist/types.js';

function makeState(instructions = 'You are a helpful assistant.') {
  return createAgentState({
    name: 'test-agent',
    instructions,
    tools: [],
  });
}

describe('todolist middleware', () => {
  it('has name "todolist"', () => {
    const getList = () => null;
    const mw = createTodolistMiddleware(getList);
    expect(mw.name).toBe('todolist');
  });

  it('implements beforeStep', () => {
    const getList = () => null;
    const mw = createTodolistMiddleware(getList);
    expect(mw.beforeStep).toBeDefined();
  });

  it('does not inject when todolist is null', async () => {
    const getList = () => null;
    const mw = createTodolistMiddleware(getList);
    const state = makeState();

    const result = await mw.beforeStep!({
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(result).toBeUndefined();
  });

  it('does not inject when todolist is empty', async () => {
    const getList = () => createEmptyTodoList();
    const mw = createTodolistMiddleware(getList);
    const state = makeState();

    const result = await mw.beforeStep!({
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(result).toBeUndefined();
  });

  it('injects formatted todolist into instructions', async () => {
    let list: TodoList = addTodo(createEmptyTodoList(), 'Task 1');
    list = updateTodo(list, 1, { status: 'in_progress' });
    list = addTodo(list, 'Task 2');

    const getList = () => list;
    const mw = createTodolistMiddleware(getList);
    const state = makeState('Original instructions');

    const result = await mw.beforeStep!({
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(result).toBeDefined();
    expect(result!.state).toBeDefined();
    expect(result!.state!.config.instructions).toContain('=== Current Task List ===');
    expect(result!.state!.config.instructions).toContain('[~]');
    expect(result!.state!.config.instructions).toContain('Task 1');
    expect(result!.state!.config.instructions).toContain('Original instructions');
  });

  it('replaces previous injection without accumulating', async () => {
    let list: TodoList = addTodo(createEmptyTodoList(), 'Task 1');
    const getList = () => list;
    const mw = createTodolistMiddleware(getList);
    const state = makeState('Original instructions');

    // First injection
    const result1 = await mw.beforeStep!({
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    });
    const instructions1 = result1!.state!.config.instructions;

    // Second injection (same list)
    const result2 = await mw.beforeStep!({
      state: result1!.state!,
      stepNumber: 1,
      runnerOptions: {} as any,
    });
    const instructions2 = result2!.state!.config.instructions;

    // Should have exactly one "Current Task List" marker, not two
    const count = (instructions2.match(/=== Current Task List ===/g) || []).length;
    expect(count).toBe(1);

    // Original instructions preserved
    expect(instructions2).toContain('Original instructions');
  });

  it('updates injection when todolist changes', async () => {
    let list: TodoList = addTodo(createEmptyTodoList(), 'Task 1');
    const getList = () => list;
    const mw = createTodolistMiddleware(getList);
    const state = makeState('Original instructions');

    // First injection with 1 task
    const result1 = await mw.beforeStep!({
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    // Add a second task
    list = addTodo(list, 'Task 2');

    // Second injection should show 2 tasks
    const result2 = await mw.beforeStep!({
      state: result1!.state!,
      stepNumber: 1,
      runnerOptions: {} as any,
    });

    expect(result2!.state!.config.instructions).toContain('Task 1');
    expect(result2!.state!.config.instructions).toContain('Task 2');
  });
});
