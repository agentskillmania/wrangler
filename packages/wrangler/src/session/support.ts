// packages/core/src/session/support.ts

import type { AgentMiddleware, ILLMProvider } from '@agentskillmania/colts';

import { SessionStore } from './session-store.js';
import type { HostEnv } from '../host-env/index.js';
import { createSessionMiddleware } from '../middleware/session-middleware.js';
import { createSessionNamingMiddleware } from '../middleware/session-naming-middleware.js';
import type { RunnerConfigSnapshot, SessionSource } from '../types.js';

/**
 * Session 持久化支持 — 返回 middleware 和 SessionStore。
 *
 * 注意：此函数不再注册工具。calculate 和 ask_human 已移至
 * createBuiltinTools，与 enableSession 开关解耦。
 */
export function createSessionSupport(options: {
  /** HostEnv（必传）—— 提供文件系统、路径、appDataDir 等 */
  runtime: HostEnv;
  /** workspace 目录路径（session 按此分组） */
  workspacePath: string;
  /** session 存储根目录（默认 {appDataDir}/sessions） */
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
  const { runtime } = options;
  // Dir-bound mode: session lives directly in the given directory.
  // Standard mode: session at {baseDir}/{hash(workspacePath)}/{sessionId}/.
  const store = options.sessionDir
    ? SessionStore.fromDir(options.sessionDir, runtime)
    : new SessionStore(
        options.sessionBaseDir ?? runtime.path.join(runtime.env.appDataDir(), 'sessions'),
        options.workspacePath,
        runtime
      );

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
