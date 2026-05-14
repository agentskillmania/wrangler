import type { AgentMiddleware, AgentState } from '@agentskillmania/colts';
import { updateState } from '@agentskillmania/colts';
import type { TodoList, TodoStatus } from './types.js';
import {
  createEmptyTodoList,
  addTodo,
  updateTodo,
  deleteTodo,
} from './todo-state.js';

function getTodoList(state: AgentState): TodoList | undefined {
  return state.context.todoList;
}

function setTodoList(state: AgentState, list: TodoList): AgentState {
  return updateState(state, (draft) => {
    draft.context.todoList = list;
  });
}

function isTodoActionResult(result: unknown): result is { _todo: true; actions: unknown[] } {
  return (
    typeof result === 'object' &&
    result !== null &&
    '_todo' in result &&
    (result as Record<string, unknown>)._todo === true &&
    'actions' in result &&
    Array.isArray((result as Record<string, unknown>).actions)
  );
}

function applyActions(list: TodoList, actions: unknown[]): TodoList {
  let current = list;
  for (const raw of actions) {
    const action = raw as Record<string, unknown>;
    switch (action.action) {
      case 'create': {
        const subject = action.subject as string | undefined;
        if (!subject) continue;
        current = addTodo(current, subject, action.description as string | undefined);
        break;
      }
      case 'update': {
        const id = action.id as number | undefined;
        if (!id) continue;
        const updates: { status?: TodoStatus; subject?: string; description?: string } = {};
        if (action.status) updates.status = action.status as TodoStatus;
        if (action.subject) updates.subject = action.subject as string;
        if (action.description !== undefined) updates.description = action.description as string;
        if (Object.keys(updates).length === 0) continue;
        current = updateTodo(current, id, updates);
        break;
      }
      case 'delete': {
        const id = action.id as number | undefined;
        if (!id) continue;
        current = deleteTodo(current, id);
        break;
      }
      case 'reset': {
        const tasks = action.tasks as Array<{
          subject: string;
          description?: string;
          status?: TodoStatus;
        }> | undefined;
        if (!tasks) continue;
        let newList = createEmptyTodoList();
        for (const t of tasks) {
          newList = addTodo(newList, t.subject, t.description);
          if (t.status && t.status !== 'pending') {
            newList = updateTodo(newList, newList.items[newList.items.length - 1].id, {
              status: t.status,
            });
          }
        }
        current = newList;
        break;
      }
    }
  }
  return current;
}

export function createTodolistMiddleware(): AgentMiddleware {
  return {
    name: 'todolist',

    async afterStep(ctx) {
      const { result, state } = ctx;

      if (result.type !== 'continue') return;
      if (!isTodoActionResult(result.toolResult)) return;

      const currentList = getTodoList(state) ?? createEmptyTodoList();
      const updatedList = applyActions(currentList, result.toolResult.actions);
      const newState = setTodoList(state, updatedList);

      return { state: newState };
    },

    async beforeStep(ctx) {
      let state = ctx.state;

      // Auto-initialize empty list if missing
      if (!getTodoList(state)) {
        state = setTodoList(state, createEmptyTodoList());
      }

      return { state };
    },
  };
}
