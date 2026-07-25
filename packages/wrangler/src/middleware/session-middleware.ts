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
  return {
    name: 'session',

    beforeRun: async (ctx) => {
      const sessionId = ctx.state.id;

      if (!(await store.existsAsync(sessionId))) {
        await store.createWithId(sessionId, ctx.state.config.name);
        if (options?.runnerConfigSnapshot || options?.source) {
          await store.updateMeta(sessionId, {
            runnerConfig: options.runnerConfigSnapshot,
            source: options.source,
          });
        }
      }
    },

    afterRun: async (ctx) => {
      const sessionId = ctx.state.id;

      await store.saveState(sessionId, ctx.state);

      await store.updateMeta(sessionId, {
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
