// packages/core/src/session/support.ts

import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AgentMiddleware, ILLMProvider } from '@agentskillmania/colts';

import { SessionStore } from './session-store.js';
import { createSessionMiddleware } from '../middleware/session-middleware.js';
import { createSessionNamingMiddleware } from '../middleware/session-naming-middleware.js';
import type { RunnerConfigSnapshot, SessionSource } from '../types.js';

/**
 * Resolve the application root: `AGENTSKILLMANIA_APP_DIR` env override, else
 * `~/.agentskillmania/skill-studio`. Mirrors the daemon's `APP_DIR`.
 */
export function appDir(): string {
  const env = process.env.AGENTSKILLMANIA_APP_DIR;
  if (env && env.trim()) return env;
  return join(homedir(), '.agentskillmania', 'skill-studio');
}

/**
 * Session 持久化支持 — 返回 middleware 和 SessionStore。
 *
 * 注意：此函数不再注册工具。calculate 和 ask_human 已移至
 * createBuiltinTools，与 enableSession 开关解耦。
 */
export function createSessionSupport(options: {
  /** workspace 目录路径（session 按此分组） */
  workspacePath: string;
  /** session 存储根目录（默认 {appDir}/sessions） */
  sessionBaseDir?: string;
  /** Pin the session to this directory (dir-bound mode). When set, overrides
   *  sessionBaseDir — state.json + meta.yaml live directly in this dir. */
  sessionDir?: string;
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
  // Dir-bound mode: session lives directly in the given directory.
  // Standard mode: session at {baseDir}/{hash(workspacePath)}/{sessionId}/.
  const store = options.sessionDir
    ? SessionStore.fromDir(options.sessionDir)
    : new SessionStore(options.sessionBaseDir ?? join(appDir(), 'sessions'), options.workspacePath);

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
