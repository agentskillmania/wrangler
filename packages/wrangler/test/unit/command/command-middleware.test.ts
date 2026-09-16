import { describe, it, expect, vi } from 'vitest';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { createCommandMiddleware } from '../../../src/command/command-middleware.js';
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

      expect(result).toEqual({
        state,
        stop: true,
        result: {
          done: true,
          state,
          execState: {
            startTime: expect.any(Number),
            elapsedTokens: 0,
            stepCount: 0,
          },
          phase: { type: 'completed', answer: 'Command executed successfully' },
        },
      });
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
      });
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
  });
});
