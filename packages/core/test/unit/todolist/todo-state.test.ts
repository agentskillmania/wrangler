import { describe, it, expect } from 'vitest';
import {
  createEmptyTodoList,
  addTodo,
  updateTodo,
  deleteTodo,
  formatTodoForContext,
} from '../../../src/todolist/todo-state.js';

describe('todo-state', () => {
  // --- createEmptyTodoList ---

  describe('createEmptyTodoList', () => {
    it('returns empty list with nextId=1', () => {
      const list = createEmptyTodoList();
      expect(list.items).toEqual([]);
      expect(list.nextId).toBe(1);
    });
  });

  // --- addTodo ---

  describe('addTodo', () => {
    it('adds item with auto-incremented id', () => {
      const list = createEmptyTodoList();
      const updated = addTodo(list, 'Task 1');
      expect(updated.items).toHaveLength(1);
      expect(updated.items[0]).toMatchObject({
        id: 1,
        subject: 'Task 1',
        status: 'pending',
      });
      expect(updated.nextId).toBe(2);
    });

    it('adds item with optional description', () => {
      const list = createEmptyTodoList();
      const updated = addTodo(list, 'Task 1', 'Some details');
      expect(updated.items[0].description).toBe('Some details');
    });

    it('does not mutate original list', () => {
      const list = createEmptyTodoList();
      addTodo(list, 'Task 1');
      expect(list.items).toEqual([]);
      expect(list.nextId).toBe(1);
    });

    it('adds multiple items with sequential ids', () => {
      let list = createEmptyTodoList();
      list = addTodo(list, 'Task 1');
      list = addTodo(list, 'Task 2');
      list = addTodo(list, 'Task 3');
      expect(list.items.map((i) => i.id)).toEqual([1, 2, 3]);
      expect(list.nextId).toBe(4);
    });
  });

  // --- updateTodo ---

  describe('updateTodo', () => {
    it('updates status', () => {
      let list = createEmptyTodoList();
      list = addTodo(list, 'Task 1');
      const updated = updateTodo(list, 1, { status: 'in_progress' });
      expect(updated.items[0].status).toBe('in_progress');
    });

    it('updates subject', () => {
      let list = createEmptyTodoList();
      list = addTodo(list, 'Task 1');
      const updated = updateTodo(list, 1, { subject: 'Renamed' });
      expect(updated.items[0].subject).toBe('Renamed');
    });

    it('updates description', () => {
      let list = createEmptyTodoList();
      list = addTodo(list, 'Task 1');
      const updated = updateTodo(list, 1, { description: 'New desc' });
      expect(updated.items[0].description).toBe('New desc');
    });

    it('throws for non-existent id', () => {
      const list = createEmptyTodoList();
      expect(() => updateTodo(list, 99, { status: 'completed' })).toThrow('Todo item 99 not found');
    });

    it('does not mutate original list', () => {
      let list = createEmptyTodoList();
      list = addTodo(list, 'Task 1');
      updateTodo(list, 1, { status: 'completed' });
      expect(list.items[0].status).toBe('pending');
    });

    it('preserves other fields when partially updating', () => {
      let list = createEmptyTodoList();
      list = addTodo(list, 'Task 1', 'Original desc');
      const updated = updateTodo(list, 1, { status: 'in_progress' });
      expect(updated.items[0].subject).toBe('Task 1');
      expect(updated.items[0].description).toBe('Original desc');
    });
  });

  // --- deleteTodo ---

  describe('deleteTodo', () => {
    it('removes item by id', () => {
      let list = createEmptyTodoList();
      list = addTodo(list, 'Task 1');
      list = addTodo(list, 'Task 2');
      const updated = deleteTodo(list, 1);
      expect(updated.items).toHaveLength(1);
      expect(updated.items[0].id).toBe(2);
    });

    it('throws for non-existent id', () => {
      const list = createEmptyTodoList();
      expect(() => deleteTodo(list, 99)).toThrow('Todo item 99 not found');
    });

    it('does not mutate original list', () => {
      let list = createEmptyTodoList();
      list = addTodo(list, 'Task 1');
      deleteTodo(list, 1);
      expect(list.items).toHaveLength(1);
    });

    it('deleting from empty list throws', () => {
      const list = createEmptyTodoList();
      expect(() => deleteTodo(list, 1)).toThrow('Todo item 1 not found');
    });
  });

  // --- formatTodoForContext ---

  describe('formatTodoForContext', () => {
    it('returns empty string for empty list', () => {
      const list = createEmptyTodoList();
      expect(formatTodoForContext(list)).toBe('');
    });

    it('formats items with status indicators', () => {
      let list = createEmptyTodoList();
      list = addTodo(list, 'Design schema');
      list = updateTodo(list, 1, { status: 'completed' });
      list = addTodo(list, 'Implement model');
      list = updateTodo(list, 2, { status: 'in_progress' });
      list = addTodo(list, 'Write tests');

      const output = formatTodoForContext(list);
      expect(output).toContain('[x]');
      expect(output).toContain('[~]');
      expect(output).toContain('[ ]');
      expect(output).toContain('Design schema');
      expect(output).toContain('Implement model');
      expect(output).toContain('Write tests');
    });

    it('shows blockedBy info', () => {
      let list = createEmptyTodoList();
      list = addTodo(list, 'Task 1');
      list = addTodo(list, 'Task 2');
      list = updateTodo(list, 2, { blockedBy: [1] });

      const output = formatTodoForContext(list);
      expect(output).toContain('blocked by: 1');
    });

    it('includes boundary markers', () => {
      let list = createEmptyTodoList();
      list = addTodo(list, 'Task 1');

      const output = formatTodoForContext(list);
      expect(output).toContain('=== Current Task List ===');
      expect(output).toContain('===');
    });
  });
});
