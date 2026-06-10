// packages/core/src/middleware/session-naming-middleware.ts

import type { AgentMiddleware, ILLMProvider } from '@agentskillmania/colts';

import { extractTitle, generateTitlePrompt } from '../session/naming.js';
import type { SessionStore } from '../session/session-store.js';

/**
 * Dependencies for session naming middleware.
 * `llmClient` is optional — when provided, Phase 2 LLM title upgrade is enabled.
 */
export interface SessionNamingDeps {
  store: SessionStore;
  /** Optional LLM provider for Phase 2 title upgrade. */
  llmClient?: ILLMProvider;
  /** Model to use for Phase 2 title generation. Required when llmClient is provided. */
  model?: string;
}

/**
 * Create session naming middleware.
 *
 * Handles two-phase session title generation:
 * - Phase 1 (beforeRun): Extract title from first user message (titleSource = 'auto')
 * - Phase 2 (afterStep done): LLM-generated title upgrade (titleSource = 'generated')
 *
 * Idempotency guards (all disk-based):
 * - Phase 1: only runs when session has no title yet
 * - Phase 2: only runs when titleSource === 'auto' (skips 'generated' or 'manual')
 */
export function createSessionNamingMiddleware(deps: SessionNamingDeps): AgentMiddleware {
  const { store, llmClient, model: namingModel } = deps;

  return {
    name: 'session-naming',

    beforeRun: async (ctx) => {
      const sessionId = ctx.state.id;

      // Phase 1: Set initial title from first user message
      // Guard: only if session exists but has no title yet
      const meta = await store.getMeta(sessionId);
      if (meta && !meta.title) {
        const messages = ctx.state.context.messages;
        const firstUserMsg = messages.find((m) => m.role === 'user');
        if (firstUserMsg && typeof firstUserMsg.content === 'string') {
          const title = extractTitle(firstUserMsg.content);
          await store.updateMeta(sessionId, { title, titleSource: 'auto' });
        }
      }
    },

    afterStep: async (ctx) => {
      const sessionId = ctx.state.id;
      const { result } = ctx;

      // Phase 2: fire-and-forget LLM title upgrade on terminal step
      if (result.type === 'done' && llmClient && namingModel) {
        const capturedSessionId = sessionId;
        const capturedMessages = ctx.state.context.messages;
        const capturedModel = namingModel;
        const capturedLLM = llmClient;

        Promise.resolve().then(async () => {
          try {
            const meta = await store.getMeta(capturedSessionId);
            if (meta?.titleSource === 'auto') {
              const firstUserMsg = capturedMessages.find((m) => m.role === 'user');
              const firstAssistantMsg = capturedMessages.find((m) => m.role === 'assistant');

              if (firstUserMsg && firstAssistantMsg) {
                const userContent =
                  typeof firstUserMsg.content === 'string' ? firstUserMsg.content : '';
                const assistantContent =
                  typeof firstAssistantMsg.content === 'string' ? firstAssistantMsg.content : '';

                const prompt = generateTitlePrompt(userContent, assistantContent);
                const res = await capturedLLM.call({
                  model: capturedModel,
                  messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
                });

                const llmTitle = res.content?.trim();
                if (llmTitle) {
                  await store.updateMeta(capturedSessionId, {
                    title: llmTitle.replace(/^["']|["']$/g, ''),
                    titleSource: 'generated',
                  });
                }
              }
            }
          } catch {
            // LLM title upgrade is best-effort — failures are non-fatal
          }
        });
      }
    },
  };
}
