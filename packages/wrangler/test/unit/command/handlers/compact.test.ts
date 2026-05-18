import { describe, it, expect } from 'vitest';
import { createCompactHandler } from '../../../../src/command/handlers/compact.js';
import { createAgentState, addUserMessage, addAssistantMessage } from '@agentskillmania/colts';
import type { RunnerOptions } from '@agentskillmania/colts';

const mockRunnerOptions: Readonly<RunnerOptions> = {
  model: 'GLM-4.7',
  maxSteps: 10,
};

describe('createCompactHandler', () => {
  it('should have name "compact"', () => {
    const handler = createCompactHandler();
    expect(handler.name).toBe('compact');
  });

  it('should have description', () => {
    const handler = createCompactHandler();
    expect(handler.description).toBe('Compress conversation context');
  });

  describe('handle', () => {
    it('should return handled: true with response containing "compressed"', async () => {
      const handler = createCompactHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      // Add 6 messages to exceed MAX_KEEP_MESSAGES (4)
      let stateWithMessages = state;
      for (let i = 0; i < 6; i++) {
        stateWithMessages = addUserMessage(stateWithMessages, `Message ${i}`);
      }
      const ctx = {
        command: {
          name: 'compact',
          body: '',
        },
        state: stateWithMessages,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);
      expect(result.handled).toBe(true);
      expect(result.response).toContain('compressed');
    });

    it('should reduce message count when messages exceed MAX_KEEP_MESSAGES', async () => {
      const handler = createCompactHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      // Add 6 messages
      let stateWithMessages = state;
      for (let i = 0; i < 6; i++) {
        stateWithMessages = addUserMessage(stateWithMessages, `Message ${i}`);
      }
      const originalCount = stateWithMessages.context.messages.length;
      const ctx = {
        command: {
          name: 'compact',
          body: '',
        },
        state: stateWithMessages,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);
      expect(result.state).toBeDefined();
      expect(result.state!.context.messages.length).toBeLessThan(originalCount);
      expect(result.state!.context.messages.length).toBe(4);
    });

    it('should return "already compact" when messages <= MAX_KEEP_MESSAGES', async () => {
      const handler = createCompactHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      // Add only 2 messages (less than MAX_KEEP_MESSAGES which is 4)
      let stateWithMessages = state;
      stateWithMessages = addUserMessage(stateWithMessages, 'Message 1');
      stateWithMessages = addUserMessage(stateWithMessages, 'Message 2');
      const ctx = {
        command: {
          name: 'compact',
          body: '',
        },
        state: stateWithMessages,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);
      expect(result.handled).toBe(true);
      expect(result.response).toBe('Context is already compact.');
      expect(result.state).toBeUndefined();
    });

    it('should preserve the last MAX_KEEP_MESSAGES messages', async () => {
      const handler = createCompactHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      // Add 6 messages with specific content
      let stateWithMessages = state;
      for (let i = 0; i < 6; i++) {
        stateWithMessages = addUserMessage(stateWithMessages, `Message ${i}`);
      }
      const ctx = {
        command: {
          name: 'compact',
          body: '',
        },
        state: stateWithMessages,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);
      const messages = result.state!.context.messages;
      expect(messages).toHaveLength(4);
      expect(messages[0].content).toBe('Message 2');
      expect(messages[1].content).toBe('Message 3');
      expect(messages[2].content).toBe('Message 4');
      expect(messages[3].content).toBe('Message 5');
    });

    it('should include removal count in response', async () => {
      const handler = createCompactHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      // Add 7 messages
      let stateWithMessages = state;
      for (let i = 0; i < 7; i++) {
        stateWithMessages = addUserMessage(stateWithMessages, `Message ${i}`);
      }
      const ctx = {
        command: {
          name: 'compact',
          body: '',
        },
        state: stateWithMessages,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);
      expect(result.response).toContain('7 messages → 4');
      expect(result.response).toContain('removed 3');
    });

    it('should handle mixed user and assistant messages', async () => {
      const handler = createCompactHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      // Add 6 messages alternating between user and assistant
      let stateWithMessages = state;
      stateWithMessages = addUserMessage(stateWithMessages, 'User 1');
      stateWithMessages = addAssistantMessage(stateWithMessages, 'Assistant 1');
      stateWithMessages = addUserMessage(stateWithMessages, 'User 2');
      stateWithMessages = addAssistantMessage(stateWithMessages, 'Assistant 2');
      stateWithMessages = addUserMessage(stateWithMessages, 'User 3');
      stateWithMessages = addAssistantMessage(stateWithMessages, 'Assistant 3');
      const ctx = {
        command: {
          name: 'compact',
          body: '',
        },
        state: stateWithMessages,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);
      const messages = result.state!.context.messages;
      expect(messages).toHaveLength(4);
      expect(messages[0].content).toBe('User 2');
      expect(messages[1].content).toBe('Assistant 2');
      expect(messages[2].content).toBe('User 3');
      expect(messages[3].content).toBe('Assistant 3');
    });
  });
});
