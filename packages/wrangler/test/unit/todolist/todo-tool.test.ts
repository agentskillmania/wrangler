import { describe, it, expect } from 'vitest';
import { createTodolistTool } from '../../../src/todolist/todo-tool.js';

describe('todo-tool', () => {
  describe('createTodolistTool', () => {
    it('has correct tool metadata', () => {
      const tool = createTodolistTool();
      expect(tool.name).toBe('todolist');
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
    });

    it('takes no arguments', () => {
      const tool = createTodolistTool();
      expect(tool).toBeDefined();
    });
  });

  describe('execute', () => {
    it('returns _todo: true with actions array', async () => {
      const tool = createTodolistTool();
      const actions = [{ action: 'create', subject: 'Test task' }];
      const result = await tool.execute({ actions });

      expect(result).toEqual({ _todo: true, actions });
    });

    it('create action passes through subject and description', async () => {
      const tool = createTodolistTool();
      const actions = [
        { action: 'create', subject: 'Task with desc', description: 'Details here' },
      ];
      const result = await tool.execute({ actions });

      expect(result).toEqual({ _todo: true, actions });
      expect(result.actions[0]).toEqual({
        action: 'create',
        subject: 'Task with desc',
        description: 'Details here',
      });
    });

    it('update action passes through id, status, subject', async () => {
      const tool = createTodolistTool();
      const actions = [
        {
          action: 'update',
          id: 1,
          status: 'in_progress',
          subject: 'Updated task',
          description: 'Updated description',
        },
      ];
      const result = await tool.execute({ actions });

      expect(result).toEqual({ _todo: true, actions });
      expect(result.actions[0]).toEqual({
        action: 'update',
        id: 1,
        status: 'in_progress',
        subject: 'Updated task',
        description: 'Updated description',
      });
    });

    it('delete action passes through id', async () => {
      const tool = createTodolistTool();
      const actions = [{ action: 'delete', id: 5 }];
      const result = await tool.execute({ actions });

      expect(result).toEqual({ _todo: true, actions });
      expect(result.actions[0]).toEqual({
        action: 'delete',
        id: 5,
      });
    });

    it('reset action passes through tasks array', async () => {
      const tool = createTodolistTool();
      const actions = [
        {
          action: 'reset',
          tasks: [
            { subject: 'New task 1', status: 'pending' },
            { subject: 'New task 2', status: 'completed', description: 'Done' },
          ],
        },
      ];
      const result = await tool.execute({ actions });

      expect(result).toEqual({ _todo: true, actions });
      expect(result.actions[0]).toEqual({
        action: 'reset',
        tasks: [
          { subject: 'New task 1', status: 'pending' },
          { subject: 'New task 2', status: 'completed', description: 'Done' },
        ],
      });
    });

    it('multiple actions in one call', async () => {
      const tool = createTodolistTool();
      const actions = [
        { action: 'create', subject: 'First task' },
        { action: 'update', id: 1, status: 'in_progress' },
        { action: 'delete', id: 2 },
      ];
      const result = await tool.execute({ actions });

      expect(result).toEqual({ _todo: true, actions });
      expect(result.actions).toHaveLength(3);
    });

    it('empty actions array returns _todo with empty array', async () => {
      const tool = createTodolistTool();
      const actions: any[] = [];
      const result = await tool.execute({ actions });

      expect(result).toEqual({ _todo: true, actions: [] });
    });
  });
});
