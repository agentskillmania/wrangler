import type { AgentMiddleware } from '@agentskillmania/colts';
import type { CommandRegistry } from './registry.js';
import { parseCommand } from './parser.js';

/**
 * Create command middleware.
 * Hooks into beforeAdvance at idle phase to detect slash commands.
 */
export function createCommandMiddleware(registry: CommandRegistry): AgentMiddleware {
  return {
    name: 'command',

    async beforeAdvance(ctx) {
      // Only intercept at the first advance of a new message
      if (ctx.fromPhase.type !== 'idle') return;

      const messages = ctx.state.context.messages;
      if (messages.length === 0) return;

      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role !== 'user') return;

      const parsed = parseCommand(lastMsg.content);
      if (!parsed) return;

      const handler = registry.resolve(parsed.name);
      if (!handler) return;

      const result = await handler.handle({
        command: parsed,
        state: ctx.state,
        runnerOptions: ctx.runnerOptions,
      });

      if (!result.handled) {
        // Side-effects only (e.g. skill loaded), continue normally
        return result.state ? { state: result.state } : undefined;
      }

      // Command fully handled — stop execution with completed phase
      return {
        stop: true,
        result: {
          state: result.state ?? ctx.state,
          execState: ctx.execState,
          phase: { type: 'completed' as const, answer: result.response ?? '' },
          done: true,
        },
      };
    },
  };
}
