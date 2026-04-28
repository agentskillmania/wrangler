import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRunner } from '../../src/create-runner.js';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { ILLMProvider } from '@agentskillmania/colts';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function createMockLLMProvider(response: string = 'test response'): ILLMProvider {
  return {
    call: vi.fn().mockResolvedValue({
      content: response,
      tokens: { input: 10, output: 20 },
    }),
    stream: vi.fn(),
  };
}

describe('createRunner', () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-test-factory-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should throw when neither llmClient nor apiKey is provided', () => {
    expect(() =>
      createRunner({
        workspacePath: '/test',
        model: 'test-model',
        llm: {},
        agentConfig: { name: 'test', instructions: 'test', tools: [] },
        sessionBaseDir: testBaseDir,
      })
    ).toThrow();
  });

  it('should return an AgentRunner instance', () => {
    const runner = createRunner({
      workspacePath: '/test',
      model: 'test-model',
      llm: { llmClient: createMockLLMProvider() },
      agentConfig: { name: 'test', instructions: 'test', tools: [] },
      sessionBaseDir: testBaseDir,
    });
    expect(runner).toBeInstanceOf(AgentRunner);
  });

  it('should register ask_human tool when handler provided', () => {
    const handler = vi.fn().mockResolvedValue({ response: 'ok' });
    const runner = createRunner({
      workspacePath: '/test',
      model: 'test-model',
      llm: { llmClient: createMockLLMProvider() },
      agentConfig: { name: 'test', instructions: 'test', tools: [] },
      askHumanHandler: handler as any,
      sessionBaseDir: testBaseDir,
    });
    expect(runner).toBeDefined();
  });

  it('should inject session middleware', async () => {
    const mockProvider = createMockLLMProvider('Done.');
    const runner = createRunner({
      workspacePath: '/test',
      model: 'test-model',
      llm: { llmClient: mockProvider },
      agentConfig: { name: 'test', instructions: 'test', tools: [] },
      sessionBaseDir: testBaseDir,
    });

    let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
    state = addUserMessage(state, 'Hello');

    await runner.run(state);

    const entries = await readdir(testBaseDir, { recursive: true });
    const hasSession = (entries as string[]).some((e) => (e as string).includes('meta.yaml'));
    expect(hasSession).toBe(true);
  });
});
