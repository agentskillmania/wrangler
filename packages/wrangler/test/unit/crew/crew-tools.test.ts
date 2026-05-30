import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  createCreateTaskTool,
  createSendMessageTool,
  createRelayToPrimaryTool,
  createReadCrewTodolistTool,
  createUpdateCrewTodolistTool,
} from '../../../src/crew/crew-tools.js';

describe('crew tools', () => {
  describe('createCreateTaskTool', () => {
    it('calls onCreateTask callback without instructions', async () => {
      const onCreateTask = vi.fn().mockResolvedValue('task-1');
      const tool = createCreateTaskTool({ onCreateTask });
      const result = await tool.execute({ workerType: 'searcher', task: 'search x' });
      expect(onCreateTask).toHaveBeenCalledWith('searcher', 'search x', undefined);
      expect(result).toContain('task-1');
    });

    it('calls onCreateTask callback with instructions', async () => {
      const onCreateTask = vi.fn().mockResolvedValue('task-2');
      const tool = createCreateTaskTool({ onCreateTask });
      const result = await tool.execute({
        workerType: 'custom',
        task: 'do something',
        instructions: 'You are a custom agent.',
      });
      expect(onCreateTask).toHaveBeenCalledWith(
        'custom',
        'do something',
        'You are a custom agent.'
      );
      expect(result).toContain('task-2');
    });

    it('throws callback error', async () => {
      const onCreateTask = vi.fn().mockRejectedValue(new Error('boom'));
      const tool = createCreateTaskTool({ onCreateTask });
      await expect(tool.execute({ workerType: 'searcher', task: 'search x' })).rejects.toThrow(
        'boom'
      );
    });
  });

  describe('createSendMessageTool', () => {
    it('enqueues message to target', async () => {
      const onSend = vi.fn().mockResolvedValue(undefined);
      const tool = createSendMessageTool({ onSend });
      await tool.execute({ to: 'liaison-1', content: 'hello' });
      expect(onSend).toHaveBeenCalledWith('liaison-1', 'hello');
    });
  });

  describe('createRelayToPrimaryTool', () => {
    it('enqueues message to primary', async () => {
      const onRelay = vi.fn().mockResolvedValue(undefined);
      const tool = createRelayToPrimaryTool({ onRelay });
      await tool.execute({ content: 'important update' });
      expect(onRelay).toHaveBeenCalledWith('important update');
    });
  });

  describe('createReadCrewTodolistTool', () => {
    it('returns formatted todolist', async () => {
      const getTodolist = vi.fn().mockReturnValue([
        { id: '1', content: 'task A', status: 'pending' },
        { id: '2', content: 'task B', status: 'completed' },
      ]);
      const tool = createReadCrewTodolistTool({ getTodolist });
      const result = await tool.execute({});
      expect(result).toContain('task A');
      expect(result).toContain('task B');
      expect(result).toContain('pending');
      expect(result).toContain('completed');
    });

    it('returns empty message when no items', async () => {
      const getTodolist = vi.fn().mockReturnValue([]);
      const tool = createReadCrewTodolistTool({ getTodolist });
      const result = await tool.execute({});
      expect(result).toContain('empty');
    });
  });

  describe('createUpdateCrewTodolistTool', () => {
    it('calls onUpdate', async () => {
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const tool = createUpdateCrewTodolistTool({ onUpdate });
      const result = await tool.execute({ itemId: '1', status: 'completed' });
      expect(onUpdate).toHaveBeenCalledWith('1', 'completed');
      expect(result).toContain('completed');
    });
  });

  // ── Tool metadata tests ─────────────────────────────────────────────

  describe('tool metadata', () => {
    it('create_task should have correct name and description', () => {
      const tool = createCreateTaskTool({ onCreateTask: vi.fn() });
      expect(tool.name).toBe('create_task');
      expect(tool.description).toContain('worker');
      expect(tool.parameters).toBeInstanceOf(z.ZodObject);
    });

    it('send_message should have correct name and description', () => {
      const tool = createSendMessageTool({ onSend: vi.fn() });
      expect(tool.name).toBe('send_message');
      expect(tool.description).toContain('message');
    });

    it('relay_to_primary should have correct name and description', () => {
      const tool = createRelayToPrimaryTool({ onRelay: vi.fn() });
      expect(tool.name).toBe('relay_to_primary');
      expect(tool.description).toContain('primary');
    });

    it('read_crew_todolist should have correct name', () => {
      const tool = createReadCrewTodolistTool({ getTodolist: vi.fn().mockReturnValue([]) });
      expect(tool.name).toBe('read_crew_todolist');
    });

    it('update_crew_todolist should have correct name', () => {
      const tool = createUpdateCrewTodolistTool({ onUpdate: vi.fn() });
      expect(tool.name).toBe('update_crew_todolist');
    });
  });

  // ── Zod schema validation tests ─────────────────────────────────────

  describe('schema validation', () => {
    it('create_task should reject missing workerType', () => {
      const tool = createCreateTaskTool({ onCreateTask: vi.fn() });
      const schema = tool.parameters as z.ZodObject<z.ZodRawShape>;
      const result = schema.safeParse({ task: 'do something' });
      expect(result.success).toBe(false);
    });

    it('create_task should reject missing task', () => {
      const tool = createCreateTaskTool({ onCreateTask: vi.fn() });
      const schema = tool.parameters as z.ZodObject<z.ZodRawShape>;
      const result = schema.safeParse({ workerType: 'searcher' });
      expect(result.success).toBe(false);
    });

    it('send_message should reject missing to field', () => {
      const tool = createSendMessageTool({ onSend: vi.fn() });
      const schema = tool.parameters as z.ZodObject<z.ZodRawShape>;
      const result = schema.safeParse({ content: 'hello' });
      expect(result.success).toBe(false);
    });

    it('send_message should reject missing content field', () => {
      const tool = createSendMessageTool({ onSend: vi.fn() });
      const schema = tool.parameters as z.ZodObject<z.ZodRawShape>;
      const result = schema.safeParse({ to: 'agent-1' });
      expect(result.success).toBe(false);
    });

    it('update_crew_todolist should reject invalid status', () => {
      const tool = createUpdateCrewTodolistTool({ onUpdate: vi.fn() });
      const schema = tool.parameters as z.ZodObject<z.ZodRawShape>;
      const result = schema.safeParse({ itemId: '1', status: 'done' });
      expect(result.success).toBe(false);
    });
  });
});
