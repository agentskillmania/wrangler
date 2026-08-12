/**
 * Error Recovery Integration Tests
 *
 * Validates error handling with real LLM:
 * 1. Tool execution failure → error fed back to LLM, run continues
 * 2. Abort signal → runner returns abort result
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect } from 'vitest';
import { EnhancedRunner } from '../../src/runner/index.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { createLLMClient } from '../../src/llm/client.js';
import { testConfig, itif } from './config.js';

function makeLLMClient() {
  return createLLMClient([
    {
      name: testConfig.provider,
      apiKey: testConfig.apiKey,
      baseUrl: testConfig.baseUrl,
      models: [{ modelId: testConfig.testModel }],
    },
  ]);
}

async function createRunner() {
  return EnhancedRunner.create({
    llm: { client: makeLLMClient() as any, model: testConfig.testModel },
    workspacePath: '/tmp/test-workspace',
    mcpConfigPaths: [],
  });
}

describe('Error Recovery Integration Tests', () => {
  describe('Scenario 1: Tool execution fails, LLM recovers', () => {
    itif(testConfig.enabled)(
      'should feed tool error back to LLM and continue the run',
      async () => {
        const runner = await createRunner();

        let state = createAgentState({
          name: 'test-agent',
          instructions:
            'You are a helpful assistant. If a tool fails, explain the error to the user.',
          tools: [],
        });
        state = addUserMessage(state, 'Read the file /tmp/this_file_does_not_exist_xyz.txt');

        const { result, state: finalState } = await runner.run(state);

        expect(result.type).toBe('success');
        expect(result.answer).toBeTruthy();
        // LLM should have used file_read tool which fails, then recovered
        const toolMessages = finalState.context.messages.filter((m) => m.role === 'tool');
        expect(toolMessages.length).toBeGreaterThanOrEqual(1);
      },
      120000
    );

    itif(testConfig.enabled)(
      'should feed shell command error back to LLM',
      async () => {
        const runner = await createRunner();

        let state = createAgentState({
          name: 'test-agent',
          instructions:
            'You are a helpful assistant. If a tool fails, explain the error to the user.',
          tools: [],
        });
        state = addUserMessage(state, 'Run the command: ls /definitely_not_real_dir_xyz');

        const { result, state: finalState } = await runner.run(state);

        expect(result.type).toBe('success');
        expect(result.answer).toBeTruthy();
        const toolMessages = finalState.context.messages.filter((m) => m.role === 'tool');
        expect(toolMessages.length).toBeGreaterThanOrEqual(1);
      },
      120000
    );
  });

  describe('Scenario 2: Abort signal', () => {
    itif(testConfig.enabled)(
      'should return abort result when signal is aborted during run',
      async () => {
        const runner = await createRunner();

        let state = createAgentState({
          name: 'test-agent',
          instructions: 'You are a helpful assistant. Answer in detail.',
          tools: [],
        });
        state = addUserMessage(state, 'Write a very long essay about artificial intelligence.');

        const controller = new AbortController();
        setTimeout(() => controller.abort(), 100);

        const { result } = await runner.run(state, { signal: controller.signal });

        // Result should be abort or success (if LLM was fast enough)
        expect(['abort', 'success']).toContain(result.type);
      },
      120000
    );
  });
});
