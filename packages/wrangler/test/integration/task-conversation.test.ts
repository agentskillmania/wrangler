/**
 * US4: 任务级对话
 *
 * Primary agent 与 worker agent 之间按 task 维度进行多轮对话。
 * 同一 agent 类型的多个实例按 taskId 隔离，无重名冲突。
 *
 * No LLM required — pure store logic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CrewStore } from '../../src/crew/crew-store.js';

describe('US4: 任务级对话', () => {
  let tmpDir: string;
  let store: CrewStore;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `wrangler-intg-task-conv-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    store = new CrewStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates isolated task directory with meta', async () => {
    await store.createTask('task-alpha', {
      taskId: 'task-alpha',
      assignedAgent: 'developer',
      description: 'Implement login',
      status: 'running',
      createdAt: new Date().toISOString(),
    });

    const meta = await store.readTaskMeta('task-alpha');
    expect(meta).not.toBeNull();
    expect(meta!.taskId).toBe('task-alpha');
    expect(meta!.assignedAgent).toBe('developer');
    expect(meta!.status).toBe('running');
  });

  it('writes and reads task conversation', async () => {
    await store.createTask('task-beta', {
      taskId: 'task-beta',
      assignedAgent: 'reviewer',
      description: 'Review PR #42',
      status: 'running',
      createdAt: new Date().toISOString(),
    });

    await store.appendTaskMessage('task-beta', {
      role: 'assistant',
      content: 'I will review the PR now.',
      timestamp: Date.now(),
    });
    await store.appendTaskMessage('task-beta', {
      role: 'tool',
      content: 'PR has 3 files changed',
      timestamp: Date.now(),
      toolName: 'file_read',
    });

    const conv = await store.readTaskConversation('task-beta');
    expect(conv).toHaveLength(2);
    expect(conv[0].role).toBe('assistant');
    expect(conv[1].toolName).toBe('file_read');
  });

  it('isolates conversations between tasks', async () => {
    await store.createTask('task-a', {
      taskId: 'task-a',
      assignedAgent: 'developer',
      description: 'Task A',
      status: 'running',
      createdAt: new Date().toISOString(),
    });
    await store.appendTaskMessage('task-a', {
      role: 'assistant',
      content: 'Working on A',
      timestamp: 1000,
    });

    await store.createTask('task-b', {
      taskId: 'task-b',
      assignedAgent: 'reviewer',
      description: 'Task B',
      status: 'running',
      createdAt: new Date().toISOString(),
    });
    await store.appendTaskMessage('task-b', {
      role: 'assistant',
      content: 'Working on B',
      timestamp: 2000,
    });

    const convA = await store.readTaskConversation('task-a');
    const convB = await store.readTaskConversation('task-b');

    expect(convA).toHaveLength(1);
    expect(convA[0].content).toBe('Working on A');
    expect(convB).toHaveLength(1);
    expect(convB[0].content).toBe('Working on B');
  });

  it('updates task status through lifecycle', async () => {
    await store.createTask('task-lifecycle', {
      taskId: 'task-lifecycle',
      assignedAgent: 'developer',
      description: 'Lifecycle test',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    await store.updateTaskStatus('task-lifecycle', 'running');
    let meta = await store.readTaskMeta('task-lifecycle');
    expect(meta!.status).toBe('running');

    await store.updateTaskStatus('task-lifecycle', 'completed', 'All done');
    meta = await store.readTaskMeta('task-lifecycle');
    expect(meta!.status).toBe('completed');
    expect(meta!.result).toBe('All done');
    expect(meta!.completedAt).toBeDefined();
  });

  it('returns empty array for non-existent task conversation', async () => {
    const conv = await store.readTaskConversation('nonexistent');
    expect(conv).toEqual([]);
  });

  it('returns null for non-existent task meta', async () => {
    const meta = await store.readTaskMeta('nonexistent');
    expect(meta).toBeNull();
  });
});
