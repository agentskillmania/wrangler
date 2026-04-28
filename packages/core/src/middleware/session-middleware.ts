// packages/core/src/middleware/session-middleware.ts

import type { AgentMiddleware } from '@agentskillmania/colts';
import type { SessionStore } from '../session/session-store.js';
import type { TranscriptEntry } from '../types.js';

/**
 * 创建 session 管理 middleware
 *
 * - beforeRun: 检查 session 目录 → 不存在则创建，写 User transcript entry
 * - afterStep: 根据 StepResult 类型写 Tool/Assistant/Error transcript entry
 * - afterRun: saveState（Snapshot 格式）+ updateMeta
 *
 * model 从 ctx.runnerOptions.model 获取，无需外部注入。
 */
export function createSessionMiddleware(store: SessionStore): AgentMiddleware {
  return {
    name: 'session',

    async beforeRun(ctx) {
      const sessionId = ctx.state.id;

      if (!(await store.existsAsync(sessionId))) {
        const model = ctx.runnerOptions.model;
        await store.createWithId(sessionId, model);
      }

      const messages = ctx.state.context.messages;
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) {
        const entry: TranscriptEntry = {
          type: 'user',
          content:
            typeof lastUserMsg.content === 'string'
              ? lastUserMsg.content
              : JSON.stringify(lastUserMsg.content),
          timestamp: Date.now(),
        };
        await store.appendTranscript(sessionId, entry);
      }
    },

    async afterStep(ctx) {
      const sessionId = ctx.state.id;
      const { result } = ctx;

      if (result.type === 'continue') {
        for (const action of result.actions) {
          const entry: TranscriptEntry = {
            type: 'tool',
            toolName: action.tool,
            arguments: JSON.stringify(action.arguments),
            result:
              typeof result.toolResult === 'string'
                ? result.toolResult
                : JSON.stringify(result.toolResult ?? ''),
            timestamp: Date.now(),
          };
          await store.appendTranscript(sessionId, entry);
        }
      } else if (result.type === 'done') {
        const entry: TranscriptEntry = {
          type: 'assistant',
          content: result.answer,
          timestamp: Date.now(),
        };
        await store.appendTranscript(sessionId, entry);
      } else if (result.type === 'error') {
        const entry: TranscriptEntry = {
          type: 'error',
          message: result.error.message,
          timestamp: Date.now(),
        };
        await store.appendTranscript(sessionId, entry);
      }
    },

    async afterRun(ctx) {
      const sessionId = ctx.state.id;

      await store.saveState(sessionId, ctx.state);

      await store.updateMeta(sessionId, {
        updatedAt: new Date().toISOString(),
        messageCount: ctx.state.context.messages.length,
      });
    },
  };
}
