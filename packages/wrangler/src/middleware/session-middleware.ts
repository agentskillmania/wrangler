// packages/core/src/middleware/session-middleware.ts

import type { AgentMiddleware } from '@agentskillmania/colts';

import type { SessionStore } from '../session/session-store.js';
import type { RunnerConfigSnapshot, SessionSource } from '../types.js';

/**
 * Create session management middleware.
 *
 * - beforeRun: create session dir if missing, write runnerConfig + source to meta
 * - afterRun: save state snapshot + update meta timestamp
 */
export function createSessionMiddleware(
  store: SessionStore,
  options?: {
    runnerConfigSnapshot?: RunnerConfigSnapshot;
    source?: SessionSource;
  }
): AgentMiddleware {
  // Dir-bound stores don't accept a sessionId — pass undefined instead.
  // Standard stores need it to select the session subdirectory.
  const resolveSid = (ctx: { state: { id?: string } }) =>
    store.isDirBound ? undefined : ctx.state.id;

  return {
    name: 'session',

    beforeRun: async (ctx) => {
      const sid = resolveSid(ctx);

      if (!(await store.existsAsync(sid))) {
        await store.createWithId(sid, ctx.state.config.name);
        if (options?.runnerConfigSnapshot || options?.source) {
          await store.updateMeta(sid, {
            runnerConfig: options.runnerConfigSnapshot,
            source: options.source,
          });
        }
      }
    },

    afterRun: async (ctx) => {
      const sid = resolveSid(ctx);

      await store.saveState(sid, ctx.state);

      await store.updateMeta(sid, {
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
