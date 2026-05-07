import { z } from 'zod';
import type { WranglerToolDef } from '../tools/types.js';
import type { TodoList, TodoStatus } from './types.js';
import {
  createEmptyTodoList,
  addTodo,
  updateTodo,
  deleteTodo,
  formatTodoForContext,
} from './todo-state.js';

const TodoActionSchema = z.object({
  action: z
    .enum(['create', 'update', 'delete', 'list', 'reset'])
    .describe('Operation: create, update, delete, list, or reset (replace entire list)'),
  subject: z.string().optional().describe('Task title (required for create)'),
  description: z.string().optional().describe('Task description (optional for create/update)'),
  id: z.number().optional().describe('Task id (required for update/delete)'),
  status: z
    .enum(['pending', 'in_progress', 'completed'])
    .optional()
    .describe('New status (for update)'),
  tasks: z
    .array(
      z.object({
        subject: z.string(),
        description: z.string().optional(),
        status: z.enum(['pending', 'in_progress', 'completed']).optional(),
      })
    )
    .optional()
    .describe('New task list for reset action (replaces all existing tasks)'),
});

type TodoActionResult = { output: string; metadata?: { list: TodoList | null } };

export function createTodolistTool(
  getList: () => TodoList | null,
  setList?: (list: TodoList) => void
): WranglerToolDef<typeof TodoActionSchema> {
  return {
    name: 'todolist',
    description:
      'Manage a task list. Use create to add, update to change status/details, delete to remove, list to view, or reset to replace the entire list at once.',
    parameters: TodoActionSchema,
    async execute(args): Promise<TodoActionResult> {
      let list = getList() ?? createEmptyTodoList();

      switch (args.action) {
        case 'create': {
          if (!args.subject) {
            return { output: 'Error: subject is required for create action' };
          }
          list = addTodo(list, args.subject, args.description);
          if (args.status && args.status !== 'pending') {
            list = updateTodo(list, list.items[list.items.length - 1].id, { status: args.status });
          }
          break;
        }
        case 'update': {
          if (!args.id) {
            return { output: 'Error: id is required for update action' };
          }
          try {
            const updates: { status?: TodoStatus; subject?: string; description?: string } = {};
            if (args.status) updates.status = args.status;
            if (args.subject) updates.subject = args.subject;
            if (args.description !== undefined) updates.description = args.description;
            list = updateTodo(list, args.id, updates);
          } catch (e) {
            return { output: `Error: ${(e as Error).message}`, metadata: { list: null } };
          }
          break;
        }
        case 'delete': {
          if (!args.id) {
            return { output: 'Error: id is required for delete action' };
          }
          try {
            list = deleteTodo(list, args.id);
          } catch (e) {
            return { output: `Error: ${(e as Error).message}`, metadata: { list: null } };
          }
          break;
        }
        case 'list': {
          if (list.items.length === 0) {
            return { output: 'No tasks in the list.', metadata: { list } };
          }
          return {
            output: formatTodoForContext(list),
            metadata: { list },
          };
        }
        case 'reset': {
          if (!args.tasks || args.tasks.length === 0) {
            return { output: 'Error: tasks array is required for reset action' };
          }
          list = createEmptyTodoList();
          for (const t of args.tasks) {
            list = addTodo(list, t.subject, t.description);
            if (t.status && t.status !== 'pending') {
              const lastId = list.items[list.items.length - 1].id;
              list = updateTodo(list, lastId, { status: t.status });
            }
          }
          break;
        }
        default:
          return {
            output: `Error: Unknown action "${args.action as string}"`,
            metadata: { list: null },
          };
      }

      setList?.(list);

      return {
        output: formatTodoForContext(list),
        metadata: { list },
      };
    },
  };
}
