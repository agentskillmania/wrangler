/**
 * User Story: Command System Integration Tests
 *
 * These tests exercise the FULL stack: user input → EnhancedRunner → AgentRunner →
 * middleware → handlers → result, with a real LLM.
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { defaultNodeHostEnv } from '../../src/host-env/node-host-env.js';
import { EnhancedRunner } from '../../src/runner/index.js';
import { createAgentState, addUserMessage, FilesystemSkillProvider } from '@agentskillmania/colts';
import { nodeFsOps } from '@agentskillmania/colts/skills/node-fs-ops';
import type { AgentState } from '@agentskillmania/colts';
import { createLLMClient } from '../../src/llm/client.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

/**
 * Create a temp skill directory with a SKILL.md
 */
function createTempSkillDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wrangler-intg-'));
  const skillDir = join(dir, 'test-skill');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: test-skill
description: A test skill
---
Test skill instructions.`
  );
  return dir;
}

describe('Command System Integration Tests', () => {
  let tempDirs: string[];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Test 1: /clear command full pipeline
   */
  itif(testConfig.enabled)(
    'should execute /clear command and stop with success message',
    async () => {
      const runner = await EnhancedRunner.create({
        runtime: defaultNodeHostEnv,
        llm: { client: makeLLMClient() as any, model: testConfig.testModel },
        workspacePath: '/tmp/test-workspace',
        mcpConfigPaths: [],
      });

      let state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a helpful assistant.',
        tools: [],
      });
      state = addUserMessage(state, '/clear');

      const { result, state: finalState } = await runner.run(state);

      expect(result.type).toBe('stopped');
      expect(result.data).toBe('Session cleared.');
      expect(result.totalSteps).toBe(1);
      expect(finalState.context.messages).toHaveLength(0);
    },
    120000
  );

  /**
   * Test 2: /skill:name with body — skill loaded, LLM continues
   */
  itif(testConfig.enabled)(
    'should load skill with body and continue to LLM',
    async () => {
      const skillDir = createTempSkillDir();
      tempDirs.push(skillDir);

      const runner = await EnhancedRunner.create({
        runtime: defaultNodeHostEnv,
        llm: { client: makeLLMClient() as any, model: testConfig.testModel },
        workspacePath: '/tmp/test-workspace',
        skills: {
          dirs: [skillDir],
          // 宿主职责：Node 测试环境显式注入 provider（引擎 core 不构造技能后端）
          provider: new FilesystemSkillProvider([skillDir], nodeFsOps),
        },
        mcpConfigPaths: [],
      });

      let state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a helpful assistant.',
        tools: [],
      });
      state = addUserMessage(state, '/skill:test-skill fix this bug');

      const { result } = await runner.run(state);

      expect(result.type).toBe('success');
      expect(result.answer).toBeTruthy();
    },
    120000
  );

  /**
   * Test 3: /skill:name without body — skill loaded, run stops
   */
  itif(testConfig.enabled)(
    'should load skill without body and stop with confirmation',
    async () => {
      const skillDir = createTempSkillDir();
      tempDirs.push(skillDir);

      const runner = await EnhancedRunner.create({
        runtime: defaultNodeHostEnv,
        llm: { client: makeLLMClient() as any, model: testConfig.testModel },
        workspacePath: '/tmp/test-workspace',
        skills: {
          dirs: [skillDir],
          // 宿主职责：Node 测试环境显式注入 provider（引擎 core 不构造技能后端）
          provider: new FilesystemSkillProvider([skillDir], nodeFsOps),
        },
        mcpConfigPaths: [],
      });

      let state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a helpful assistant.',
        tools: [],
      });
      state = addUserMessage(state, '/skill:test-skill');

      const { result, state: finalState } = await runner.run(state);

      expect(result.type).toBe('stopped');
      expect(result.data).toContain('test-skill');
      expect(finalState.context.skillState?.current).toBe('test-skill');
    },
    120000
  );

  /**
   * Test 4: /compact command — messages compressed
   */
  itif(testConfig.enabled)(
    'should compact messages and stop with confirmation',
    async () => {
      const mockCompressor = {
        shouldCompress: () => true,
        compress: async () => ({
          summary: 'Mock summary of conversation',
          anchor: 28,
          removedTokenCount: 500,
          compressedAt: Date.now(),
        }),
      };

      const runner = await EnhancedRunner.create({
        runtime: defaultNodeHostEnv,
        llm: { client: makeLLMClient() as any, model: testConfig.testModel },
        workspacePath: '/tmp/test-workspace',
        mcpConfigPaths: [],
        compression: mockCompressor,
      });

      let state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a helpful assistant.',
        tools: [],
      });

      for (let i = 0; i < 15; i++) {
        state = addUserMessage(state, `Message ${i}`);
        state = {
          ...state,
          context: {
            ...state.context,
            messages: [
              ...state.context.messages,
              {
                role: 'assistant',
                type: 'text',
                content: `Response ${i}`,
                timestamp: Date.now(),
              },
            ],
          },
        };
      }

      state = addUserMessage(state, '/compact');

      const { result, state: finalState } = await runner.run(state);

      expect(result.type).toBe('stopped');
      expect(result.data).toContain('compressed');
      expect(finalState.context.compression).toHaveProperty('removedTokenCount');
    },
    120000
  );

  /**
   * Test 5: Unknown command — normal LLM flow
   */
  itif(testConfig.enabled)(
    'should treat unknown command as normal message and continue to LLM',
    async () => {
      const runner = await EnhancedRunner.create({
        runtime: defaultNodeHostEnv,
        llm: { client: makeLLMClient() as any, model: testConfig.testModel },
        workspacePath: '/tmp/test-workspace',
        mcpConfigPaths: [],
      });

      let state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a helpful assistant.',
        tools: [],
      });
      state = addUserMessage(state, '/unknown-command');

      const { result } = await runner.run(state);

      expect(result.type).toBe('success');
      expect(result.answer).toBeTruthy();
    },
    120000
  );

  /**
   * Test 6: Custom command overriding built-in
   */
  itif(testConfig.enabled)(
    'should use custom command handler when overriding built-in',
    async () => {
      const customClearHandler = {
        name: 'clear',
        description: 'Custom clear handler',
        async handle(ctx: {
          command: { name: string; target?: string; body: string };
          state: AgentState;
        }) {
          return {
            handled: true,
            response: 'Custom clear executed!',
          };
        },
      };

      const runner = await EnhancedRunner.create({
        runtime: defaultNodeHostEnv,
        llm: { client: makeLLMClient() as any, model: testConfig.testModel },
        workspacePath: '/tmp/test-workspace',
        commands: { enabled: true, extra: [customClearHandler] },
        mcpConfigPaths: [],
      });

      let state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a helpful assistant.',
        tools: [],
      });
      state = addUserMessage(state, '/clear');

      const { result } = await runner.run(state);

      expect(result.type).toBe('stopped');
      expect(result.data).toBe('Custom clear executed!');
    },
    120000
  );

  /**
   * Test 7: /skills command lists available skills
   */
  itif(testConfig.enabled)(
    'should list available skills with /skills command',
    async () => {
      const skillDir = createTempSkillDir();
      tempDirs.push(skillDir);

      const runner = await EnhancedRunner.create({
        runtime: defaultNodeHostEnv,
        llm: { client: makeLLMClient() as any, model: testConfig.testModel },
        workspacePath: '/tmp/test-workspace',
        skills: {
          dirs: [skillDir],
          // 宿主职责：Node 测试环境显式注入 provider（引擎 core 不构造技能后端）
          provider: new FilesystemSkillProvider([skillDir], nodeFsOps),
        },
        mcpConfigPaths: [],
      });

      let state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a helpful assistant.',
        tools: [],
      });
      state = addUserMessage(state, '/skills');

      const { result } = await runner.run(state);

      expect(result.type).toBe('stopped');
      expect(result.data).toContain('test-skill');
    },
    120000
  );

  /**
   * Test 8: Non-slash message passes through to LLM
   */
  itif(testConfig.enabled)(
    'should pass normal message to LLM without command processing',
    async () => {
      const runner = await EnhancedRunner.create({
        runtime: defaultNodeHostEnv,
        llm: { client: makeLLMClient() as any, model: testConfig.testModel },
        workspacePath: '/tmp/test-workspace',
        mcpConfigPaths: [],
      });

      let state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a helpful assistant.',
        tools: [],
      });
      state = addUserMessage(state, 'Hello, how are you?');

      const { result } = await runner.run(state);

      expect(result.type).toBe('success');
      expect(result.answer).toBeTruthy();
    },
    120000
  );
});
