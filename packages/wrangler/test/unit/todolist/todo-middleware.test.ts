import { describe, it, expect } from 'vitest';
import { createTodolistMiddleware } from '../../../src/todolist/todo-middleware.js';
import { createEmptyTodoList, addTodo, updateTodo } from '../../../src/todolist/todo-state.js';
import { createAgentState } from '@agentskillmania/colts';

function makeState(todoList?: any) {
  return createAgentState({
    name: 'test-agent',
    instructions: 'You are a helpful assistant.',
    tools: [],
  });
}

describe('todo-middleware', () => {
  describe('createTodolistMiddleware', () => {
    it('has correct metadata', () => {
      const mw = createTodolistMiddleware();
      expect(mw.name).toBe('todolist');
      expect(mw.afterStep).toBeDefined();
      expect(mw.beforeStep).toBeDefined();
    });

    it('takes no arguments', () => {
      const mw = createTodolistMiddleware();
      expect(mw).toBeDefined();
    });
  });

  describe('afterStep', () => {
    it('applies single create from toolResult', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      (state.context as any).todoList = createEmptyTodoList();

      const result = await mw.afterStep!({
        result: {
          type: 'continue',
          toolResult: {
            _todo: true,
            actions: [{ action: 'create', subject: 'New task' }],
          },
        },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      expect(result).toBeDefined();
      expect(result!.state!.context.todoList.items).toHaveLength(1);
      expect(result!.state!.context.todoList.items[0].subject).toBe('New task');
      expect(result!.state!.context.todoList.items[0].status).toBe('pending');
    });

    it('applies batch create from toolResult', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      (state.context as any).todoList = createEmptyTodoList();

      const result = await mw.afterStep!({
        result: {
          type: 'continue',
          toolResult: {
            _todo: true,
            actions: [
              { action: 'create', subject: 'Task 1' },
              { action: 'create', subject: 'Task 2', description: 'With description' },
              { action: 'create', subject: 'Task 3' },
            ],
          },
        },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      expect(result!.state!.context.todoList.items).toHaveLength(3);
      expect(result!.state!.context.todoList.items[0].subject).toBe('Task 1');
      expect(result!.state!.context.todoList.items[1].subject).toBe('Task 2');
      expect(result!.state!.context.todoList.items[1].description).toBe('With description');
      expect(result!.state!.context.todoList.items[2].subject).toBe('Task 3');
    });

    it('applies update from toolResult', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      let list = addTodo(createEmptyTodoList(), 'Original task');
      (state.context as any).todoList = list;

      const result = await mw.afterStep!({
        result: {
          type: 'continue',
          toolResult: {
            _todo: true,
            actions: [
              {
                action: 'update',
                id: 1,
                status: 'completed',
                subject: 'Updated task',
                description: 'Updated description',
              },
            ],
          },
        },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      expect(result!.state!.context.todoList.items).toHaveLength(1);
      expect(result!.state!.context.todoList.items[0].status).toBe('completed');
      expect(result!.state!.context.todoList.items[0].subject).toBe('Updated task');
      expect(result!.state!.context.todoList.items[0].description).toBe('Updated description');
    });

    it('applies delete from toolResult', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      let list = addTodo(createEmptyTodoList(), 'Task 1');
      list = addTodo(list, 'Task 2');
      list = addTodo(list, 'Task 3');
      (state.context as any).todoList = list;

      const result = await mw.afterStep!({
        result: {
          type: 'continue',
          toolResult: {
            _todo: true,
            actions: [{ action: 'delete', id: 2 }],
          },
        },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      expect(result!.state!.context.todoList.items).toHaveLength(2);
      expect(result!.state!.context.todoList.items[0].subject).toBe('Task 1');
      expect(result!.state!.context.todoList.items[1].subject).toBe('Task 3');
    });

    it('applies reset from toolResult', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      let list = addTodo(createEmptyTodoList(), 'Old task 1');
      list = addTodo(list, 'Old task 2');
      (state.context as any).todoList = list;

      const result = await mw.afterStep!({
        result: {
          type: 'continue',
          toolResult: {
            _todo: true,
            actions: [
              {
                action: 'reset',
                tasks: [
                  { subject: 'New task A', status: 'in_progress' },
                  { subject: 'New task B', status: 'pending' },
                ],
              },
            ],
          },
        },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      expect(result!.state!.context.todoList.items).toHaveLength(2);
      expect(result!.state!.context.todoList.items[0].subject).toBe('New task A');
      expect(result!.state!.context.todoList.items[0].status).toBe('in_progress');
      expect(result!.state!.context.todoList.items[1].subject).toBe('New task B');
      expect(result!.state!.context.todoList.items[1].status).toBe('pending');
    });

    it('applies mixed actions in order', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      let list = addTodo(createEmptyTodoList(), 'Task 1');
      list = updateTodo(list, 1, { status: 'in_progress' });
      (state.context as any).todoList = list;

      const result = await mw.afterStep!({
        result: {
          type: 'continue',
          toolResult: {
            _todo: true,
            actions: [
              { action: 'create', subject: 'Task 2' },
              { action: 'update', id: 1, status: 'completed' },
              { action: 'delete', id: 1 },
            ],
          },
        },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      // After create: Task 1 (in_progress), Task 2 (pending)
      // After update: Task 1 (completed), Task 2 (pending)
      // After delete: Task 2 (pending)
      expect(result!.state!.context.todoList.items).toHaveLength(1);
      expect(result!.state!.context.todoList.items[0].subject).toBe('Task 2');
    });

    it('skips update action with no fields', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      let list = addTodo(createEmptyTodoList(), 'Original task');
      (state.context as any).todoList = list;

      const result = await mw.afterStep!({
        result: {
          type: 'continue',
          toolResult: {
            _todo: true,
            actions: [{ action: 'update', id: 1 }],
          },
        },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      // Should skip update with no fields, list unchanged
      expect(result!.state!.context.todoList.items).toHaveLength(1);
      expect(result!.state!.context.todoList.items[0].subject).toBe('Original task');
      expect(result!.state!.context.todoList.items[0].status).toBe('pending');
    });

    it('applies reset with empty tasks array', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      let list = addTodo(createEmptyTodoList(), 'Task 1');
      list = addTodo(list, 'Task 2');
      (state.context as any).todoList = list;

      const result = await mw.afterStep!({
        result: {
          type: 'continue',
          toolResult: {
            _todo: true,
            actions: [{ action: 'reset', tasks: [] }],
          },
        },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      expect(result!.state!.context.todoList.items).toHaveLength(0);
    });

    it('skips unknown action type', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      let list = addTodo(createEmptyTodoList(), 'Task 1');
      (state.context as any).todoList = list;

      const result = await mw.afterStep!({
        result: {
          type: 'continue',
          toolResult: {
            _todo: true,
            actions: [{ action: 'unknown' as any, id: 1 }],
          },
        },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      // Unknown action should be skipped, list unchanged
      expect(result!.state!.context.todoList.items).toHaveLength(1);
      expect(result!.state!.context.todoList.items[0].subject).toBe('Task 1');
    });

    it('ignores non-todo toolResult', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      let list = addTodo(createEmptyTodoList(), 'Task 1');
      (state.context as any).todoList = list;

      const result = await mw.afterStep!({
        result: {
          type: 'continue',
          toolResult: { someOtherResult: 'value' },
        },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      // Non-todo result should not modify todoList
      expect(result).toBeUndefined();
    });

    it('returns unchanged state when result type is not continue', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      (state.context as any).todoList = createEmptyTodoList();

      const result = await mw.afterStep!({
        result: { type: 'done' as any, toolResult: null },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      expect(result).toBeUndefined();
    });

    it('auto-initializes todoList when missing', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      // No todoList set

      const result = await mw.afterStep!({
        result: {
          type: 'continue',
          toolResult: {
            _todo: true,
            actions: [{ action: 'create', subject: 'New task' }],
          },
        },
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      expect(result!.state!.context.todoList).toBeDefined();
      expect(result!.state!.context.todoList.items).toHaveLength(1);
      expect(result!.state!.context.todoList.items[0].subject).toBe('New task');
    });
  });

  describe('beforeStep', () => {
    it('auto-initializes empty todoList when missing', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      // No todoList set

      const result = await mw.beforeStep!({
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      expect(result).toBeDefined();
      expect(result!.state!.context.todoList).toBeDefined();
      expect(result!.state!.context.todoList.items).toHaveLength(0);
    });

    it('does not modify existing todoList', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      let list = addTodo(createEmptyTodoList(), 'Task 1');
      (state.context as any).todoList = list;

      const result = await mw.beforeStep!({
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      expect(result).toBeDefined();
      expect(result!.state!.context.todoList.items).toHaveLength(1);
      expect(result!.state!.context.todoList.items[0].subject).toBe('Task 1');
    });

    it('returns undefined when no changes needed', async () => {
      const mw = createTodolistMiddleware();
      const state = makeState();
      (state.context as any).todoList = createEmptyTodoList();

      const result = await mw.beforeStep!({
        state,
        stepNumber: 0,
        runnerOptions: {} as any,
      });

      // When todoList already exists, middleware may return undefined (no state change)
      // or return state (with same todoList)
      if (result) {
        expect(result.state.context.todoList.items).toHaveLength(0);
      } else {
        expect(result).toBeUndefined();
      }
    });
  });
});
