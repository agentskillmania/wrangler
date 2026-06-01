import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createCreateTaskTool, createSendMessageTool } from '../../../src/crew/crew-tools.js';

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
    it('enqueues message to target worker', async () => {
      const onSend = vi.fn().mockResolvedValue(undefined);
      const tool = createSendMessageTool({ onSend });
      await tool.execute({ to: 'worker-1', content: 'hello' });
      expect(onSend).toHaveBeenCalledWith('worker-1', 'hello');
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
      expect(tool.description).toContain('worker');
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
  });
});
