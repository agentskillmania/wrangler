import { describe, it, expect } from 'vitest';
import { createTodolistSupport } from '../../../src/todolist/support.js';
import { createEmptyTodoList, addTodo } from '../../../src/todolist/todo-state.js';

describe('createTodolistSupport', () => {
  it('returns tools array with todolist tool and middleware', () => {
    const support = createTodolistSupport();

    expect(support.tools).toHaveLength(1);
    expect(support.tools[0].name).toBe('todolist');
    expect(support.middleware).toBeDefined();
    expect(support.middleware.name).toBe('todolist');
  });

  it('takes no arguments', () => {
    const support = createTodolistSupport();
    expect(support).toBeDefined();
  });

  it('tool returns structured todo result', async () => {
    const support = createTodolistSupport();

    const result = await support.tools[0].execute({
      actions: [{ action: 'create', subject: 'Test task' }],
    });

    expect(result).toEqual({
      _todo: true,
      actions: [{ action: 'create', subject: 'Test task' }],
    });
  });

  it('middleware has beforeStep and afterStep hooks', () => {
    const support = createTodolistSupport();

    expect(support.middleware.beforeStep).toBeDefined();
    expect(support.middleware.afterStep).toBeDefined();
  });

  it('middleware auto-initializes todoList in beforeStep', async () => {
    const support = createTodolistSupport();
    const state = {
      id: 'test',
      config: { name: 'test-agent', instructions: '', tools: [] },
      context: {
        messages: [],
        stepCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        // No todoList set
      },
    } as any;

    const result = await support.middleware.beforeStep!({
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(result).toBeDefined();
    expect(result!.state!.context.todoList).toBeDefined();
    expect(result!.state!.context.todoList.items).toHaveLength(0);
  });

  it('middleware applies todo actions in afterStep', async () => {
    const support = createTodolistSupport();
    const state = {
      id: 'test',
      config: { name: 'test-agent', instructions: '', tools: [] },
      context: {
        messages: [],
        stepCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        todoList: createEmptyTodoList(),
      },
    } as any;

    const result = await support.middleware.afterStep!({
      result: {
        type: 'continue',
        toolResult: {
          _todo: true,
          actions: [
            { action: 'create', subject: 'New task' },
            { action: 'create', subject: 'Another task' },
          ],
        },
      },
      state,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(result).toBeDefined();
    expect(result!.state!.context.todoList.items).toHaveLength(2);
    expect(result!.state!.context.todoList.items[0].subject).toBe('New task');
    expect(result!.state!.context.todoList.items[1].subject).toBe('Another task');
  });
});
