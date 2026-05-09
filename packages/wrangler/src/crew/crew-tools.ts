import { z } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { CrewTodoItem, CrewTodoStatus } from './types.js';

// ─── Primary tools ───

const CreateTaskSchema = z.object({
  workerType: z.string().describe('Agent definition name to create as worker'),
  task: z.string().describe('Task description for the worker'),
});

export function createCreateTaskTool(deps: {
  onCreateTask: (workerType: string, task: string) => Promise<string>;
}): Tool<ZodTypeAny> {
  return {
    name: 'create_task',
    description: 'Create a new worker agent with a liaison. Returns a taskId immediately.',
    parameters: CreateTaskSchema,
    async execute(args: z.infer<typeof CreateTaskSchema>) {
      try {
        const taskId = await deps.onCreateTask(args.workerType, args.task);
        return `Task created. ID: ${taskId}. Worker type: ${args.workerType}. Status: started.`;
      } catch (e) {
        return `Failed to create task: ${(e as Error).message}`;
      }
    },
  };
}

const SendMessageSchema = z.object({
  to: z.string().describe('Target agent instance ID'),
  content: z.string().describe('Message content'),
});

export function createSendMessageTool(deps: {
  onSend: (to: string, content: string) => Promise<void>;
}): Tool<ZodTypeAny> {
  return {
    name: 'send_message',
    description: 'Send a message to a specific agent (typically a liaison).',
    parameters: SendMessageSchema,
    async execute(args: z.infer<typeof SendMessageSchema>) {
      await deps.onSend(args.to, args.content);
      return 'Message sent.';
    },
  };
}

// ─── Liaison tools ───

const RelayToPrimarySchema = z.object({
  content: z.string().describe('Content to relay to the primary agent'),
});

export function createRelayToPrimaryTool(deps: {
  onRelay: (content: string) => Promise<void>;
}): Tool<ZodTypeAny> {
  return {
    name: 'relay_to_primary',
    description:
      'Relay important information to the primary agent. Use when the worker produces results or needs user interaction.',
    parameters: RelayToPrimarySchema,
    async execute(args: z.infer<typeof RelayToPrimarySchema>) {
      await deps.onRelay(args.content);
      return 'Relayed to primary.';
    },
  };
}

const SendToWorkerSchema = z.object({
  content: z.string().describe('Content to send to the worker'),
});

export function createSendToWorkerTool(deps: {
  onSend: (content: string) => Promise<void>;
}): Tool<ZodTypeAny> {
  return {
    name: 'send_to_worker',
    description: 'Send a message to your assigned worker.',
    parameters: SendToWorkerSchema,
    async execute(args: z.infer<typeof SendToWorkerSchema>) {
      await deps.onSend(args.content);
      return 'Sent to worker.';
    },
  };
}

// ─── Worker tools ───

const SendToLiaisonSchema = z.object({
  content: z.string().describe('Content to send to your liaison'),
});

export function createSendToLiaisonTool(deps: {
  onSend: (content: string) => Promise<void>;
}): Tool<ZodTypeAny> {
  return {
    name: 'send_to_liaison',
    description: 'Send a message to your liaison. Use to report results or ask questions.',
    parameters: SendToLiaisonSchema,
    async execute(args: z.infer<typeof SendToLiaisonSchema>) {
      await deps.onSend(args.content);
      return 'Sent to liaison.';
    },
  };
}

const AskUserSchema = z.object({
  question: z.string().describe('Question to ask the user'),
});

export function createAskUserTool(deps: {
  onAskUser: (question: string) => Promise<void>;
}): Tool<ZodTypeAny> {
  return {
    name: 'ask_user',
    description:
      'Ask the user a question. The question will be relayed through your liaison to the primary agent.',
    parameters: AskUserSchema,
    async execute(args: z.infer<typeof AskUserSchema>) {
      await deps.onAskUser(args.question);
      return 'Question sent to user.';
    },
  };
}

// ─── Shared tools ───

const ReadTodolistSchema = z.object({}).passthrough();

export function createReadCrewTodolistTool(deps: {
  getTodolist: () => CrewTodoItem[];
}): Tool<ZodTypeAny> {
  return {
    name: 'read_crew_todolist',
    description: 'Read the shared crew todolist.',
    parameters: ReadTodolistSchema,
    async execute() {
      const items = deps.getTodolist();
      if (items.length === 0) return 'Crew todolist is empty.';
      return items
        .map((i) => `- [${i.status}] ${i.content}${i.assignee ? ` (${i.assignee})` : ''}`)
        .join('\n');
    },
  };
}

const UpdateTodolistSchema = z.object({
  itemId: z.string().describe('ID of the item to update'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('New status'),
});

export function createUpdateCrewTodolistTool(deps: {
  onUpdate: (itemId: string, status: CrewTodoStatus) => Promise<void>;
}): Tool<ZodTypeAny> {
  return {
    name: 'update_crew_todolist',
    description: 'Update the status of a shared crew todolist item.',
    parameters: UpdateTodolistSchema,
    async execute(args: z.infer<typeof UpdateTodolistSchema>) {
      await deps.onUpdate(args.itemId, args.status);
      return `Item ${args.itemId} updated to ${args.status}.`;
    },
  };
}
