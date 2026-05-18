import type { CommandHandler } from '../types.js';
import { updateState } from '@agentskillmania/colts';

/**
 * Maximum number of messages to keep after compression
 */
const MAX_KEEP_MESSAGES = 4;

/**
 * Create a /compact command handler that compresses conversation context
 *
 * Keeps only the most recent MAX_KEEP_MESSAGES (4) messages in the
 * conversation history to reduce context size while maintaining
 * recent context for continuity.
 */
export function createCompactHandler(): CommandHandler {
  return {
    name: 'compact',
    description: 'Compress conversation context',
    async handle(ctx) {
      const messages = ctx.state.context.messages;
      if (messages.length <= MAX_KEEP_MESSAGES) {
        return { handled: true, response: 'Context is already compact.' };
      }
      const removedCount = messages.length - MAX_KEEP_MESSAGES;
      const newState = updateState(ctx.state, (draft) => {
        draft.context.messages = draft.context.messages.slice(-MAX_KEEP_MESSAGES);
      });
      return {
        handled: true,
        state: newState,
        response: `Context compressed: ${messages.length} messages → ${MAX_KEEP_MESSAGES} (removed ${removedCount}).`,
      };
    },
  };
}
