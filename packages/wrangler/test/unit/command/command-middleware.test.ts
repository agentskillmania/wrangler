import { describe, it, expect, vi } from 'vitest';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { createCommandMiddleware } from '../../../src/command/command-middleware.js';
import { createClearHandler } from '../../../src/command/handlers/clear.js';
import { createCompactHandler } from '../../../src/command/handlers/compact.js';
import { CommandRegistry } from '../../../src/command/registry.js';
import type { CommandHandler } from '../../../src/command/types.js';
import type { AgentState, IContextCompressor } from '@agentskillmania/colts';

describe('CommandMiddleware', () => {
  describe('middleware properties', () => {
    it('should have name "command"', () => {
      const registry = new CommandRegistry();
      const middleware = createCommandMiddleware(registry);
      expect(middleware.name).toBe('command');
    });
  });

  describe('beforeAdvance behavior', () => {
    const mockRunnerOptions = {} as {};

    it('should return undefined when no user messages in state', async () => {
      const registry = new CommandRegistry();
      const middleware = createCommandMiddleware(registry);
      const state = createAgentState();

      const result = await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: {
          startTime: Date.now(),
          elapsedTokens: 0,
          stepCount: 0,
        },
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined for plain text messages (no slash command)', async () => {
      const registry = new CommandRegistry();
      const middleware = createCommandMiddleware(registry);
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        'hello world'
      );

      const result = await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: {
          startTime: Date.now(),
          elapsedTokens: 0,
          stepCount: 0,
        },
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined when fromPhase is NOT idle', async () => {
      const registry = new CommandRegistry();
      const middleware = createCommandMiddleware(registry);
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        '/test'
      );

      const result = await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'calling-llm' as const },
        execState: {
          startTime: Date.now(),
          elapsedTokens: 0,
          stepCount: 0,
        },
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined when command name does not match any handler', async () => {
      const registry = new CommandRegistry();
      const middleware = createCommandMiddleware(registry);
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        '/unknown command'
      );

      const result = await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: {
          startTime: Date.now(),
          elapsedTokens: 0,
          stepCount: 0,
        },
      });

      expect(result).toBeUndefined();
    });

    it('should return stop result when handler returns handled=true with response', async () => {
      const handler: CommandHandler = {
        name: 'test',
        description: 'Test command',
        handle: vi.fn().mockResolvedValue({
          handled: true,
          response: 'Command executed successfully',
        }),
      };

      const registry = new CommandRegistry();
      registry.register(handler);

      const middleware = createCommandMiddleware(registry);
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        '/test command'
      );

      const result = await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: {
          startTime: Date.now(),
          elapsedTokens: 0,
          stepCount: 0,
        },
      });

      expect(result?.stop).toBe(true);
      expect(result?.result?.done).toBe(true);
      expect(result?.result?.phase).toEqual({
        type: 'completed',
        answer: 'Command executed successfully',
        // R2P-238: the completed phase marks command origin (mirrors Rust
        // colts' Phase::Completed::from_command, aab85b4/b567704).
        fromCommand: true,
      });
      // Receipt persisted as an assistant row after the user row (Rust 196d3f7).
      // R2P-109 意图构造器：钩子层不另带 state——引擎消费 result 内的状态
      //（链合并 chain.state ?? stopResult.state，与旧手搓双层等价）。
      const resultState = (result as { result?: { state?: typeof result.state } }).result?.state;
      expect(resultState?.context.messages).toHaveLength(2);
      expect(resultState?.context.messages[0]!.role).toBe('user');
      expect(resultState?.context.messages[1]!.role).toBe('assistant');
      expect(resultState?.context.messages[1]!.content).toBe('Command executed successfully');
    });

    it('should return state modification when handler returns handled=false with state', async () => {
      const modifiedState = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        '/test command'
      );

      const handler: CommandHandler = {
        name: 'test',
        description: 'Test command',
        handle: vi.fn().mockResolvedValue({
          handled: false,
          state: modifiedState,
        }),
      };

      const registry = new CommandRegistry();
      registry.register(handler);

      const middleware = createCommandMiddleware(registry);
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        '/test command'
      );

      const result = await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: {
          startTime: Date.now(),
          elapsedTokens: 0,
          stepCount: 0,
        },
      });

      expect(result).toEqual({
        state: modifiedState,
      });
      expect(result?.stop).toBeUndefined();
    });

    it('should pass parsed command to handler', async () => {
      const handler: CommandHandler = {
        name: 'deploy',
        description: 'Deploy command',
        handle: vi.fn().mockResolvedValue({
          handled: true,
          response: 'done',
        }),
      };

      const registry = new CommandRegistry();
      registry.register(handler);

      const middleware = createCommandMiddleware(registry);
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        '/deploy:prod --force'
      );

      await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: {
          startTime: Date.now(),
          elapsedTokens: 0,
          stepCount: 0,
        },
      });

      expect(handler.handle).toHaveBeenCalledWith(
        expect.objectContaining({
          command: {
            name: 'deploy',
            target: 'prod',
            body: '--force',
          },
        })
      );
    });

    it('should use empty string as answer when handled=true without response', async () => {
      const handler: CommandHandler = {
        name: 'silent',
        description: 'Silent command',
        handle: vi.fn().mockResolvedValue({
          handled: true,
        }),
      };

      const registry = new CommandRegistry();
      registry.register(handler);

      const middleware = createCommandMiddleware(registry);
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        '/silent'
      );

      const result = await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: {
          startTime: Date.now(),
          elapsedTokens: 0,
          stepCount: 0,
        },
      });

      expect(result?.result?.phase).toEqual({
        type: 'completed',
        answer: '',
        fromCommand: true,
      });
      // Empty answer → no blank receipt row is persisted.（R2P-109：state
      // 在 result 内——钩子层不另带。）
      const resultState = (result as { result?: { state?: typeof result.state } }).result?.state;
      expect(resultState?.context.messages).toHaveLength(1);
      expect(resultState?.context.messages[0]!.role).toBe('user');
    });
  });

  describe('compressed event emission (/compact)', () => {
    const mockRunnerOptions = {} as {};

    /** State ending in a user message, optionally carrying a prior compression anchor. */
    function makeState(lastMessage: string, priorAnchor?: number): AgentState {
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'earlier turn');
      state = addUserMessage(state, lastMessage);
      if (priorAnchor !== undefined) {
        state = {
          ...state,
          context: {
            ...state.context,
            compression: { summary: 'old summary', anchor: priorAnchor },
          } as AgentState['context'],
        };
      }
      return state;
    }

    /** Registry with the real built-in /compact handler. */
    function compactRegistry(): CommandRegistry {
      const registry = new CommandRegistry();
      registry.register(createCompactHandler());
      return registry;
    }

    /** Deterministic compressor resolving to the given anchor. */
    function compressorResolving(anchor: number): IContextCompressor {
      return {
        shouldCompress: () => true,
        compress: vi.fn().mockResolvedValue({
          summary: 'new summary',
          anchor,
          summaryTokenCount: 20,
          removedTokenCount: 200,
          compressedAt: 1234567890,
        }),
      } as unknown as IContextCompressor;
    }

    it('emits compressed with the anchor delta when /compact advances the compression anchor', async () => {
      const emit = vi.fn();
      const middleware = createCommandMiddleware(compactRegistry(), {
        compressor: compressorResolving(8),
        emit,
      });
      // Prior anchor 2 → handler-returned anchor 8 ⇒ this round covered 6.
      const state = makeState('/compact', 2);

      const result = await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: { startTime: Date.now(), elapsedTokens: 0, stepCount: 0 },
      });

      expect(result?.stop).toBe(true);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('compressed', {
        summary: 'new summary',
        removedCount: 6,
        coveredMessages: 6,
        timestamp: expect.any(Number),
      });
    });

    it('emits compressed on first /compact with the full anchor (no prior compression → oldAnchor 0)', async () => {
      const emit = vi.fn();
      const middleware = createCommandMiddleware(compactRegistry(), {
        compressor: compressorResolving(5),
        emit,
      });
      const state = makeState('/compact');

      await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: { startTime: Date.now(), elapsedTokens: 0, stepCount: 0 },
      });

      expect(emit).toHaveBeenCalledWith('compressed', {
        summary: 'new summary',
        removedCount: 5,
        coveredMessages: 5,
        timestamp: expect.any(Number),
      });
    });

    it('does not emit when /compact is a no-op (anchor did not advance)', async () => {
      const emit = vi.fn();
      const middleware = createCommandMiddleware(compactRegistry(), {
        compressor: compressorResolving(5),
        emit,
      });
      // Existing anchor 5, compressor returns 5 → "already compact", no state.
      const state = makeState('/compact', 5);

      const result = await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: { startTime: Date.now(), elapsedTokens: 0, stepCount: 0 },
      });

      expect(result?.stop).toBe(true);
      expect(emit).not.toHaveBeenCalled();
    });

    it('does not emit for handled commands that leave compression untouched', async () => {
      const handler: CommandHandler = {
        name: 'greet',
        description: 'Greet',
        handle: vi.fn().mockResolvedValue({ handled: true, response: 'hi' }),
      };
      const registry = new CommandRegistry();
      registry.register(handler);
      const emit = vi.fn();
      const middleware = createCommandMiddleware(registry, { emit });

      await middleware.beforeAdvance!({
        state: makeState('/greet', 3),
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: { startTime: Date.now(), elapsedTokens: 0, stepCount: 0 },
      });

      expect(emit).not.toHaveBeenCalled();
    });

    it('does not throw when no emit callback is provided', async () => {
      const middleware = createCommandMiddleware(compactRegistry(), {
        compressor: compressorResolving(8),
      });
      const state = makeState('/compact', 2);

      const result = await middleware.beforeAdvance!({
        state,
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: { startTime: Date.now(), elapsedTokens: 0, stepCount: 0 },
      });

      expect(result?.stop).toBe(true);
    });

    it('does not emit for a custom command returning updateState-derived state with compression preserved (zero delta)', async () => {
      // The real load-bearing face of the `coveredMessages > 0` guard: custom
      // handled commands that re-derive the context (updateState-style) keep
      // the compression meta untouched — anchor equal, delta 0. Without the
      // guard every such command would emit a spurious
      // compressed{removedCount:0, coveredMessages:0}. General form of the
      // no-op spec: zero progress must never emit. (R2P-104w 返修)
      const handler: CommandHandler = {
        name: 'note',
        description: 'Touch state without compressing',
        handle: async (ctx) => ({
          handled: true,
          state: { ...ctx.state, context: { ...ctx.state.context } },
          response: 'noted',
        }),
      };
      const registry = new CommandRegistry();
      registry.register(handler);
      const emit = vi.fn();
      const middleware = createCommandMiddleware(registry, { emit });

      const result = await middleware.beforeAdvance!({
        state: makeState('/note', 5),
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: { startTime: Date.now(), elapsedTokens: 0, stepCount: 0 },
      });

      expect(result?.stop).toBe(true);
      expect(emit).not.toHaveBeenCalled();
    });

    it('emits session-cleared (but not compressed) for /clear and persists the receipt on the cleared array', async () => {
      // /clear returns a fresh state (no compression); the anchor diff must
      // not be misread as progress. R2P-238: since the receipt now lands on
      // the cleared array, the middleware itself must announce the clear
      // (the colts runner's empty-messages heuristic no longer fires) —
      // mirrors Rust CommandMiddleware's SessionCleared emission.
      const registry = new CommandRegistry();
      registry.register(createClearHandler());
      const emit = vi.fn();
      const middleware = createCommandMiddleware(registry, { emit });

      const result = await middleware.beforeAdvance!({
        state: makeState('/clear', 5),
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: { startTime: Date.now(), elapsedTokens: 0, stepCount: 0 },
      });

      expect(result?.stop).toBe(true);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('session-cleared', { timestamp: expect.any(Number) });
      expect(emit).not.toHaveBeenCalledWith('compressed', expect.anything());
      // Receipt lands on the cleared messages: a resumed /clear session shows
      // "Session cleared." instead of an opaque empty conversation.
      const resultState = (result as { result?: { state?: typeof result.state } }).result?.state;
      expect(resultState?.context.messages).toHaveLength(1);
      expect(resultState?.context.messages[0]!.role).toBe('assistant');
      expect(resultState?.context.messages[0]!.content).toBe('Session cleared.');
    });

    it('does not emit session-cleared for handled commands that do not clear messages', async () => {
      const handler: CommandHandler = {
        name: 'greet',
        description: 'Greet',
        handle: vi.fn().mockResolvedValue({ handled: true, response: 'hi' }),
      };
      const registry = new CommandRegistry();
      registry.register(handler);
      const emit = vi.fn();
      const middleware = createCommandMiddleware(registry, { emit });

      await middleware.beforeAdvance!({
        state: makeState('/greet'),
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: { startTime: Date.now(), elapsedTokens: 0, stepCount: 0 },
      });

      expect(emit).not.toHaveBeenCalledWith('session-cleared', expect.anything());
      expect(emit).not.toHaveBeenCalled();
    });

    it('does not emit when the compression anchor regresses (saturating delta clamps to 0)', async () => {
      // The real /compact handler early-exits on regression, so this drives
      // the middleware's own diff: a handler returning a state whose anchor
      // went 8 → 5 must not emit — Math.max(0, …) saturates the delta to 0
      // and the guard stays false. (R2P-104w 返修)
      const handler: CommandHandler = {
        name: 'rewind',
        description: 'Return a state with a regressed anchor',
        handle: async (ctx) => ({
          handled: true,
          state: {
            ...ctx.state,
            context: {
              ...ctx.state.context,
              compression: { summary: 'rewound', anchor: 5 },
            },
          },
          response: 'rewound',
        }),
      };
      const registry = new CommandRegistry();
      registry.register(handler);
      const emit = vi.fn();
      const middleware = createCommandMiddleware(registry, { emit });

      const result = await middleware.beforeAdvance!({
        state: makeState('/rewind', 8),
        runnerOptions: mockRunnerOptions,
        fromPhase: { type: 'idle' },
        execState: { startTime: Date.now(), elapsedTokens: 0, stepCount: 0 },
      });

      expect(result?.stop).toBe(true);
      expect(emit).not.toHaveBeenCalled();
    });
  });
});
