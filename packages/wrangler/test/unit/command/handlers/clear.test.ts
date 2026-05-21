import { describe, it, expect } from 'vitest';
import { createClearHandler } from '../../../../src/command/handlers/clear.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { RunnerOptions } from '@agentskillmania/colts';

const mockRunnerOptions: Readonly<RunnerOptions> = {
  model: 'GLM-4.7',
  maxSteps: 10,
};

describe('createClearHandler', () => {
  it('should have name "clear"', () => {
    const handler = createClearHandler();
    expect(handler.name).toBe('clear');
  });

  it('should have description', () => {
    const handler = createClearHandler();
    expect(handler.description).toBe('Clear session and reset state');
  });

  describe('handle', () => {
    it('should return handled: true with "Session cleared." response', async () => {
      const handler = createClearHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'clear',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);
      expect(result.handled).toBe(true);
      expect(result.response).toBe('Session cleared.');
    });

    it('should return fresh state with empty messages', async () => {
      const handler = createClearHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const stateWithMessages = addUserMessage(state, 'Hello');
      const ctx = {
        command: {
          name: 'clear',
          body: '',
        },
        state: stateWithMessages,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);
      expect(result.state!.context.messages).toHaveLength(0);
    });

    it('should preserve original state ID', async () => {
      const handler = createClearHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const originalId = state.id;
      const ctx = {
        command: {
          name: 'clear',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);
      expect(result.state!.id).toBe(originalId);
    });

    it('should preserve original state config', async () => {
      const handler = createClearHandler();
      const state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a test agent',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'clear',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);
      expect(result.state!.config.name).toBe('test-agent');
      expect(result.state!.config.instructions).toBe('You are a test agent');
    });
  });
});
