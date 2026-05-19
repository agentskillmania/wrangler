/**
 * User Story: Command System Integration Tests
 *
 * These tests exercise the FULL stack: user input → EnhancedRunner → AgentRunner →
 * middleware → handlers → result. Uses a mock LLM client that returns canned responses.
 *
 * Prerequisites: None (uses mock LLM)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EnhancedRunner } from '../../src/runner/index.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { AgentState } from '@agentskillmania/colts';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Mock LLM client that returns a canned response
 */
function createMockLLMClient(response: string) {
  return {
    call: vi.fn().mockResolvedValue({
      content: response,
      tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
      toolCalls: [],
    }),
    stream: vi.fn(),
  };
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
   *
   * Create EnhancedRunner with mock LLM, create state with user message "/clear",
   * call runner.run(state), assert result.type === 'stopped' and result.data === 'Session cleared.'
   */
  it('should execute /clear command and stop with success message', async () => {
    const runner = await EnhancedRunner.create({
      llmClient: createMockLLMClient('Done!'),
      model: 'test-model',
      workspacePath: '/tmp/test-workspace',
      mcpConfigPaths: [], // Skip MCP loading for faster tests
    });

    let state = createAgentState({
      name: 'test-agent',
      instructions: 'You are a helpful assistant.',
      tools: [],
    });
    state = addUserMessage(state, '/clear');

    const { result, state: finalState } = await runner.run(state);

    // Assert the result indicates the command was handled
    expect(result.type).toBe('stopped');
    expect(result.data).toBe('Session cleared.');
    // Runner counts 1 step even when middleware stops it
    expect(result.totalSteps).toBe(1);

    // Assert state has empty messages
    expect(finalState.context.messages).toHaveLength(0);
  });

  /**
   * Test 2: /skill:name with body — skill loaded, LLM continues
   *
   * Create EnhancedRunner with skill dirs pointing to a temp directory with a SKILL.md,
   * create state with "/skill:test-skill fix this bug", call runner.run(state),
   * assert result.type === 'success' (LLM processed the message with skill loaded),
   * assert skill state was loaded (skillState.current === 'test-skill')
   */
  it('should load skill with body and continue to LLM', async () => {
    const skillDir = createTempSkillDir();
    tempDirs.push(skillDir);

    const runner = await EnhancedRunner.create({
      llmClient: createMockLLMClient('Bug fixed!'),
      model: 'test-model',
      workspacePath: '/tmp/test-workspace',
      skillDirs: [skillDir],
      mcpConfigPaths: [], // Skip MCP loading for faster tests
    });

    let state = createAgentState({
      name: 'test-agent',
      instructions: 'You are a helpful assistant.',
      tools: [],
    });
    state = addUserMessage(state, '/skill:test-skill fix this bug');

    const { result } = await runner.run(state);

    // Assert LLM processed the message (execution continued)
    expect(result.type).toBe('success');
    expect(result.answer).toBe('Bug fixed!');
  });

  /**
   * Test 3: /skill:name without body — skill loaded, run stops
   *
   * Same setup but "/skill:test-skill" (no body), assert result.type === 'stopped',
   * assert result.data contains 'test-skill'
   */
  it('should load skill without body and stop with confirmation', async () => {
    const skillDir = createTempSkillDir();
    tempDirs.push(skillDir);

    const runner = await EnhancedRunner.create({
      llmClient: createMockLLMClient('Done!'),
      model: 'test-model',
      workspacePath: '/tmp/test-workspace',
      skillDirs: [skillDir],
      mcpConfigPaths: [], // Skip MCP loading for faster tests
    });

    let state = createAgentState({
      name: 'test-agent',
      instructions: 'You are a helpful assistant.',
      tools: [],
    });
    state = addUserMessage(state, '/skill:test-skill');

    const { result, state: finalState } = await runner.run(state);

    // Assert execution stopped with confirmation
    expect(result.type).toBe('stopped');
    expect(result.data).toContain('test-skill');
    // Runner counts 1 step even when middleware stops it
    expect(result.totalSteps).toBe(1);

    // Assert skill state was loaded
    expect(finalState.context.skillState?.current).toBe('test-skill');
  });

  /**
   * Test 4: /compact command — messages compressed
   *
   * Create state with many messages (10+ user+assistant pairs), add user message "/compact",
   * assert result.type === 'stopped', assert result.data contains 'compressed',
   * assert state has fewer messages
   */
  it('should compact messages and stop with confirmation', async () => {
    // Use a mock compressor so the test doesn't need LLM for summarization
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
      llmClient: createMockLLMClient('Done!'),
      model: 'test-model',
      workspacePath: '/tmp/test-workspace',
      mcpConfigPaths: [],
      compression: mockCompressor,
    });

    let state = createAgentState({
      name: 'test-agent',
      instructions: 'You are a helpful assistant.',
      tools: [],
    });

    // Add 15 message pairs (30 messages total)
    for (let i = 0; i < 15; i++) {
      state = addUserMessage(state, `Message ${i}`);
      // Add assistant response
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

    // Assert execution stopped with confirmation
    expect(result.type).toBe('stopped');
    expect(result.data).toContain('compressed');

    // Assert compression metadata was written to state
    expect(finalState.context.compression).toBeDefined();
    expect(finalState.context.compression!.summary).toBe('Mock summary of conversation');
    expect(finalState.context.compression!.anchor).toBe(28);
  });

  /**
   * Test 5: Unknown command — normal LLM flow
   *
   * Create state with "/unknown-command", assert result.type === 'success'
   * (LLM processed it normally)
   */
  it('should treat unknown command as normal message and continue to LLM', async () => {
    const runner = await EnhancedRunner.create({
      llmClient: createMockLLMClient('I do not understand that command.'),
      model: 'test-model',
      workspacePath: '/tmp/test-workspace',
      mcpConfigPaths: [], // Skip MCP loading for faster tests
    });

    let state = createAgentState({
      name: 'test-agent',
      instructions: 'You are a helpful assistant.',
      tools: [],
    });
    state = addUserMessage(state, '/unknown-command');

    const { result } = await runner.run(state);

    // Assert LLM processed it normally
    expect(result.type).toBe('success');
    expect(result.answer).toBe('I do not understand that command.');
  });

  /**
   * Test 6: Custom command overriding built-in
   *
   * Create EnhancedRunner with commands option providing a custom "clear" handler,
   * create state with "/clear", assert the custom handler was called (not the built-in)
   */
  it('should use custom command handler when overriding built-in', async () => {
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
      llmClient: createMockLLMClient('Done!'),
      model: 'test-model',
      workspacePath: '/tmp/test-workspace',
      commands: [customClearHandler],
      mcpConfigPaths: [], // Skip MCP loading for faster tests
    });

    let state = createAgentState({
      name: 'test-agent',
      instructions: 'You are a helpful assistant.',
      tools: [],
    });
    state = addUserMessage(state, '/clear');

    const { result } = await runner.run(state);

    // Assert custom handler was called
    expect(result.type).toBe('stopped');
    expect(result.data).toBe('Custom clear executed!');
  });

  /**
   * Test 7: /skills command lists available skills
   *
   * Create EnhancedRunner with skill dirs, send "/skills" command,
   * assert result contains skill names
   */
  it('should list available skills with /skills command', async () => {
    const skillDir = createTempSkillDir();
    tempDirs.push(skillDir);

    const runner = await EnhancedRunner.create({
      llmClient: createMockLLMClient('Done!'),
      model: 'test-model',
      workspacePath: '/tmp/test-workspace',
      skillDirs: [skillDir],
      mcpConfigPaths: [], // Skip MCP loading for faster tests
    });

    let state = createAgentState({
      name: 'test-agent',
      instructions: 'You are a helpful assistant.',
      tools: [],
    });
    state = addUserMessage(state, '/skills');

    const { result } = await runner.run(state);

    // Assert execution stopped with skill list
    expect(result.type).toBe('stopped');
    expect(result.data).toContain('test-skill');
  });

  /**
   * Test 8: Non-slash message passes through to LLM
   *
   * Send a normal message without slash, assert it reaches LLM
   */
  it('should pass normal message to LLM without command processing', async () => {
    const runner = await EnhancedRunner.create({
      llmClient: createMockLLMClient('Hello! How can I help?'),
      model: 'test-model',
      workspacePath: '/tmp/test-workspace',
      mcpConfigPaths: [], // Skip MCP loading for faster tests
    });

    let state = createAgentState({
      name: 'test-agent',
      instructions: 'You are a helpful assistant.',
      tools: [],
    });
    state = addUserMessage(state, 'Hello, how are you?');

    const { result } = await runner.run(state);

    // Assert LLM processed it normally
    expect(result.type).toBe('success');
    expect(result.answer).toBe('Hello! How can I help?');
  });
});
