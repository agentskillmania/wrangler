// packages/core/src/middleware/session-middleware.ts

import { randomUUID } from 'node:crypto';
import type { AgentMiddleware } from '@agentskillmania/colts';
import type { SessionStore } from '../session/session-store.js';
import type { SessionEntry } from '../session/types.js';

/**
 * Create session management middleware.
 *
 * - beforeRun: create session dir if missing, record user message with colts Message.id
 * - afterStep: write SessionEntry (tool/assistant/error) to session.jsonl
 * - afterRun: save state + update meta
 */
export function createSessionMiddleware(store: SessionStore): AgentMiddleware {
  return {
    name: 'session',

    beforeRun: async (ctx) => {
      const sessionId = ctx.state.id;
      const model = ctx.runnerOptions.model;

      if (!(await store.existsAsync(sessionId))) {
        await store.createWithId(sessionId, model, ctx.state.config.name);
      }

      // Record the last user message as a SessionEntry
      const messages = ctx.state.context.messages;
      const lastUserMsg = messages.filter((m) => m.role === 'user').at(-1);
      if (lastUserMsg) {
        const entry: SessionEntry = {
          id: lastUserMsg.id,
          role: 'user',
          content: typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '',
          timestamp: lastUserMsg.timestamp,
        };
        await store.appendEntry(sessionId, entry);
      }
    },

    afterStep: async (ctx) => {
      const sessionId = ctx.state.id;
      const { result } = ctx;

      if (result.type === 'continue') {
        for (const action of result.actions) {
          const entry: SessionEntry = {
            id: randomUUID(),
            role: 'tool',
            content:
              typeof result.toolResult === 'string'
                ? result.toolResult
                : JSON.stringify(result.toolResult ?? ''),
            timestamp: Date.now(),
            toolName: action.tool,
            toolArguments: JSON.stringify(action.arguments),
          };
          await store.appendEntry(sessionId, entry);
        }
      } else if (result.type === 'done') {
        const messages = ctx.state.context.messages;
        const lastAssistantMsg = messages.filter((m) => m.role === 'assistant').at(-1);
        const entry: SessionEntry = {
          id: lastAssistantMsg?.id ?? randomUUID(),
          role: 'assistant',
          content: result.answer,
          timestamp: Date.now(),
        };
        await store.appendEntry(sessionId, entry);
      } else if (result.type === 'error') {
        const entry: SessionEntry = {
          id: randomUUID(),
          role: 'error',
          content: result.error.message,
          timestamp: Date.now(),
          errorMessage: result.error.message,
        };
        await store.appendEntry(sessionId, entry);
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
