import type { CommandHandler } from '../types.js';
import { updateState } from '@agentskillmania/colts';

/**
 * Create a /compact command handler that compresses conversation context
 *
 * Uses the colts IContextCompressor when available (produces summaries,
 * preserves key context). Falls back to truncation when no compressor
 * is provided.
 */
export function createCompactHandler(): CommandHandler {
  return {
    name: 'compact',
    description: 'Compress conversation context',
    async handle(ctx) {
      if (!ctx.compressor) {
        return { handled: true, response: 'No compressor available.' };
      }

      const result = await ctx.compressor.compress(ctx.state);

      // Nothing to compress (anchor didn't move)
      const existingAnchor = ctx.state.context.compression?.anchor ?? 0;
      if (result.anchor <= existingAnchor) {
        return { handled: true, response: 'Context is already compact.' };
      }

      const newState = updateState(ctx.state, (draft) => {
        draft.context.compression = {
          summary: result.summary,
          anchor: result.anchor,
          summaryTokenCount: result.summaryTokenCount,
          removedTokenCount: result.removedTokenCount,
          compressedAt: result.compressedAt,
        };
      });

      const removedCount = result.anchor - existingAnchor;
      return {
        handled: true,
        state: newState,
        response: `Context compressed: ${removedCount} messages compressed.${
          result.summary ? ' Summary generated.' : ''
        }`,
      };
    },
  };
}
