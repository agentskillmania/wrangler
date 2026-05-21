/**
 * Error Recovery Integration Tests
 *
 * Validates the full error handling pipeline:
 * 1. LLM call failure → runner returns error result
 * 2. Tool execution failure → error fed back to LLM as tool result, run continues
 * 3. Abort signal → runner returns abort result
 *
 * Uses mock LLM to avoid real API calls.
 */

import { describe, it, expect, vi } from 'vitest';
import { EnhancedRunner } from '../../src/runner/index.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { AgentState } from '@agentskillmania/colts';

interface MockLLMResponse {
  type: 'text' | 'tool_call' | 'error' | 'delay';
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  errorMessage?: string;
  delayMs?: number;
}

function createMockLLMProvider(responses: MockLLMResponse[]) {
  let callIndex = 0;
  return {
    call: vi.fn().mockImplementation(async () => {
      const response = responses[callIndex++];
      if (!response)
        throw new Error(
          `Unexpected extra LLM call (expected ${responses.length}, got ${callIndex})`
        );
      if (response.type === 'error') {
        throw new Error(response.errorMessage!);
      }
      if (response.type === 'delay') {
        await new Promise((r) => setTimeout(r, response.delayMs));
        return {
          content: response.content,
          tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
          toolCalls: [],
        };
      }
      return {
        content: response.type === 'text' ? response.content : '',
        tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
        toolCalls: response.type === 'tool_call' ? response.toolCalls : [],
      };
    }),
    stream: vi.fn(),
  };
}

async function createRunnerWithMockLLM(responses: MockLLMResponse[]) {
  return EnhancedRunner.create({
    llmClient: createMockLLMProvider(
      responses
    ) as unknown as import('@agentskillmania/colts').ILLMProvider,
    model: 'test-model',
    workspacePath: '/tmp/test-workspace',
    mcpConfigPaths: [],
  });
}

function createStateWithUserMessage(content: string): AgentState {
  const state = createAgentState({
    name: 'test-agent',
    instructions: 'You are a helpful assistant.',
    tools: [],
  });
  return addUserMessage(state, content);
}

describe('Error Recovery Integration Tests', () => {
  describe('Scenario 1: LLM call fails', () => {
    it('should return error result when LLM call throws', async () => {
      const runner = await createRunnerWithMockLLM([
        { type: 'error', errorMessage: 'LLM timeout after 60s' },
      ]);

      const state = createStateWithUserMessage('Hello');
      const { result } = await runner.run(state);

      expect(result.type).toBe('error');
      expect((result as { error: Error }).error.message).toBe('LLM timeout after 60s');
    });

    it('should return error result for non-Error thrown by LLM', async () => {
      const runner = await createRunnerWithMockLLM([
        { type: 'error', errorMessage: '429 Rate limit exceeded' },
      ]);

      const state = createStateWithUserMessage('Hello');
      const { result } = await runner.run(state);

      expect(result.type).toBe('error');
    });
  });

  describe('Scenario 2: Tool execution fails', () => {
    it('should feed tool error back to LLM and continue the run', async () => {
      // Round 1: LLM asks to read a non-existent file
      // Round 2: LLM responds with text after seeing the error
      const runner = await createRunnerWithMockLLM([
        {
          type: 'tool_call',
          toolCalls: [{ id: 'call_1', name: 'file_read', arguments: { filePath: 'nope.txt' } }],
        },
        { type: 'text', content: 'The file does not exist.' },
      ]);

      const state = createStateWithUserMessage('Read the file nope.txt');
      const { result, state: finalState } = await runner.run(state);

      // Run should succeed because the tool error was fed back and LLM recovered
      expect(result.type).toBe('success');
      expect((result as { answer: string }).answer).toBe('The file does not exist.');

      // The tool result error should be in the conversation history
      const toolMessages = finalState.context.messages.filter((m) => m.role === 'tool');
      expect(toolMessages.length).toBeGreaterThanOrEqual(1);
      const toolMsg = toolMessages[toolMessages.length - 1];
      expect(toolMsg.content).toContain('File not found');
      expect(toolMsg.toolName).toBe('file_read');
    });

    it('should feed shell command error back to LLM', async () => {
      const runner = await createRunnerWithMockLLM([
        {
          type: 'tool_call',
          toolCalls: [
            { id: 'call_2', name: 'shell', arguments: { command: 'ls /definitely_not_real_dir' } },
          ],
        },
        { type: 'text', content: 'Directory not found.' },
      ]);

      const state = createStateWithUserMessage('List that dir');
      const { result, state: finalState } = await runner.run(state);

      expect(result.type).toBe('success');

      const toolMessages = finalState.context.messages.filter((m) => m.role === 'tool');
      expect(toolMessages.length).toBeGreaterThanOrEqual(1);
      const toolMsg = toolMessages[toolMessages.length - 1];
      // Shell returns non-zero exit code as normal text (not exception), so content contains exit code
      expect(toolMsg.content).toContain('Exit code');
    });
  });

  describe('Scenario 3: Abort signal', () => {
    it('should return abort result when signal is aborted during run', async () => {
      const runner = await createRunnerWithMockLLM([
        { type: 'delay', delayMs: 200, content: 'This will be aborted' },
      ]);

      const state = createStateWithUserMessage('Hello');
      const controller = new AbortController();

      // Abort halfway through the mock delay
      setTimeout(() => controller.abort(), 50);

      const { result } = await runner.run(state, { signal: controller.signal });

      expect(result.type).toBe('abort');
    });
  });
});
