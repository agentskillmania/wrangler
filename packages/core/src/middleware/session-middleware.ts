// packages/core/src/middleware/session-middleware.ts

import type { AgentMiddleware } from '@agentskillmania/colts';
import type { SessionStore } from '../session/session-store.js';
import type { ConversationMessage } from '../session/types.js';

/**
 * Create session management middleware.
 *
 * - beforeRun: create session dir if missing
 * - afterStep: write ConversationMessage (tool/assistant/error) to user-chat.jsonl
 * - afterRun: save state + update meta
 */
export function createSessionMiddleware(store: SessionStore): AgentMiddleware {
  return {
    name: 'session',

    beforeRun: async (ctx) => {
      const sessionId = ctx.state.id;
      const model = ctx.runnerOptions.model;

      if (!(await store.existsAsync(sessionId))) {
        await store.createWithId(sessionId, model);
      }
    },

    afterStep: async (ctx) => {
      const sessionId = ctx.state.id;
      const { result } = ctx;

      if (result.type === 'continue') {
        for (const action of result.actions) {
          const msg: ConversationMessage = {
            role: 'tool',
            content:
              typeof result.toolResult === 'string'
                ? result.toolResult
                : JSON.stringify(result.toolResult ?? ''),
            timestamp: Date.now(),
            toolName: action.tool,
            toolArguments: JSON.stringify(action.arguments),
          };
          await store.appendMessage(sessionId, msg);
        }
      } else if (result.type === 'done') {
        const msg: ConversationMessage = {
          role: 'assistant',
          content: result.answer,
          timestamp: Date.now(),
        };
        await store.appendMessage(sessionId, msg);
      } else if (result.type === 'error') {
        const msg: ConversationMessage = {
          role: 'error',
          content: result.error.message,
          timestamp: Date.now(),
          errorMessage: result.error.message,
        };
        await store.appendMessage(sessionId, msg);
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
