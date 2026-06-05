// packages/core/src/middleware/session-middleware.ts

import { randomUUID } from 'node:crypto';

import type { AgentMiddleware } from '@agentskillmania/colts';

import { extractTitle, generateTitlePrompt } from '../session/naming.js';
import type { SessionStore } from '../session/session-store.js';
import type { SessionEntry } from '../session/types.js';

/**
 * Dependencies for session middleware.
 * `llmClient` is optional — when provided, Phase 2 LLM title upgrade is enabled.
 */
export interface SessionNamingDeps {
  store: SessionStore;
  llmClient?: {
    execute: (prompt: string) => Promise<string>;
  };
}

/**
 * Create session management middleware.
 *
 * - beforeRun: create session dir if missing, record user message with colts Message.id,
 *   set initial title from first user message (Phase 1 truncation)
 * - afterStep: write SessionEntry (tool/assistant/error) to session.jsonl
 * - afterRun: save state + update meta, optionally upgrade title via LLM (Phase 2)
 */
export function createSessionMiddleware(deps: SessionNamingDeps): AgentMiddleware {
  const { store, llmClient } = deps;
  return {
    name: 'session',

    beforeRun: async (ctx) => {
      const sessionId = ctx.state.id;
      const model = ctx.runnerOptions.model;

      if (!(await store.existsAsync(sessionId))) {
        await store.createWithId(sessionId, model, ctx.state.config.name);

        // Phase 1: Set initial title from first user message
        const msgs = ctx.state.context.messages;
        const firstUserMsg = msgs.find((m) => m.role === 'user');
        if (firstUserMsg && typeof firstUserMsg.content === 'string') {
          const title = extractTitle(firstUserMsg.content);
          await store.updateMeta(sessionId, { title });
        }
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

      // Phase 2: LLM title upgrade on first run only
      if (ctx.state.context.stepCount <= 1 && llmClient) {
        try {
          const meta = await store.getMeta(sessionId);
          if (meta && (!meta.title || meta.title === 'Untitled')) {
            const messages = ctx.state.context.messages;
            const firstUserMsg = messages.find((m) => m.role === 'user');
            const firstAssistantMsg = messages.find((m) => m.role === 'assistant');

            if (firstUserMsg && firstAssistantMsg) {
              const userContent =
                typeof firstUserMsg.content === 'string' ? firstUserMsg.content : '';
              const assistantContent =
                typeof firstAssistantMsg.content === 'string' ? firstAssistantMsg.content : '';

              const prompt = generateTitlePrompt(userContent, assistantContent);
              const llmTitle = await llmClient.execute(prompt);

              if (llmTitle?.trim()) {
                await store.updateMeta(sessionId, {
                  title: llmTitle.trim().replace(/^["']|["']$/g, ''),
                });
              }
            }
          }
        } catch {
          // LLM title upgrade is best-effort — failures are non-fatal
        }
      }
    },
  };
}
