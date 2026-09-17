// packages/core/src/middleware/session-naming-middleware.ts

import type { AgentMiddleware, ILLMProvider } from '@agentskillmania/colts';

import { extractTitle, generateTitlePrompt } from '../session/naming.js';
import type { SessionStore } from '../session/session-store.js';

/**
 * Late-bound sink slot for `session-title` notifications — the TS analog of
 * Rust 2287cc1's `NamingEventSlot` (an RwLock<Option<EventSink>>).
 *
 * Empty slot (no sink) = no session listener: the upgrade still persists to
 * meta.yaml, it just does not notify (devtool / bare-harness default). The
 * host (daemon session materialization) binds the sink AFTER the runner is
 * constructed — hence a mutable holder instead of a callback dep.
 */
export interface SessionTitleSlot {
  sink?: (title: string) => void;
}

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
  /** Late-bound session-title notification slot (R2P-232, aligned Rust 2287cc1). */
  titleEventSlot?: SessionTitleSlot;
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
  const { store, llmClient, model: namingModel, titleEventSlot } = deps;

  // Dir-bound stores don't accept a sessionId — pass undefined instead
  // (mirrors session-middleware's resolveSid).
  const resolveSid = (ctx: { state: { id?: string } }) =>
    store.isDirBound ? undefined : ctx.state.id;

  return {
    name: 'session-naming',

    beforeRun: async (ctx) => {
      const sessionId = resolveSid(ctx);

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
      const sessionId = resolveSid(ctx);
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
                  const title = llmTitle.replace(/^["']|["']$/g, '');
                  await store.updateMeta(capturedSessionId, {
                    title,
                    titleSource: 'generated',
                  });
                  // 先落盘后通知（R2P-232，对齐 Rust 2287cc1）：事件只在
                  // "标题已改"后发出；载荷只有 title —— 与 ACP 翻译层
                  // (SessionInfoUpdate.title)逐字段一致的最小契约形状。
                  // 槽空（会话未物化/devtool）则静默——没有听众不喊。
                  titleEventSlot?.sink?.(title);
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
