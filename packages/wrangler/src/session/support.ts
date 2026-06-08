// packages/core/src/session/support.ts

import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Tool, AskHumanHandler, AgentMiddleware, ILLMProvider } from '@agentskillmania/colts';
import { calculatorTool, createAskHumanTool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import { SessionStore } from './session-store.js';
import { createSessionMiddleware } from '../middleware/session-middleware.js';
import { createSessionNamingMiddleware } from '../middleware/session-naming-middleware.js';

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
  /** 可选 LLM provider for Phase 2 title upgrade */
  llmClient?: ILLMProvider;
  /** Model to use for Phase 2 title generation */
  model?: string;
}): {
  middlewares: AgentMiddleware[];
  store: SessionStore;
  tools: Tool<ZodTypeAny>[];
} {
  const sessionBaseDir = options.sessionBaseDir ?? DEFAULT_SESSION_BASE_DIR;
  const store = new SessionStore(sessionBaseDir, options.workspacePath);

  const sessionMiddleware = createSessionMiddleware(store);
  const namingMiddleware = createSessionNamingMiddleware({
    store,
    llmClient: options.llmClient,
    model: options.model,
  });

  const tools: Tool<ZodTypeAny>[] = [widenTool(calculatorTool)];
  if (options.askHumanHandler) {
    tools.push(widenTool(createAskHumanTool(options.askHumanHandler)));
  }

  return { middlewares: [sessionMiddleware, namingMiddleware], store, tools };
}
