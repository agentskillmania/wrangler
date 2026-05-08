// packages/core/src/crew/crew-store.ts

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { ConversationMessage, CrewTodoItem, TaskMeta } from './types.js';

export class CrewStore {
  constructor(private sessionDir: string) {}

  // ─── Todolist ───

  async readTodolist(): Promise<CrewTodoItem[]> {
    const filePath = join(this.sessionDir, 'todolist.yaml');
    try {
      const content = await readFile(filePath, 'utf-8');
      return (yaml.load(content, { schema: yaml.DEFAULT_SCHEMA }) as CrewTodoItem[]) ?? [];
    } catch {
      return [];
    }
  }

  async writeTodolist(items: CrewTodoItem[]): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    const filePath = join(this.sessionDir, 'todolist.yaml');
    await writeFile(filePath, yaml.dump(items), 'utf-8');
  }

  // ─── Group chat ───

  async appendGroupMessage(msg: ConversationMessage): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    const filePath = join(this.sessionDir, 'group-chat.jsonl');
    const line = JSON.stringify(msg) + '\n';
    await appendFile(filePath, line, 'utf-8');
  }

  async readGroupChat(sinceTimestamp?: number): Promise<ConversationMessage[]> {
    const filePath = join(this.sessionDir, 'group-chat.jsonl');
    try {
      const content = await readFile(filePath, 'utf-8');
      const messages = content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ConversationMessage);

      if (sinceTimestamp !== undefined) {
        return messages.filter((m) => m.timestamp >= sinceTimestamp);
      }
      return messages;
    } catch {
      return [];
    }
  }

  // ─── Tasks ───

  async createTask(taskId: string, meta: TaskMeta): Promise<void> {
    const taskDir = join(this.sessionDir, 'tasks', taskId);
    await mkdir(taskDir, { recursive: true });
    await writeFile(join(taskDir, 'meta.yaml'), yaml.dump(meta), 'utf-8');
  }

  async readTaskMeta(taskId: string): Promise<TaskMeta | null> {
    const filePath = join(this.sessionDir, 'tasks', taskId, 'meta.yaml');
    try {
      const content = await readFile(filePath, 'utf-8');
      return yaml.load(content, { schema: yaml.DEFAULT_SCHEMA }) as TaskMeta;
    } catch {
      return null;
    }
  }

  async appendTaskMessage(taskId: string, msg: ConversationMessage): Promise<void> {
    const taskDir = join(this.sessionDir, 'tasks', taskId);
    await mkdir(taskDir, { recursive: true });
    const filePath = join(taskDir, 'conversation.jsonl');
    const line = JSON.stringify(msg) + '\n';
    await appendFile(filePath, line, 'utf-8');
  }

  async readTaskConversation(taskId: string): Promise<ConversationMessage[]> {
    const filePath = join(this.sessionDir, 'tasks', taskId, 'conversation.jsonl');
    try {
      const content = await readFile(filePath, 'utf-8');
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ConversationMessage);
    } catch {
      return [];
    }
  }

  async updateTaskStatus(taskId: string, status: string, result?: string): Promise<void> {
    const meta = await this.readTaskMeta(taskId);
    if (!meta) return;

    meta.status = status as TaskMeta['status'];
    if (result !== undefined) {
      meta.result = result;
    }
    if (status === 'completed' || status === 'failed') {
      meta.completedAt = new Date().toISOString();
    }

    const filePath = join(this.sessionDir, 'tasks', taskId, 'meta.yaml');
    await writeFile(filePath, yaml.dump(meta), 'utf-8');
  }
}
