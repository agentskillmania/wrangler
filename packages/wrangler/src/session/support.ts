// packages/core/src/session/support.ts

import type { Tool, AskHumanHandler } from '@agentskillmania/colts';
import { calculatorTool, createAskHumanTool } from '@agentskillmania/colts';
import { SessionStore } from './session-store.js';
import { createSessionMiddleware } from '../middleware/session-middleware.js';
import type { ZodTypeAny } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_SESSION_BASE_DIR = join(homedir(), '.agentskillmania', 'wrangler', 'sessions');

function widenTool<T extends ZodTypeAny>(tool: Tool<T>): Tool<ZodTypeAny> {
  return tool as unknown as Tool<ZodTypeAny>;
}

/**
 * Session 持久化支持 — 返回 middleware、工具和 SessionStore
 *
 * 调用方将这些组装进 AgentRunner：
 * ```typescript
 * const session = createSessionSupport({ workspacePath: '/my/project' });
 * const runner = new AgentRunner({
 *   model: 'glm-4',
 *   llmClient,
 *   tools: [...session.tools],
 *   middleware: [session.middleware],
 * });
 * ```
 */
export function createSessionSupport(options: {
  /** workspace 目录路径（session 按此分组） */
  workspacePath: string;
  /** session 存储根目录（默认 ~/.agentskillmania/wrangler/sessions） */
  sessionBaseDir?: string;
  /** 可选，传入则注册 ask_human 工具 */
  askHumanHandler?: AskHumanHandler;
}): {
  middleware: import('@agentskillmania/colts').AgentMiddleware;
  store: SessionStore;
  tools: Tool<ZodTypeAny>[];
} {
  const sessionBaseDir = options.sessionBaseDir ?? DEFAULT_SESSION_BASE_DIR;
  const store = new SessionStore(sessionBaseDir, options.workspacePath);
  const middleware = createSessionMiddleware(store);

  const tools: Tool<ZodTypeAny>[] = [widenTool(calculatorTool)];
  if (options.askHumanHandler) {
    tools.push(widenTool(createAskHumanTool(options.askHumanHandler)));
  }

  return { middleware, store, tools };
}
