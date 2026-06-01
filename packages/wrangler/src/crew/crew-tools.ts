import { z } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

// ─── Primary tools ───

const CreateTaskSchema = z.object({
  workerType: z.string().describe('Agent definition name to create as worker'),
  task: z.string().describe('Task description for the worker'),
  instructions: z
    .string()
    .optional()
    .describe('Custom instructions for ad-hoc worker creation when type is not in catalog'),
});

export function createCreateTaskTool(deps: {
  onCreateTask: (workerType: string, task: string, instructions?: string) => Promise<string>;
}): Tool<ZodTypeAny> {
  return {
    name: 'create_task',
    description:
      'Create a new worker agent with a task. Prefer existing agent types from the catalog. Use instructions only when no suitable type exists.',
    parameters: CreateTaskSchema,
    async execute(args: z.infer<typeof CreateTaskSchema>) {
      const taskId = await deps.onCreateTask(args.workerType, args.task, args.instructions);
      return `Task created. ID: ${taskId}. Worker type: ${args.workerType}. Status: started.`;
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
    description: 'Send a message to a specific worker agent.',
    parameters: SendMessageSchema,
    async execute(args: z.infer<typeof SendMessageSchema>) {
      await deps.onSend(args.to, args.content);
      return 'Message sent.';
    },
  };
}
