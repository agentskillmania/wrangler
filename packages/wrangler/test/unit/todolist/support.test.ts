import { describe, it, expect } from 'vitest';
import { createTodolistSupport } from '../../../src/todolist/support.js';
import { createEmptyTodoList } from '../../../src/todolist/todo-state.js';
import type { TodoList } from '../../../src/todolist/types.js';

describe('createTodolistSupport', () => {
  it('returns tools array with todolist tool and middleware', () => {
    let list: TodoList | null = null;
    const support = createTodolistSupport({
      getList: () => list,
      setList: (l) => {
        list = l;
      },
    });

    expect(support.tools).toHaveLength(1);
    expect(support.tools[0].name).toBe('todolist');
    expect(support.middleware).toBeDefined();
    expect(support.middleware.name).toBe('todolist');
  });

  it('tool executes create action through support', async () => {
    let list: TodoList | null = null;
    const support = createTodolistSupport({
      getList: () => list,
      setList: (l) => {
        list = l;
      },
    });

    const result = await support.tools[0].execute({
      action: 'create',
      subject: 'Test task',
    });

    expect(result).toContain('Test task');
    expect(list).not.toBeNull();
    expect(list!.items).toHaveLength(1);
  });

  it('tool works with pre-existing list', async () => {
    let list: TodoList | null = createEmptyTodoList();
    const support = createTodolistSupport({
      getList: () => list,
      setList: (l) => {
        list = l;
      },
    });

    const result = await support.tools[0].execute({ action: 'list' });
    expect(result).toContain('No tasks');
  });
});
