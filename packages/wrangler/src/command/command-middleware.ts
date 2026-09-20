import type { AgentMiddleware, IContextCompressor } from '@agentskillmania/colts';
import { addAssistantMessage } from '@agentskillmania/colts';
import { contentToPlainText } from '@agentskillmania/llm-client';

import { parseCommand } from './parser.js';
import type { CommandRegistry } from './registry.js';

export interface CommandMiddlewareDeps {
  compressor?: IContextCompressor;
  /**
   * Event sink for command side effects, wired by AgentHarness to the
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

      // 多模态 parts 按降级纯文本判命令（纯图消息不是命令，R2P-107）。
      const parsed = parseCommand(contentToPlainText(lastMsg.content));
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

      // `/clear` wiped the conversation: notify clients to drop their local
      // message list. The middleware is the first-hand truth (it sees the
      // handler-returned state) — mirrors Rust CommandMiddleware's
      // `SessionCleared` emission (command.rs). The colts runner's own
      // messages-empty heuristic no longer fires once the receipt below lands
      // on the cleared array, so this emission is what keeps `/clear` visible.
      const receipt = result.response ?? '';
      const clearedByHandler =
        finalState.context.messages.length === 0 && ctx.state.context.messages.length > 0;
      if (clearedByHandler && receipt.length > 0) {
        deps?.emit?.('session-cleared', { timestamp: Date.now() });
      }

      // Receipt persistence (R2P-238, aligned with Rust 196d3f7): a command
      // answer never goes through the LLM/token stream. Before this, live
      // consumers saw the daemon's echoed token but a resumed session showed
      // the user row dangling with no reply. Writing the receipt as an
      // assistant message keeps the live view and the persisted history
      // isomorphic (the daemon's token echo still drives live streaming, the
      // same "stream first, then persist" shape as the LLM path). Empty
      // answers are not persisted (no blank row). `/clear`'s receipt lands on
      // the already-cleared array.
      const stateWithReceipt =
        receipt.length > 0 ? addAssistantMessage(finalState, receipt) : finalState;

      // The completed phase carries `fromCommand` — the TS mirror of colts'
      // `Phase::Completed::from_command` (aab85b4 / b567704). It tells
      // consumers the answer was produced by command interception (no LLM
      // call, nothing streamed), so a host can echo it as a token frame
      // instead of inferring that from token counts (0fc6fba). The published
      // colts kernel does not type/forward the field yet (`complete_from_command`
      // arrives with R2P-109), so it is attached via a non-literal object —
      // structurally assignable to `Phase` without an excess-property error.
      const phase = {
        type: 'completed' as const,
        answer: receipt,
        fromCommand: true,
      };

      return {
        state: stateWithReceipt,
        stop: true,
        result: {
          state: stateWithReceipt,
          execState: ctx.execState,
          phase,
          done: true,
        },
      };
    },
  };
}
