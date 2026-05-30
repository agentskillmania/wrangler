/**
 * @fileoverview Todolist tool tests — Zod schema validation and output contract
 *
 * The execute function is a passthrough ({ _todo: true, actions }).
 * Schema validation is done by the colts framework before calling execute,
 * so we test the schema directly via safeParse.
 * These tests verify schema rejection of invalid inputs and correct output structure.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createTodolistTool } from '../../../src/todolist/todo-tool.js';

describe('todo-tool', () => {
  describe('tool metadata', () => {
    it('should have correct name and description', () => {
      const tool = createTodolistTool();
      expect(tool.name).toBe('todolist');
      expect(tool.description).toContain('Manage your task list');
      expect(tool.parameters).toBeInstanceOf(z.ZodObject);
    });
  });

  describe('schema validation — reject invalid inputs', () => {
    it('should reject actions with invalid action type', () => {
      const tool = createTodolistTool();
      const schema = tool.parameters as z.ZodObject<any>;
      const result = schema.safeParse({
        actions: [{ action: 'explode', subject: 'test' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject actions missing required subject on create', () => {
      const tool = createTodolistTool();
      const schema = tool.parameters as z.ZodObject<any>;
      const result = schema.safeParse({
        actions: [{ action: 'create' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject update action missing required id', () => {
      const tool = createTodolistTool();
      const schema = tool.parameters as z.ZodObject<any>;
      const result = schema.safeParse({
        actions: [{ action: 'update', status: 'in_progress' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject delete action missing required id', () => {
      const tool = createTodolistTool();
      const schema = tool.parameters as z.ZodObject<any>;
      const result = schema.safeParse({
        actions: [{ action: 'delete' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject update action with invalid status', () => {
      const tool = createTodolistTool();
      const schema = tool.parameters as z.ZodObject<any>;
      const result = schema.safeParse({
        actions: [{ action: 'update', id: 1, status: 'done' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-array actions', () => {
      const tool = createTodolistTool();
      const schema = tool.parameters as z.ZodObject<any>;
      const result = schema.safeParse({
        actions: 'not an array',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('execute — happy path', () => {
    it('should return _todo:true with valid create action', async () => {
      const tool = createTodolistTool();
      const actions = [{ action: 'create' as const, subject: 'Test task' }];
      const result = await tool.execute({ actions });

      expect(result).toEqual({ _todo: true, actions });
      expect(result.actions[0]).toEqual({ action: 'create', subject: 'Test task' });
    });

    it('should return _todo:true with valid update action', async () => {
      const tool = createTodolistTool();
      const actions = [{ action: 'update' as const, id: 1, status: 'in_progress' as const }];
      const result = await tool.execute({ actions });

      expect(result).toEqual({ _todo: true, actions });
    });

    it('should return _todo:true with valid delete action', async () => {
      const tool = createTodolistTool();
      const actions = [{ action: 'delete' as const, id: 5 }];
      const result = await tool.execute({ actions });

      expect(result).toEqual({ _todo: true, actions });
    });

    it('should accept a batch of mixed action types', async () => {
      const tool = createTodolistTool();
      const actions = [
        { action: 'create' as const, subject: 'First' },
        { action: 'update' as const, id: 1, status: 'in_progress' as const },
        { action: 'delete' as const, id: 2 },
      ];
      const result = await tool.execute({ actions });

      expect(result._todo).toBe(true);
      expect(result.actions).toHaveLength(3);
    });
  });
});
