import { describe, it, expect, vi } from 'vitest';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { createCommandMiddleware } from '../../../src/command/command-middleware.js';
import { CommandRegistry } from '../../../src/command/registry.js';
import type { CommandHandler } from '../../../src/command/types.js';

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
});
