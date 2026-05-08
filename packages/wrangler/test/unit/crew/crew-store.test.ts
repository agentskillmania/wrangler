import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CrewStore } from '../../../src/crew/crew-store.js';
import type { ConversationMessage, CrewTodoItem } from '../../../src/crew/types.js';

describe('CrewStore', () => {
  let tmpDir: string;
  let store: CrewStore;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `crew-store-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    store = new CrewStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ─── Todolist ───

  it('reads empty todolist when file does not exist', async () => {
    const items = await store.readTodolist();
    expect(items).toEqual([]);
  });

  it('writes and reads todolist', async () => {
    const items: CrewTodoItem[] = [
      { id: '1', content: 'Task A', status: 'pending' },
      { id: '2', content: 'Task B', status: 'in_progress', assignee: 'developer:1' },
    ];
    await store.writeTodolist(items);
    const read = await store.readTodolist();
    expect(read).toEqual(items);
  });

  // ─── Group chat ───

  it('appends and reads group chat messages', async () => {
    const msg: ConversationMessage = {
      role: 'system',
      content: 'developer:1 completed task-abc',
      timestamp: Date.now(),
    };
    await store.appendGroupMessage(msg);

    const chat = await store.readGroupChat();
    expect(chat).toHaveLength(1);
    expect(chat[0].content).toBe(msg.content);
  });

  it('reads group chat since timestamp', async () => {
    const t1 = Date.now() - 1000;
    await store.appendGroupMessage({
      role: 'system',
      content: 'old message',
      timestamp: t1,
    });
    const t2 = Date.now();
    await store.appendGroupMessage({
      role: 'system',
      content: 'new message',
      timestamp: t2,
    });

    const recent = await store.readGroupChat(t2 - 1);
    expect(recent).toHaveLength(1);
    expect(recent[0].content).toBe('new message');
  });

  it('reads empty group chat when file does not exist', async () => {
    const chat = await store.readGroupChat();
    expect(chat).toEqual([]);
  });

  // ─── Tasks ───

  it('creates a task and reads its meta', async () => {
    await store.createTask('task-abc', {
      taskId: 'task-abc',
      assignedAgent: 'developer:1',
      description: 'Implement feature X',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const meta = await store.readTaskMeta('task-abc');
    expect(meta).not.toBeNull();
    expect(meta!.taskId).toBe('task-abc');
    expect(meta!.assignedAgent).toBe('developer:1');
  });

  it('appends and reads task conversation', async () => {
    await store.createTask('task-xyz', {
      taskId: 'task-xyz',
      assignedAgent: 'developer:1',
      description: 'Task Y',
      status: 'running',
      createdAt: new Date().toISOString(),
    });

    const msg: ConversationMessage = {
      role: 'assistant',
      content: 'Starting implementation',
      timestamp: Date.now(),
    };
    await store.appendTaskMessage('task-xyz', msg);

    const conv = await store.readTaskConversation('task-xyz');
    expect(conv).toHaveLength(1);
    expect(conv[0].content).toBe('Starting implementation');
  });

  it('updates task status', async () => {
    await store.createTask('task-status', {
      taskId: 'task-status',
      assignedAgent: 'developer:1',
      description: 'Status test',
      status: 'running',
      createdAt: new Date().toISOString(),
    });

    await store.updateTaskStatus('task-status', 'completed', 'All done');

    const meta = await store.readTaskMeta('task-status');
    expect(meta!.status).toBe('completed');
    expect(meta!.result).toBe('All done');
    expect(meta!.completedAt).toBeDefined();
  });

  it('reads empty task conversation when task does not exist', async () => {
    const conv = await store.readTaskConversation('nonexistent');
    expect(conv).toEqual([]);
  });

  it('returns null for non-existent task meta', async () => {
    const meta = await store.readTaskMeta('nonexistent');
    expect(meta).toBeNull();
  });
});
