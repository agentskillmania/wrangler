// packages/core/src/crew/crew-tools.ts

import { z } from 'zod';
import type { WranglerToolDef } from '../tools/types.js';
import type { CrewTodoItem } from './types.js';

// ─── delegate_task (primary agent only) ───

const DelegateTaskSchema = z.object({
  agent: z.string().describe('Target agent name to delegate to'),
  task: z.string().describe('Task description for the agent'),
});

interface DelegateTaskDeps {
  availableAgents: string[];
  onDelegate: (agent: string, task: string) => Promise<string>;
}

export function createDelegateTaskTool(
  deps: DelegateTaskDeps
): WranglerToolDef<typeof DelegateTaskSchema> {
  return {
    name: 'delegate_task',
    description:
      'Delegate a task to another agent. Returns immediately with a taskId. ' +
      'The agent will work in parallel. You will be notified when the task completes.',
    parameters: DelegateTaskSchema,
    async execute(args) {
      if (!deps.availableAgents.includes(args.agent)) {
        return {
          output: `Error: Unknown agent "${args.agent}". Available agents: ${deps.availableAgents.join(', ')}`,
        };
      }
      try {
        const taskId = await deps.onDelegate(args.agent, args.task);
        return {
          output: `Task delegated to ${args.agent}. Task ID: ${taskId}. Status: started.`,
          metadata: { taskId, agent: args.agent },
        };
      } catch (e) {
        return {
          output: `Failed to delegate: ${(e as Error).message}`,
        };
      }
    },
  };
}

// ─── send_message ───

const SendMessageSchema = z.object({
  content: z.string().describe('Message content to send to the group chat'),
});

interface SendMessageDeps {
  onSendMessage: (content: string) => Promise<void>;
}

export function createSendMessageTool(
  deps: SendMessageDeps
): WranglerToolDef<typeof SendMessageSchema> {
  return {
    name: 'send_message',
    description: 'Send a message to the crew group chat. Visible to all agents.',
    parameters: SendMessageSchema,
    async execute(args) {
      await deps.onSendMessage(args.content);
      return { output: 'Message sent.' };
    },
  };
}

// ─── read_todolist ───

const ReadTodolistSchema = z.object({}).passthrough();

interface ReadTodolistDeps {
  getTodolist: () => Promise<CrewTodoItem[]>;
}

export function createReadTodolistTool(
  deps: ReadTodolistDeps
): WranglerToolDef<typeof ReadTodolistSchema> {
  return {
    name: 'read_todolist',
    description: 'Read the shared crew todolist.',
    parameters: ReadTodolistSchema,
    async execute() {
      const items = await deps.getTodolist();
      if (items.length === 0) {
        return { output: 'Todolist is empty.' };
      }
      const lines = items.map(
        (item) => `- [${item.status}] ${item.content}${item.assignee ? ` (${item.assignee})` : ''}`
      );
      return { output: lines.join('\n') };
    },
  };
}

// ─── update_todolist ───

const UpdateTodolistSchema = z.object({
  itemId: z.string().describe('ID of the todolist item to update'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('New status'),
});

interface UpdateTodolistDeps {
  onUpdate: (itemId: string, status: string) => Promise<void>;
}

export function createUpdateTodolistTool(
  deps: UpdateTodolistDeps
): WranglerToolDef<typeof UpdateTodolistSchema> {
  return {
    name: 'update_todolist',
    description: 'Update the status of a todolist item.',
    parameters: UpdateTodolistSchema,
    async execute(args) {
      await deps.onUpdate(args.itemId, args.status);
      return { output: `Item ${args.itemId} updated to ${args.status}.` };
    },
  };
}
