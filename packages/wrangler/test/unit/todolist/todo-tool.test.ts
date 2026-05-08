import { describe, it, expect, vi } from 'vitest';
import { createTodolistTool } from '../../../src/todolist/todo-tool.js';
import { createEmptyTodoList, addTodo, updateTodo } from '../../../src/todolist/todo-state.js';
import type { TodoList } from '../../../src/todolist/types.js';

describe('todolist tool', () => {
  it('works when getList returns null', async () => {
    let list: TodoList | null = null;
    const getList = () => list;
    const setList = (l: TodoList) => {
      list = l;
    };
    const tool = createTodolistTool(getList, setList);

    const result = await tool.execute({ action: 'create', subject: 'From null' });
    expect(result).toContain('From null');
    expect(list).not.toBeNull();
  });

  it('has correct tool metadata', () => {
    const getList = vi.fn(() => createEmptyTodoList());
    const tool = createTodolistTool(getList);
    expect(tool.name).toBe('todolist');
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toBeDefined();
  });

  // --- create ---

  describe('create action', () => {
    it('creates a new task', async () => {
      let list: TodoList = createEmptyTodoList();
      const getList = () => list;
      const setList = (l: TodoList) => {
        list = l;
      };
      const tool = createTodolistTool(getList, setList);

      const result = await tool.execute({ action: 'create', subject: 'Task 1' });
      expect(result).toContain('Task 1');
      expect(result).toContain('[ ]');
      expect(list.items).toHaveLength(1);
    });

    it('creates task with description', async () => {
      let list: TodoList = createEmptyTodoList();
      const getList = () => list;
      const setList = (l: TodoList) => {
        list = l;
      };
      const tool = createTodolistTool(getList, setList);

      const result = await tool.execute({
        action: 'create',
        subject: 'Task 1',
        description: 'Details here',
      });
      expect(result).toContain('Task 1');
      expect(list.items[0].description).toBe('Details here');
    });

    it('creates task with initial status', async () => {
      let list: TodoList = createEmptyTodoList();
      const getList = () => list;
      const setList = (l: TodoList) => {
        list = l;
      };
      const tool = createTodolistTool(getList, setList);

      const result = await tool.execute({
        action: 'create',
        subject: 'Already done',
        status: 'completed',
      });
      expect(result).toContain('[x]');
      expect(list.items[0].status).toBe('completed');
    });

    it('does not call setList when not provided', async () => {
      const list = createEmptyTodoList();
      const getList = () => list;
      const tool = createTodolistTool(getList);

      // Should not throw
      const result = await tool.execute({ action: 'create', subject: 'Task 1' });
      expect(result).toContain('Task 1');
    });

    it('returns error when subject is missing', async () => {
      const getList = () => createEmptyTodoList();
      const tool = createTodolistTool(getList);

      const result = await tool.execute({ action: 'create' });
      expect(result).toContain('Error');
      expect(result).toContain('subject');
    });
  });

  // --- update ---

  describe('update action', () => {
    it('updates task status', async () => {
      let list: TodoList = addTodo(createEmptyTodoList(), 'Task 1');
      const getList = () => list;
      const setList = (l: TodoList) => {
        list = l;
      };
      const tool = createTodolistTool(getList, setList);

      const result = await tool.execute({
        action: 'update',
        id: 1,
        status: 'in_progress',
      });
      expect(result).toContain('[~]');
    });

    it('returns error for non-existent id', async () => {
      const list = createEmptyTodoList();
      const getList = () => list;
      const tool = createTodolistTool(getList);

      const result = await tool.execute({
        action: 'update',
        id: 99,
        status: 'completed',
      });
      expect(result).toContain('Error');
      expect(result).toContain('99');
    });

    it('returns error when id is missing', async () => {
      const getList = () => createEmptyTodoList();
      const tool = createTodolistTool(getList);

      const result = await tool.execute({ action: 'update', status: 'completed' });
      expect(result).toContain('Error');
      expect(result).toContain('id');
    });

    it('updates subject and description together', async () => {
      let list: TodoList = addTodo(createEmptyTodoList(), 'Task 1');
      const getList = () => list;
      const setList = (l: TodoList) => {
        list = l;
      };
      const tool = createTodolistTool(getList, setList);

      const result = await tool.execute({
        action: 'update',
        id: 1,
        subject: 'Renamed',
        description: 'New desc',
      });
      expect(result).toContain('Renamed');
      expect(list.items[0].subject).toBe('Renamed');
      expect(list.items[0].description).toBe('New desc');
    });
  });

  // --- delete ---

  describe('delete action', () => {
    it('deletes a task', async () => {
      let list: TodoList = addTodo(createEmptyTodoList(), 'Task 1');
      list = addTodo(list, 'Task 2');
      const getList = () => list;
      const setList = (l: TodoList) => {
        list = l;
      };
      const tool = createTodolistTool(getList, setList);

      const result = await tool.execute({ action: 'delete', id: 1 });
      expect(result).not.toContain('Task 1');
      expect(result).toContain('Task 2');
    });

    it('returns error for non-existent id', async () => {
      const list = createEmptyTodoList();
      const getList = () => list;
      const tool = createTodolistTool(getList);

      const result = await tool.execute({ action: 'delete', id: 99 });
      expect(result).toContain('Error');
    });

    it('returns error when id is missing', async () => {
      const getList = () => createEmptyTodoList();
      const tool = createTodolistTool(getList);

      const result = await tool.execute({ action: 'delete' });
      expect(result).toContain('Error');
      expect(result).toContain('id');
    });
  });

  // --- list ---

  describe('list action', () => {
    it('returns current task list', async () => {
      let list: TodoList = addTodo(createEmptyTodoList(), 'Task 1');
      list = updateTodo(list, 1, { status: 'completed' });
      const getList = () => list;
      const tool = createTodolistTool(getList);

      const result = await tool.execute({ action: 'list' });
      expect(result).toContain('Task 1');
      expect(result).toContain('[x]');
    });

    it('returns message for empty list', async () => {
      const getList = () => createEmptyTodoList();
      const tool = createTodolistTool(getList);

      const result = await tool.execute({ action: 'list' });
      expect(result).toContain('No tasks');
    });
  });

  // --- reset ---

  describe('reset action', () => {
    it('replaces entire list with new tasks', async () => {
      let list: TodoList = addTodo(createEmptyTodoList(), 'Old task 1');
      list = addTodo(list, 'Old task 2');
      const getList = () => list;
      const setList = (l: TodoList) => {
        list = l;
      };
      const tool = createTodolistTool(getList, setList);

      const result = await tool.execute({
        action: 'reset',
        tasks: [{ subject: 'New task A' }, { subject: 'New task B', description: 'With details' }],
      });

      expect(result).not.toContain('Old task');
      expect(result).toContain('New task A');
      expect(result).toContain('New task B');
      expect(list.items).toHaveLength(2);
      expect(list.items[0].id).toBe(1);
      expect(list.items[1].id).toBe(2);
      expect(list.items[1].description).toBe('With details');
    });

    it('respects initial status in reset tasks', async () => {
      let list: TodoList = createEmptyTodoList();
      const getList = () => list;
      const setList = (l: TodoList) => {
        list = l;
      };
      const tool = createTodolistTool(getList, setList);

      const result = await tool.execute({
        action: 'reset',
        tasks: [
          { subject: 'Done task', status: 'completed' },
          { subject: 'Active task', status: 'in_progress' },
          { subject: 'Pending task' },
        ],
      });

      expect(result).toContain('[x]');
      expect(result).toContain('[~]');
      expect(result).toContain('[ ]');
      expect(list.items[0].status).toBe('completed');
      expect(list.items[1].status).toBe('in_progress');
      expect(list.items[2].status).toBe('pending');
    });

    it('returns error when tasks is empty', async () => {
      const getList = () => createEmptyTodoList();
      const tool = createTodolistTool(getList);

      const result = await tool.execute({ action: 'reset', tasks: [] });
      expect(result).toContain('Error');
    });

    it('returns error when tasks is missing', async () => {
      const getList = () => createEmptyTodoList();
      const tool = createTodolistTool(getList);

      const result = await tool.execute({ action: 'reset' });
      expect(result).toContain('Error');
    });
  });

  // --- unknown action ---

  it('returns error for unknown action', async () => {
    const getList = () => createEmptyTodoList();
    const tool = createTodolistTool(getList);

    const result = await tool.execute({ action: 'unknown' as any });
    expect(result).toContain('Error');
    expect(result).toContain('Unknown action');
  });
});
