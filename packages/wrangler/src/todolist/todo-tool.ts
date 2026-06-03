import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

const ActionSchema = z.union([
  z.object({
    action: z.literal('create'),
    subject: z.string(),
    description: z.string().optional(),
  }),
  z.object({
    action: z.literal('update'),
    id: z.number(),
    status: z.enum(['pending', 'in_progress', 'completed']).optional(),
    subject: z.string().optional(),
    description: z.string().optional(),
  }),
  z.object({
    action: z.literal('delete'),
    id: z.number(),
  }),
  z.object({
    action: z.literal('reset'),
    tasks: z.array(
      z.object({
        subject: z.string(),
        description: z.string().optional(),
        status: z.enum(['pending', 'in_progress', 'completed']).optional(),
      })
    ),
  }),
]);

const TodoListToolSchema = z.object({
  actions: z.array(ActionSchema),
});

export function createTodolistTool(): Tool<ZodTypeAny> {
  return {
    name: 'todolist',
    description:
      'Manage your task list. The current task list is already shown in your instructions. ' +
      'Pass an array of actions: create (add tasks), update (change status/details), ' +
      'delete (remove tasks), or reset (replace entire list). ' +
      'IMPORTANT: Call this tool independently — do not combine with other tool calls in the same step.',
    parameters: TodoListToolSchema,
    async execute({ actions }) {
      return { _todo: true, actions };
    },
  };
}
