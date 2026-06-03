import { createAgentState } from '@agentskillmania/colts';

import type { CommandHandler } from '../types.js';

/**
 * Create a /clear command handler that resets the agent state
 *
 * Clears all messages from the conversation history while preserving
 * the state ID and configuration. Returns a fresh state with empty context.
 */
export function createClearHandler(): CommandHandler {
  return {
    name: 'clear',
    description: 'Clear session and reset state',
    async handle(ctx) {
      const fresh = createAgentState({
        name: ctx.state.config.name,
        instructions: ctx.state.config.instructions,
        tools: [],
      });
      return {
        handled: true,
        state: { ...fresh, id: ctx.state.id },
        response: 'Session cleared.',
      };
    },
  };
}
