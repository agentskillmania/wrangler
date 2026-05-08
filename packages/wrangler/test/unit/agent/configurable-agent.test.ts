import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigurableAgent } from '../../../src/agent/configurable-agent.js';
import type { AgentDefinition, ConfigurableAgentOptions } from '../../../src/agent/types.js';
import type { RunResult } from '@agentskillmania/colts';

// Use a stable reference so each test can configure mockRun
const mockRun = vi.fn();

vi.mock('@agentskillmania/colts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/colts')>();
  return {
    ...actual,
    AgentRunner: vi.fn().mockImplementation(() => ({
      run: mockRun,
    })),
    createAgentState: actual.createAgentState,
    addUserMessage: actual.addUserMessage,
  };
});

const mockAgentDef: AgentDefinition = {
  meta: {
    name: 'test-agent',
    description: 'A test agent',
    skills: ['testing'],
    thinking: { enabled: true },
  },
  instructions: 'You are a test agent.',
};

describe('ConfigurableAgent', () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-test-agent-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
    mockRun.mockReset();
    // Default: return success
    mockRun.mockResolvedValue({
      state: {},
      result: { type: 'success', answer: 'ok', totalSteps: 1 },
    });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  function makeOptions(overrides?: Partial<ConfigurableAgentOptions>): ConfigurableAgentOptions {
    return {
      llmClient: {} as any,
      defaultModel: 'test-model',
      sessionBaseDir: testBaseDir,
      ...overrides,
    };
  }

  async function getAgentRunnerCalls() {
    const { AgentRunner } = await import('@agentskillmania/colts');
    return (AgentRunner as any).mock.calls;
  }

  it('should return answer on successful run', async () => {
    mockRun.mockResolvedValue({
      state: {},
      result: { type: 'success', answer: 'The answer is 42.', totalSteps: 1 },
    });

    const agent = new ConfigurableAgent(mockAgentDef, '/test/workspace', makeOptions());
    const result = await agent.run('What is the answer?');

    expect(result).toBe('The answer is 42.');
  });

  it('should return error message on error run result', async () => {
    mockRun.mockResolvedValue({
      state: {},
      result: { type: 'error', error: new Error('LLM API failed'), totalSteps: 0 },
    });

    const agent = new ConfigurableAgent(mockAgentDef, '/test/workspace', makeOptions());
    const result = await agent.run('Hello');

    expect(result).toBe('Error: LLM API failed');
  });

  it('should handle max_steps result', async () => {
    mockRun.mockResolvedValue({
      state: {},
      result: { type: 'max_steps', totalSteps: 10 },
    });

    const agent = new ConfigurableAgent(mockAgentDef, '/test/workspace', makeOptions());
    const result = await agent.run('Complex task');

    expect(result).toBe('Error: run ended with max_steps');
  });

  it('should use defaultModel from options', async () => {
    const agent = new ConfigurableAgent(
      mockAgentDef,
      '/test/workspace',
      makeOptions({ defaultModel: 'custom-model' })
    );
    await agent.run('test');

    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ model: 'custom-model' }));
  });

  it('should fall back to gpt-4 when no defaultModel provided', async () => {
    const agent = new ConfigurableAgent(mockAgentDef, '/test/workspace', {
      llmClient: {} as any,
      sessionBaseDir: testBaseDir,
    });
    await agent.run('test');

    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ model: 'gpt-4' }));
  });

  it('should pass thinking config to AgentRunner', async () => {
    const agent = new ConfigurableAgent(mockAgentDef, '/test/workspace', makeOptions());
    await agent.run('test');

    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ thinkingEnabled: true }));
  });

  it('should pass skill directories to AgentRunner', async () => {
    const agent = new ConfigurableAgent(
      mockAgentDef,
      '/test/workspace',
      makeOptions({ skillDirectories: ['/skills/dir1', '/skills/dir2'] })
    );
    await agent.run('test');

    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(
      expect.objectContaining({ skillDirectories: ['/skills/dir1', '/skills/dir2'] })
    );
  });

  it('should pass session middleware to AgentRunner', async () => {
    const agent = new ConfigurableAgent(mockAgentDef, '/test/workspace', makeOptions());
    await agent.run('test');

    const calls = await getAgentRunnerCalls();
    const callArgs = calls[calls.length - 1][0];
    expect(callArgs.middleware).toBeDefined();
    expect(callArgs.middleware).toHaveLength(1);
    expect(callArgs.middleware[0].name).toBe('session');
  });
});
