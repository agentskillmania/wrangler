import type { AgentMiddleware, IContextCompressor } from '@agentskillmania/colts';
import type { CommandRegistry } from './registry.js';
import { parseCommand } from './parser.js';

export interface CommandMiddlewareDeps {
  compressor?: IContextCompressor;
}

/**
 * Create command middleware.
 * Hooks into beforeAdvance at idle phase to detect slash commands.
 */
export function createCommandMiddleware(
  registry: CommandRegistry,
  deps?: CommandMiddlewareDeps
): AgentMiddleware {
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
        compressor: deps?.compressor,
      });

      if (!result.handled) {
        // Side-effects only (e.g. skill loaded), continue normally
        return result.state ? { state: result.state } : undefined;
      }

      // Command fully handled — stop execution with completed phase
      const finalState = result.state ?? ctx.state;
      return {
        state: finalState,
        stop: true,
        result: {
          state: finalState,
          execState: ctx.execState,
          phase: { type: 'completed' as const, answer: result.response ?? '' },
          done: true,
        },
      };
    },
  };
}
