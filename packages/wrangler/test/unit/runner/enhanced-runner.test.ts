import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EnhancedRunner } from '../../../src/runner/enhanced-runner.js';
import type { EnhancedRunnerOptions } from '../../../src/runner/types.js';
import type { ILLMProvider, Tool } from '@agentskillmania/colts';

// Use a stable reference so each test can configure mockRun
const mockRun = vi.fn();
const mockRunStream = vi.fn();
const mockOn = vi.fn();

vi.mock('@agentskillmania/colts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/colts')>();
  return {
    ...actual,
    AgentRunner: vi.fn().mockImplementation((options) => ({
      run: mockRun,
      runStream: mockRunStream,
      on: mockOn,
      ...options,
    })),
    createAgentState: actual.createAgentState,
    addUserMessage: actual.addUserMessage,
  };
});

vi.mock('../../../src/tools/mcp/index.js', () => ({
  loadMCPTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

vi.mock('../../../src/tools/mcp/config-merger.js', () => ({
  discoverGlobalConfigPath: vi.fn().mockReturnValue('/fake/global/mcporter.json'),
}));

vi.mock('../../../src/tools/builtin/index.js', () => ({
  createBuiltinTools: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../src/session/support.js', () => ({
  createSessionSupport: vi.fn().mockReturnValue({
    tools: [],
    middleware: { name: 'session' },
  }),
}));

vi.mock('../../../src/todolist/support.js', () => ({
  createTodolistSupport: vi.fn().mockReturnValue({
    tools: [],
    middleware: { name: 'todolist' },
  }),
}));

vi.mock('../../../src/runner/system-prompt.js', () => ({
  buildTimeContext: vi.fn().mockReturnValue(`---
时间: 2026年05月13日 星期二 10:06
时区: Asia/Shanghai
---`),
}));

describe('EnhancedRunner', () => {
  let testBaseDir: string;
  const mockLLMClient: ILLMProvider = {} as any;
  const mockExtraTools: Tool<any>[] = [{ name: 'mock-tool', schema: {} as any, execute: vi.fn() }];

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-test-enhanced-runner-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
    mockRun.mockReset();
    mockRunStream.mockReset();
    mockOn.mockReset();

    // Default: return success
    mockRun.mockResolvedValue({
      state: {},
      result: { type: 'success', answer: 'ok', totalSteps: 1 },
    });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  function makeOptions(overrides?: Partial<EnhancedRunnerOptions>): EnhancedRunnerOptions {
    return {
      llmClient: mockLLMClient,
      model: 'gpt-4',
      workspacePath: '/test/workspace',
      extraTools: mockExtraTools,
      searchProvider: 'bing' as any,
      sandbox: {} as any,
      sessionBaseDir: testBaseDir,
      skillDirectories: ['/skills/dir1', '/skills/dir2'],
      askHumanHandler: vi.fn(),
      thinkingEnabled: true,
      ...overrides,
    };
  }

  async function getAgentRunnerCalls() {
    const { AgentRunner } = await import('@agentskillmania/colts');
    return (AgentRunner as any).mock.calls;
  }

  it('should create() return EnhancedRunner instance', async () => {
    const runner = await EnhancedRunner.create(makeOptions());
    expect(runner).toBeInstanceOf(EnhancedRunner);
  });

  it('should create() pass correct model to AgentRunner', async () => {
    await EnhancedRunner.create(makeOptions({ model: 'claude-3' }));

    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ model: 'claude-3' }));
  });

  it('should create() defaults model to gpt-4', async () => {
    await EnhancedRunner.create(makeOptions({ model: undefined }));

    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ model: 'gpt-4' }));
  });

  it('should create() loads MCP tools via loadMCPTools', async () => {
    const { loadMCPTools } = await import('../../../src/tools/mcp/index.js');

    await EnhancedRunner.create(makeOptions());

    expect(loadMCPTools).toHaveBeenCalledWith({
      configPaths: ['/fake/global/mcporter.json', '/test/workspace/mcp.json'],
    });
  });

  it('should create() includes extraTools in tool list', async () => {
    const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');

    await EnhancedRunner.create(makeOptions());

    const calls = createBuiltinTools.mock.calls;
    expect(calls[calls.length - 1][0]).toEqual(
      expect.objectContaining({
        workspacePath: '/test/workspace',
        searchProvider: 'bing',
        sandbox: expect.any(Object),
      })
    );

    const runnerCalls = await getAgentRunnerCalls();
    const runnerArgs = runnerCalls[runnerCalls.length - 1][0];

    // Check that extra tools are included
    expect(runnerArgs.tools).toContain(...mockExtraTools);
  });

  it('should create() sets systemPrompt to YAML frontmatter with 时间: and 时区:', async () => {
    await EnhancedRunner.create(makeOptions());

    const calls = await getAgentRunnerCalls();
    const callArgs = calls[calls.length - 1][0];

    expect(callArgs.systemPrompt).toContain('时间:');
    expect(callArgs.systemPrompt).toContain('时区:');
    expect(callArgs.systemPrompt).toContain('---');
    expect(callArgs.systemPrompt).not.toMatch(/You are/);
  });

  it('should create() passes skillDirectories to AgentRunner', async () => {
    await EnhancedRunner.create(
      makeOptions({ skillDirectories: ['/skills/dir1', '/skills/dir2'] })
    );

    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(
      expect.objectContaining({
        skillDirectories: ['/skills/dir1', '/skills/dir2'],
      })
    );
  });

  it('should create() passes thinkingEnabled to AgentRunner', async () => {
    await EnhancedRunner.create(makeOptions({ thinkingEnabled: true }));

    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ thinkingEnabled: true }));
  });

  it('should create() passes middleware array (length 2: session + todolist) to AgentRunner', async () => {
    await EnhancedRunner.create(makeOptions());

    const calls = await getAgentRunnerCalls();
    const callArgs = calls[calls.length - 1][0];

    expect(callArgs.middleware).toHaveLength(2);
    expect(callArgs.middleware[0].name).toBe('session');
    expect(callArgs.middleware[1].name).toBe('todolist');
  });

  it('should run() delegate to inner runner with correct args', async () => {
    const mockState = { messages: [], steps: [] };
    const mockOptions = { maxSteps: 10 };

    const runner = await EnhancedRunner.create(makeOptions());
    mockRun.mockResolvedValue({
      state: mockState,
      result: { type: 'success', answer: 'test', totalSteps: 1 },
    });

    await runner.run(mockState, mockOptions);

    expect(mockRun).toHaveBeenCalledWith(mockState, mockOptions);
  });

  it('should run() passes options through', async () => {
    const mockState = { messages: [], steps: [] };
    const mockOptions = { maxSteps: 10, signal: new AbortController().signal };

    const runner = await EnhancedRunner.create(makeOptions());
    mockRun.mockResolvedValue({
      state: mockState,
      result: { type: 'success', answer: 'test', totalSteps: 1 },
    });

    await runner.run(mockState, mockOptions);

    expect(mockRun).toHaveBeenCalledWith(mockState, mockOptions);
  });

  it('should on() delegate and return this for chaining', async () => {
    const mockHandler = vi.fn();

    const runner = await EnhancedRunner.create(makeOptions());

    const result = runner.on('test-event', mockHandler);

    expect(mockOn).toHaveBeenCalledWith('test-event', mockHandler);
    expect(result).toBe(runner); // Should return this for chaining
  });

  it('should runStream() delegate to inner runner with correct args', async () => {
    const mockState = { messages: [], steps: [] };
    const mockOptions = { maxSteps: 10 };

    const mockAsyncGenerator = (async function* () {
      yield { type: 'step', step: 1 };
      yield { type: 'completed', result: 'done' };
    })();

    const runner = await EnhancedRunner.create(makeOptions());
    mockRunStream.mockReturnValue(mockAsyncGenerator);

    const result = await runner.runStream(mockState, mockOptions);

    expect(mockRunStream).toHaveBeenCalledWith(mockState, mockOptions);
    expect(result).toBe(mockAsyncGenerator);
  });
});
