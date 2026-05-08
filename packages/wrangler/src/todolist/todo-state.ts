import type { TodoList, TodoItem, TodoStatus } from './types.js';

/** 创建空任务列表 */
export function createEmptyTodoList(): TodoList {
  return { items: [], nextId: 1 };
}

/** 新增任务，自动分配 id */
export function addTodo(list: TodoList, subject: string, description?: string): TodoList {
  const item: TodoItem = {
    id: list.nextId,
    subject,
    status: 'pending',
    ...(description !== undefined && { description }),
  };
  return {
    items: [...list.items, item],
    nextId: list.nextId + 1,
  };
}

/** 更新任务属性 */
export function updateTodo(
  list: TodoList,
  id: number,
  updates: { status?: TodoStatus; subject?: string; description?: string }
): TodoList {
  const idx = list.items.findIndex((item) => item.id === id);
  if (idx === -1) throw new Error(`Todo item ${id} not found`);

  const updated: TodoItem = { ...list.items[idx], ...updates };
  const items = [...list.items];
  items[idx] = updated;
  return { ...list, items };
}

/** 删除任务 */
export function deleteTodo(list: TodoList, id: number): TodoList {
  const idx = list.items.findIndex((item) => item.id === id);
  if (idx === -1) throw new Error(`Todo item ${id} not found`);

  return {
    ...list,
    items: list.items.filter((item) => item.id !== id),
  };
}

const STATUS_CHECK: Record<TodoStatus, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
};

/** 将任务列表格式化为可注入上下文的文本 */
export function formatTodoForContext(list: TodoList): string {
  if (list.items.length === 0) return '';

  const lines = list.items.map((item) => {
    let line = `- ${STATUS_CHECK[item.status]} ${item.id}. ${item.subject}`;
    if (item.blockedBy && item.blockedBy.length > 0) {
      line += ` (blocked by: ${item.blockedBy.join(', ')})`;
    }
    return line;
  });

  return [
    '=== Current Task List ===',
    ...lines,
    '',
    'When you complete a task, use the todolist tool to mark it completed.',
    'If you identify new sub-tasks, add them to the list.',
    '===',
  ].join('\n');
}
