import { describe, it, expect } from 'vitest';
import {
  createDelegateTaskTool,
  createSendMessageTool,
  createReadTodolistTool,
  createUpdateTodolistTool,
} from '../../../src/crew/crew-tools.js';
import type { CrewTodoItem } from '../../../src/crew/types.js';

describe('Crew Tools', () => {
  describe('createDelegateTaskTool', () => {
    it('returns a tool with correct name and parameters', () => {
      const tool = createDelegateTaskTool({
        availableAgents: ['developer'],
        onDelegate: async () => 'task-1',
      });

      expect(tool.name).toBe('delegate_task');
      expect(tool.parameters).toBeDefined();
    });

    it('calls onDelegate with agent and task', async () => {
      const delegated: unknown[] = [];
      const tool = createDelegateTaskTool({
        availableAgents: ['developer'],
        onDelegate: async (agent, task) => {
          delegated.push({ agent, task });
          return 'task-1';
        },
      });

      const result = await tool.execute({ agent: 'developer', task: 'Implement feature X' });

      expect(delegated).toHaveLength(1);
      expect(delegated[0]).toEqual({ agent: 'developer', task: 'Implement feature X' });
      expect(result).toContain('task-1');
    });

    it('rejects unknown agent', async () => {
      const tool = createDelegateTaskTool({
        availableAgents: ['developer'],
        onDelegate: async () => 'task-1',
      });

      const result = await tool.execute({ agent: 'unknown_agent', task: 'Do something' });

      expect(result).toContain('Error');
      expect(result).toContain('unknown_agent');
    });

    it('handles onDelegate failure', async () => {
      const tool = createDelegateTaskTool({
        availableAgents: ['developer'],
        onDelegate: async () => {
          throw new Error('Agent busy');
        },
      });

      const result = await tool.execute({ agent: 'developer', task: 'Do something' });

      expect(result).toContain('Failed to delegate');
      expect(result).toContain('Agent busy');
    });
  });

  describe('createSendMessageTool', () => {
    it('appends message to group chat', async () => {
      const messages: string[] = [];
      const tool = createSendMessageTool({
        onSendMessage: async (content) => {
          messages.push(content);
        },
      });

      const result = await tool.execute({ content: 'Hello team' });

      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe('Hello team');
      expect(result).toBe('Message sent.');
    });
  });

  describe('createReadTodolistTool', () => {
    it('returns current todolist items', async () => {
      const items: CrewTodoItem[] = [{ id: '1', content: 'Task A', status: 'pending' }];
      const tool = createReadTodolistTool({
        getTodolist: async () => items,
      });

      const result = await tool.execute({});

      expect(result).toContain('Task A');
      expect(result).toContain('pending');
    });

    it('returns message when todolist is empty', async () => {
      const tool = createReadTodolistTool({
        getTodolist: async () => [],
      });

      const result = await tool.execute({});

      expect(result).toContain('empty');
    });

    it('shows assignee when present', async () => {
      const items: CrewTodoItem[] = [
        { id: '1', content: 'Task A', status: 'in_progress', assignee: 'developer' },
      ];
      const tool = createReadTodolistTool({
        getTodolist: async () => items,
      });

      const result = await tool.execute({});

      expect(result).toContain('developer');
    });
  });

  describe('createUpdateTodolistTool', () => {
    it('calls onUpdate with itemId and status', async () => {
      const updates: unknown[] = [];
      const tool = createUpdateTodolistTool({
        onUpdate: async (itemId, status) => {
          updates.push({ itemId, status });
        },
      });

      const result = await tool.execute({ itemId: '1', status: 'completed' });

      expect(updates).toHaveLength(1);
      expect(updates[0]).toEqual({ itemId: '1', status: 'completed' });
      expect(result).toContain('updated');
    });
  });
});
