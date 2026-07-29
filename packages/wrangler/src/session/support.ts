// packages/core/src/session/support.ts

import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AgentMiddleware, ILLMProvider } from '@agentskillmania/colts';

import { SessionStore } from './session-store.js';
import { createSessionMiddleware } from '../middleware/session-middleware.js';
import { createSessionNamingMiddleware } from '../middleware/session-naming-middleware.js';
import type { RunnerConfigSnapshot, SessionSource } from '../types.js';

const DEFAULT_SESSION_BASE_DIR = join(homedir(), '.agentskillmania', 'wrangler', 'sessions');

/**
 * Session 持久化支持 — 返回 middleware 和 SessionStore。
 *
 * 注意：此函数不再注册工具。calculate 和 ask_human 已移至
 * createBuiltinTools，与 enableSession 开关解耦。
 */
export function createSessionSupport(options: {
  /** workspace 目录路径（session 按此分组） */
  workspacePath: string;
  /** session 存储根目录（默认 ~/.agentskillmania/wrangler/sessions） */
  sessionBaseDir?: string;
  /** 可选 LLM provider for Phase 2 title upgrade */
  llmClient?: ILLMProvider;
  /** Model to use for Phase 2 title generation */
  model?: string;
  /** Runner configuration snapshot to persist on session creation */
  runnerConfigSnapshot?: RunnerConfigSnapshot;
  /** Source of session creation */
  source?: SessionSource;
}): {
  middlewares: AgentMiddleware[];
  store: SessionStore;
} {
  const sessionBaseDir = options.sessionBaseDir ?? DEFAULT_SESSION_BASE_DIR;
  const store = new SessionStore(sessionBaseDir, options.workspacePath);

  const sessionMiddleware = createSessionMiddleware(store, {
    runnerConfigSnapshot: options.runnerConfigSnapshot,
    source: options.source,
  });
  const namingMiddleware = createSessionNamingMiddleware({
    store,
    llmClient: options.llmClient,
    model: options.model,
  });

  return { middlewares: [sessionMiddleware, namingMiddleware], store };
}
