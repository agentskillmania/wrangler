/**
 * US3: 共享 todolist 和群聊
 *
 * 所有 agent 共享公共 todolist 和群聊，
 * 用户可实时观测任意 agent 的工作情况。
 *
 * No LLM required — pure state/store/runner logic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CrewStore } from '../../src/crew/crew-store.js';
import {
  createDelegateTaskTool,
  createSendMessageTool,
  createReadTodolistTool,
  createUpdateTodolistTool,
} from '../../src/crew/crew-tools.js';
import type { CrewTodoItem } from '../../src/crew/types.js';

describe('US3: 共享 todolist 和群聊', () => {
  let tmpDir: string;
  let store: CrewStore;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `wrangler-intg-crew-shared-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    store = new CrewStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('todolist.yaml', () => {
    it('persists and reads todolist items', async () => {
      const items: CrewTodoItem[] = [
        { id: 'todo-1', content: 'Setup project', status: 'completed', assignee: 'pm' },
        { id: 'todo-2', content: 'Implement auth', status: 'in_progress', assignee: 'developer' },
        { id: 'todo-3', content: 'Write tests', status: 'pending' },
      ];

      await store.writeTodolist(items);
      const read = await store.readTodolist();

      expect(read).toEqual(items);
    });

    it('writes valid YAML to disk', async () => {
      const items: CrewTodoItem[] = [{ id: '1', content: 'Task A', status: 'pending' }];
      await store.writeTodolist(items);

      const raw = await readFile(join(tmpDir, 'todolist.yaml'), 'utf-8');
      expect(raw).toContain('Task A');
      expect(raw).toContain('pending');
    });

    it('overwrites previous todolist on write', async () => {
      await store.writeTodolist([{ id: '1', content: 'Old', status: 'pending' }]);
      await store.writeTodolist([{ id: '2', content: 'New', status: 'in_progress' }]);

      const items = await store.readTodolist();
      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('New');
    });
  });

  describe('group-chat.jsonl', () => {
    it('appends messages in order', async () => {
      await store.appendGroupMessage({
        role: 'system',
        content: 'Crew started',
        timestamp: 1000,
      });
      await store.appendGroupMessage({
        role: 'system',
        content: 'developer completed task-1',
        timestamp: 2000,
      });

      const chat = await store.readGroupChat();
      expect(chat).toHaveLength(2);
      expect(chat[0].content).toBe('Crew started');
      expect(chat[1].content).toContain('task-1');
    });

    it('filters messages by timestamp', async () => {
      await store.appendGroupMessage({ role: 'system', content: 'old', timestamp: 1000 });
      await store.appendGroupMessage({ role: 'system', content: 'new', timestamp: 2000 });
      await store.appendGroupMessage({ role: 'system', content: 'newest', timestamp: 3000 });

      const recent = await store.readGroupChat(2000);
      expect(recent).toHaveLength(2);
      expect(recent[0].content).toBe('new');
      expect(recent[1].content).toBe('newest');
    });
  });

  describe('crew tools integration', () => {
    it('delegate_task tool with available agent validation', async () => {
      const delegated: { agent: string; task: string }[] = [];
      const tool = createDelegateTaskTool({
        availableAgents: ['developer', 'reviewer'],
        onDelegate: async (agent, task) => {
          delegated.push({ agent, task });
          return 'task-123';
        },
      });

      const result = await tool.execute({ agent: 'developer', task: 'Fix bug #42' });
      expect(delegated).toHaveLength(1);
      expect(result).toContain('task-123');
    });

    it('delegate_task rejects unknown agent', async () => {
      const tool = createDelegateTaskTool({
        availableAgents: ['developer'],
        onDelegate: async () => 'task-1',
      });

      const result = await tool.execute({ agent: 'nonexistent', task: 'test' });
      expect(result).toContain('Error');
    });

    it('send_message tool appends to group chat via callback', async () => {
      const messages: string[] = [];
      const tool = createSendMessageTool({
        onSendMessage: async (content) => {
          messages.push(content);
        },
      });

      await tool.execute({ content: 'Standup at 10am' });
      expect(messages).toEqual(['Standup at 10am']);
    });

    it('read_todolist tool formats items', async () => {
      const tool = createReadTodolistTool({
        getTodolist: async () => [
          { id: '1', content: 'Setup CI', status: 'completed', assignee: 'pm' },
          { id: '2', content: 'Add tests', status: 'in_progress' },
        ],
      });

      const result = await tool.execute({});
      expect(result).toContain('Setup CI');
      expect(result).toContain('completed');
      expect(result).toContain('pm');
      expect(result).toContain('Add tests');
    });

    it('update_todolist tool calls callback', async () => {
      const updates: { itemId: string; status: string }[] = [];
      const tool = createUpdateTodolistTool({
        onUpdate: async (itemId, status) => {
          updates.push({ itemId, status });
        },
      });

      await tool.execute({ itemId: 'todo-1', status: 'completed' });
      expect(updates).toEqual([{ itemId: 'todo-1', status: 'completed' }]);
    });
  });
});
