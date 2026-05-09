import { describe, it, expect, vi } from 'vitest';
import {
  createCreateTaskTool,
  createSendMessageTool,
  createRelayToPrimaryTool,
  createSendToWorkerTool,
  createSendToLiaisonTool,
  createAskUserTool,
  createReadCrewTodolistTool,
  createUpdateCrewTodolistTool,
} from '../../../src/crew/crew-tools.js';

describe('crew tools', () => {
  describe('createCreateTaskTool', () => {
    it('calls onCreateTask callback', async () => {
      const onCreateTask = vi.fn().mockResolvedValue('task-1');
      const tool = createCreateTaskTool({ onCreateTask });
      const result = await tool.execute({ workerType: 'searcher', task: 'search x' });
      expect(onCreateTask).toHaveBeenCalledWith('searcher', 'search x');
      expect(result).toContain('task-1');
    });

    it('handles callback error', async () => {
      const onCreateTask = vi.fn().mockRejectedValue(new Error('boom'));
      const tool = createCreateTaskTool({ onCreateTask });
      const result = await tool.execute({ workerType: 'searcher', task: 'search x' });
      expect(result).toContain('boom');
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

  describe('createSendToWorkerTool', () => {
    it('sends to worker', async () => {
      const onSend = vi.fn().mockResolvedValue(undefined);
      const tool = createSendToWorkerTool({ onSend });
      await tool.execute({ content: 'do this' });
      expect(onSend).toHaveBeenCalledWith('do this');
    });
  });

  describe('createSendToLiaisonTool', () => {
    it('sends to liaison', async () => {
      const onSend = vi.fn().mockResolvedValue(undefined);
      const tool = createSendToLiaisonTool({ onSend });
      await tool.execute({ content: 'result' });
      expect(onSend).toHaveBeenCalledWith('result');
    });
  });

  describe('createAskUserTool', () => {
    it('routes question through callback', async () => {
      const onAskUser = vi.fn().mockResolvedValue(undefined);
      const tool = createAskUserTool({ onAskUser });
      await tool.execute({ question: 'A or B?' });
      expect(onAskUser).toHaveBeenCalledWith('A or B?');
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
});
