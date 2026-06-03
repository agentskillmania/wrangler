import type { Tool, AgentMiddleware } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import { createTodolistMiddleware } from './todo-middleware.js';
import { createTodolistTool } from './todo-tool.js';

/**
 * Create todolist support — returns tools and middleware
 *
 * Uses AgentContext.todoList for state management (set via module augmentation).
 * ```typescript
 * const todo = createTodolistSupport();
 *
 * const runner = new AgentRunner({
 *   model: 'glm-4',
 *   llm: { apiKey, provider },
 *   tools: [...todo.tools],
 *   middleware: [todo.middleware],
 * });
 * ```
 */
export function createTodolistSupport(): {
  tools: Tool<ZodTypeAny>[];
  middleware: AgentMiddleware;
} {
  const tool = createTodolistTool();
  const middleware = createTodolistMiddleware();

  return {
    tools: [tool],
    middleware,
  };
}
