import { updateState } from '@agentskillmania/colts';

import type { CommandHandler } from '../types.js';

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

      // Nothing to compress (anchor didn't move). Two different reasons, two
      // different messages (R2P-238, aligned with Rust 196d3f7): a session that
      // was compressed before and has no NEW compressible content → "already";
      // a short session whose kept-recent window still covers everything →
      // "nothing yet" (saying "already" there would wrongly imply compression
      // had happened).
      const existingAnchor = ctx.state.context.compression?.anchor ?? 0;
      if (result.anchor <= existingAnchor) {
        return {
          handled: true,
          response:
            existingAnchor > 0
              ? 'Context is already compact.'
              : 'Nothing to compact yet — the kept-recent window still covers the whole conversation.',
        };
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
