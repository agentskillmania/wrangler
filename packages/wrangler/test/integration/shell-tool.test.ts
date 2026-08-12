/**
 * Shell tool E2E integration tests
 *
 * Real LLM-based tests that verify the shell tool works end-to-end
 * with the AgentRunner using HostToolDeps (host mode).
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { createShellTool } from '../../src/tools/builtin/shell.js';
import { HostToolDeps } from '../../src/tools/builtin/workspace-deps.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';
import { MarkdownMessageAssembler } from '../../src/runner/markdown-assembler.js';
import { testConfig, itif } from './config.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

let workspace: string;
let deps: HostToolDeps;

beforeAll(async () => {
  workspace = join(tmpdir(), `wrangler-shell-intg-${Date.now()}`);
  await mkdir(workspace, { recursive: true });
  deps = new HostToolDeps(new NodeHostEnv(), workspace);

  if (testConfig.enabled) {
    console.log(
      `[Wrangler Integration] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`
    );
    console.log(`[Wrangler Integration] Shell tool: Host mode, shell=${deps.shell.name}`);
  }
});

afterAll(async () => {
  if (workspace) {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});

describe('US1: LLM executes shell command and reports result', () => {
  itif(testConfig.enabled)(
    'should execute echo command via shell tool and return output',
    async () => {
      const shellTool = createShellTool(deps);
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llm: {
          providers: [
            {
              name: testConfig.provider,
              apiKey: testConfig.apiKey,
              baseUrl: testConfig.baseUrl,
              models: [{ modelId: testConfig.testModel }],
            },
          ],
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

      const lastMessage = finalState.context.messages[finalState.context.messages.length - 1];
      const responseText =
        typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      expect(responseText.toLowerCase()).toContain('hello world');

      const toolCalls = finalState.context.messages.flatMap((m) => m.toolCalls || []);
      const shellCalls = toolCalls.filter((tc) => tc.name === 'shell');
      expect(shellCalls.length).toBeGreaterThan(0);
    },
    120000
  );
});

describe('US2: LLM uses shell tool for computation', () => {
  itif(testConfig.enabled)(
    'should use shell tool to perform arithmetic calculation',
    async () => {
      const shellTool = createShellTool(deps);
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llm: {
          providers: [
            {
              name: testConfig.provider,
              apiKey: testConfig.apiKey,
              baseUrl: testConfig.baseUrl,
              models: [{ modelId: testConfig.testModel }],
            },
          ],
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

      const lastMessage = finalState.context.messages[finalState.context.messages.length - 1];
      const responseText =
        typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      const normalizedText = responseText.replace(/,/g, '');
      expect(normalizedText).toContain('56088');

      const toolCalls = finalState.context.messages.flatMap((m) => m.toolCalls || []);
      const shellCalls = toolCalls.filter((tc) => tc.name === 'shell');
      expect(shellCalls.length).toBeGreaterThan(0);
    },
    120000
  );
});

describe('US3: LLM handles shell command failure gracefully', () => {
  itif(testConfig.enabled)(
    'should handle non-existent directory command without crashing',
    async () => {
      const shellTool = createShellTool(deps);
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llm: {
          providers: [
            {
              name: testConfig.provider,
              apiKey: testConfig.apiKey,
              baseUrl: testConfig.baseUrl,
              models: [{ modelId: testConfig.testModel }],
            },
          ],
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

      const lastMessage = finalState.context.messages[finalState.context.messages.length - 1];
      const responseText =
        typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

      const errorIndicators = ['error', 'failed', 'not found', 'no such', 'cannot access', 'exit'];
      const hasErrorIndicator = errorIndicators.some((indicator) =>
        responseText.toLowerCase().includes(indicator)
      );
      expect(hasErrorIndicator).toBe(true);

      const toolCalls = finalState.context.messages.flatMap((m) => m.toolCalls || []);
      const shellCalls = toolCalls.filter((tc) => tc.name === 'shell');
      expect(shellCalls.length).toBeGreaterThan(0);
    },
    120000
  );
});
