import type { AgentMiddleware, IContextCompressor } from '@agentskillmania/colts';

import { parseCommand } from './parser.js';
import type { CommandRegistry } from './registry.js';

export interface CommandMiddlewareDeps {
  compressor?: IContextCompressor;
  /**
   * Event sink for command side effects, wired by EnhancedRunner to the
   * runner's EventEmitter (same channel stream consumers subscribe to).
   *
   * When a handled command advances the compression anchor — `/compact` via
   * its handler — the middleware emits a `compressed` event here with the
   * SAME payload shape as the colts kernel's maybeCompress emission. The
   * middleware is the first-hand truth: it sees both the pre-command state
   * and the handler-returned state, so consumers don't have to diff state
   * snapshots to notice a compression. Mirrors Rust CommandMiddleware's
   * `event_tx` (command.rs Compressed emission). (R2P-104w)
   */
  emit?: (type: string, data: Record<string, unknown>) => void;
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

      // Emit command side-effect events. `/compact` advancing the compression
      // anchor emits `compressed` with the anchor delta as coveredMessages —
      // same payload shape and saturating semantics as the kernel's
      // maybeCompress (missing prior compression counts as anchor 0, so a
      // first compact reports its full coverage). No-op compacts (handler
      // early-returns "already compact", anchor not advanced) emit nothing,
      // matching the Rust middleware guard `new_comp.anchor > old_comp.anchor`.
      const oldAnchor = ctx.state.context.compression?.anchor ?? 0;
      const newCompression = result.state?.context.compression;
      const newAnchor = newCompression?.anchor ?? oldAnchor;
      const coveredMessages = Math.max(0, newAnchor - oldAnchor);
      if (newCompression && coveredMessages > 0) {
        deps?.emit?.('compressed', {
          summary: newCompression.summary,
          removedCount: coveredMessages,
          coveredMessages,
          timestamp: Date.now(),
        });
      }

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
