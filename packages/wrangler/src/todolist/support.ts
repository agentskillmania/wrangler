import type { Tool, AgentMiddleware } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { TodoList } from './types.js';
import { createTodolistTool } from './todo-tool.js';
import { createTodolistMiddleware } from './todo-middleware.js';

/**
 * 创建 todolist 支持 — 返回工具和中间件
 *
 * 调用方通过 getList/setList 管理状态（通常存在 session 中）：
 * ```typescript
 * const todo = createTodolistSupport({
 *   getList: () => todoList,
 *   setList: (list) => { todoList = list; },
 * });
 *
 * const runner = new AgentRunner({
 *   model: 'glm-4',
 *   llm: { apiKey, provider },
 *   tools: [...todo.tools],
 *   middleware: [todo.middleware],
 * });
 * ```
 */
export function createTodolistSupport(deps: {
  getList: () => TodoList | null;
  setList: (list: TodoList) => void;
}): {
  tools: Tool<ZodTypeAny>[];
  middleware: AgentMiddleware;
} {
  const tool = createTodolistTool(deps.getList, deps.setList);
  const middleware = createTodolistMiddleware(deps.getList);

  return {
    tools: [tool],
    middleware,
  };
}
