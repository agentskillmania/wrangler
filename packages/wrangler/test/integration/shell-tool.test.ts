/**
 * Shell tool E2E integration tests
 *
 * Real LLM-based tests that verify the shell tool works end-to-end
 * with the AgentRunner. Tests require both:
 * - WASM sandbox availability (for shell execution)
 * - LLM availability (for agent orchestration)
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 * - WASM runtime (wasmtime) must be available
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { Sandbox } from '@agentskillmania/sandbox';
import { createShellTool } from '../../src/tools/builtin/shell.js';
import { MarkdownMessageAssembler } from '../../src/runner/markdown-assembler.js';
import { testConfig, itif } from './config.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

// Probe sandbox availability at module level
let sandboxAvailable = false;
let sandbox: Sandbox;
let sandboxDir: string;

try {
  sandboxDir = join(tmpdir(), `wrangler-shell-intg-${Date.now()}`);
  await mkdir(sandboxDir, { recursive: true });
  sandbox = new Sandbox({ sandboxDir, timeout: 15000 });
  const result = await sandbox.run('echo probe');
  sandboxAvailable = result.exitCode === 0;
} catch {
  sandboxAvailable = false;
}

const canRun = testConfig.enabled && sandboxAvailable;

beforeAll(() => {
  if (testConfig.enabled) {
    console.log(
      `[Wrangler Integration] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`
    );
  }
  if (sandboxAvailable) {
    console.log(`[Wrangler Integration] Shell tool: Sandbox available at ${sandboxDir}`);
  } else {
    console.log('[Wrangler Integration] Shell tool: Sandbox NOT available (tests will skip)');
  }
});

afterAll(async () => {
  if (sandboxDir) {
    await rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
  }
});

describe('US1: LLM executes shell command and reports result', () => {
  itif(canRun)(
    'should execute echo command via shell tool and return output',
    async () => {
      const shellTool = createShellTool(sandbox);
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llm: {
          apiKey: testConfig.apiKey,
          provider: testConfig.provider,
          baseUrl: testConfig.baseUrl,
        },
        tools: [shellTool],
        middleware: [],
        messageAssembler: new MarkdownMessageAssembler(),
      });

      let state = createAgentState({
        name: 'shell-agent',
        instructions: 'You are a helpful assistant. Use the shell tool when requested.',
        tools: [],
      });
      state = addUserMessage(
        state,
        'Use the shell tool to run "echo hello world" and tell me what it outputs.'
      );

      const { state: finalState, result } = await runner.run(state);

      expect(result.type).toBe('success');

      // Verify LLM response contains the expected output
      const lastMessage = finalState.context.messages[finalState.context.messages.length - 1];
      const responseText =
        typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      expect(responseText.toLowerCase()).toContain('hello world');

      // Verify shell tool was actually called
      const toolCalls = finalState.context.messages.flatMap((m) => m.toolCalls || []);
      const shellCalls = toolCalls.filter((tc) => tc.name === 'shell');
      expect(shellCalls.length).toBeGreaterThan(0);
    },
    60000
  );
});

describe('US2: LLM uses shell tool for computation', () => {
  itif(canRun)(
    'should use shell tool to perform arithmetic calculation',
    async () => {
      const shellTool = createShellTool(sandbox);
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llm: {
          apiKey: testConfig.apiKey,
          provider: testConfig.provider,
          baseUrl: testConfig.baseUrl,
        },
        tools: [shellTool],
        middleware: [],
        messageAssembler: new MarkdownMessageAssembler(),
      });

      let state = createAgentState({
        name: 'math-agent',
        instructions:
          'You are a math assistant. Use the shell tool to perform calculations when requested.',
        tools: [],
      });
      state = addUserMessage(
        state,
        'Use the shell tool to calculate 123 * 456 using echo and arithmetic, then tell me the result.'
      );

      const { state: finalState, result } = await runner.run(state);

      expect(result.type).toBe('success');

      // Verify LLM response contains the correct answer (56088)
      const lastMessage = finalState.context.messages[finalState.context.messages.length - 1];
      const responseText =
        typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      // Remove commas from response to handle formatted numbers (e.g., "56,088" -> "56088")
      const normalizedText = responseText.replace(/,/g, '');
      expect(normalizedText).toContain('56088');

      // Verify shell tool was called
      const toolCalls = finalState.context.messages.flatMap((m) => m.toolCalls || []);
      const shellCalls = toolCalls.filter((tc) => tc.name === 'shell');
      expect(shellCalls.length).toBeGreaterThan(0);
    },
    60000
  );
});

describe('US3: LLM handles shell command failure gracefully', () => {
  itif(canRun)(
    'should handle non-existent directory command without crashing',
    async () => {
      const shellTool = createShellTool(sandbox);
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llm: {
          apiKey: testConfig.apiKey,
          provider: testConfig.provider,
          baseUrl: testConfig.baseUrl,
        },
        tools: [shellTool],
        middleware: [],
        messageAssembler: new MarkdownMessageAssembler(),
      });

      let state = createAgentState({
        name: 'shell-agent',
        instructions:
          'You are a helpful assistant. Use the shell tool when requested. Report errors clearly.',
        tools: [],
      });
      state = addUserMessage(
        state,
        'Use the shell tool to run "ls /nonexistent_dir_xyz" and tell me what happened.'
      );

      const { state: finalState, result } = await runner.run(state);

      expect(result.type).toBe('success');

      // Verify LLM acknowledges the error (doesn't crash or hang)
      const lastMessage = finalState.context.messages[finalState.context.messages.length - 1];
      const responseText =
        typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

      // Response should mention something about error/failure/non-existence
      const errorIndicators = ['error', 'failed', 'not found', 'no such', 'cannot access', 'exit'];
      const hasErrorIndicator = errorIndicators.some((indicator) =>
        responseText.toLowerCase().includes(indicator)
      );
      expect(hasErrorIndicator).toBe(true);

      // Verify shell tool was called
      const toolCalls = finalState.context.messages.flatMap((m) => m.toolCalls || []);
      const shellCalls = toolCalls.filter((tc) => tc.name === 'shell');
      expect(shellCalls.length).toBeGreaterThan(0);
    },
    60000
  );
});

describe('Skip conditions', () => {
  itif(!testConfig.enabled && sandboxAvailable)('skips when LLM is not available', () => {
    expect(true).toBe(true);
  });

  itif(testConfig.enabled && !sandboxAvailable)('skips when sandbox is not available', () => {
    expect(true).toBe(true);
  });

  itif(!testConfig.enabled && !sandboxAvailable)(
    'skips when both LLM and sandbox are not available',
    () => {
      expect(true).toBe(true);
    }
  );
});
