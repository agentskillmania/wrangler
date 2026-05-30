import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EnhancedRunner } from '../../../src/runner/enhanced-runner.js';
import type { EnhancedRunnerOptions } from '../../../src/runner/types.js';
import type { ILLMProvider, Tool } from '@agentskillmania/colts';

// Use a stable reference so each test can configure mockRun
const { mockRun, mockRunStream, mockOn } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockRunStream: vi.fn(),
  mockOn: vi.fn(),
}));

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
    ToolRegistry: vi.fn().mockImplementation(() => ({
      register: vi.fn(),
      execute: vi.fn().mockResolvedValue({}),
      toToolSchemas: vi.fn().mockReturnValue([]),
      has: vi.fn().mockReturnValue(false),
      getToolNames: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
    })),
    ConfirmableRegistry: vi.fn().mockImplementation((inner) => inner),
  };
});

vi.mock('../../../src/tools/mcp/index.js', () => ({
  loadMCPTools: vi.fn().mockResolvedValue([]),
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
Time: Tuesday, 05/13/2026, 10:06
Timezone: Asia/Shanghai
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
      searchProvider: 'bing' as never,
      sandbox: false,
      sessionBaseDir: testBaseDir,
      skillDirs: ['/skills/dir1', '/skills/dir2'],
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

  it('should create() defaults model to glm-5.1', async () => {
    await EnhancedRunner.create(makeOptions({ model: undefined }));

    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ model: 'glm-5.1' }));
  });

  it('should create() pass mcpConfigPaths to loadMCPTools', async () => {
    const { loadMCPTools } = await import('../../../src/tools/mcp/index.js');

    await EnhancedRunner.create(makeOptions({ mcpConfigPaths: ['/custom/mcp.json'] }));

    expect(loadMCPTools).toHaveBeenCalledWith({
      configPaths: ['/custom/mcp.json'],
    });
  });

  it('should create() default mcpConfigPaths to empty array', async () => {
    const { loadMCPTools } = await import('../../../src/tools/mcp/index.js');

    await EnhancedRunner.create(makeOptions());

    expect(loadMCPTools).toHaveBeenCalledWith({
      configPaths: [],
    });
  });

  it('should create() includes extraTools in tool list', async () => {
    const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');

    await EnhancedRunner.create(makeOptions());

    const calls = createBuiltinTools.mock.calls;
    expect(calls[calls.length - 1][0]).toEqual(
      expect.objectContaining({
        workspacePath: '/test/workspace',
      })
    );
    // searchProvider is resolved from 'bing' string to BingScrapeSearchProvider instance
    expect(calls[calls.length - 1][0].searchProvider).toBeInstanceOf(
      (await import('../../../src/tools/builtin/bing-scrape-search.js')).BingScrapeSearchProvider
    );

    const runnerCalls = await getAgentRunnerCalls();
    const runnerArgs = runnerCalls[runnerCalls.length - 1][0];

    // Check that extra tools are included
    expect(runnerArgs.tools).toContain(...mockExtraTools);
  });

  it('should create() sets systemPrompt to YAML frontmatter with Time: and Timezone:', async () => {
    await EnhancedRunner.create(makeOptions());

    const calls = await getAgentRunnerCalls();
    const callArgs = calls[calls.length - 1][0];

    expect(callArgs.systemPrompt).toContain('Time:');
    expect(callArgs.systemPrompt).toContain('Timezone:');
    expect(callArgs.systemPrompt).toContain('---');
    expect(callArgs.systemPrompt).not.toMatch(/You are/);
  });

  it('should create() passes skillDirs to AgentRunner (with built-in skills appended)', async () => {
    await EnhancedRunner.create(makeOptions({ skillDirs: ['/skills/dir1', '/skills/dir2'] }));

    const calls = await getAgentRunnerCalls();
    const skillDirs = calls[calls.length - 1][0].skillDirs;
    // User-provided dirs come first, followed by built-in spec-plan skills
    expect(skillDirs.slice(0, 2)).toEqual(['/skills/dir1', '/skills/dir2']);
    expect(skillDirs.length).toBeGreaterThanOrEqual(3);
    expect(skillDirs[2]).toContain('spec-plan');
  });

  it('should create() passes thinkingEnabled to AgentRunner', async () => {
    await EnhancedRunner.create(makeOptions({ thinkingEnabled: true }));

    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ thinkingEnabled: true }));
  });

  it('should pass requestTimeout to AgentRunner', async () => {
    await EnhancedRunner.create(makeOptions({ requestTimeout: 60000 }));
    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ requestTimeout: 60000 }));
  });

  it('should pass maxSteps to AgentRunner', async () => {
    await EnhancedRunner.create(makeOptions({ maxSteps: 30 }));
    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ maxSteps: 30 }));
  });

  it('should pass enablePromptThinking to AgentRunner', async () => {
    await EnhancedRunner.create(makeOptions({ enablePromptThinking: true }));
    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(
      expect.objectContaining({ enablePromptThinking: true })
    );
  });

  it('should not hardcode thinkingEnabled to true', async () => {
    await EnhancedRunner.create(makeOptions({ thinkingEnabled: false }));
    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ thinkingEnabled: false }));
  });

  it('should pass undefined thinkingEnabled when not set', async () => {
    const opts = makeOptions();
    delete opts.thinkingEnabled;
    await EnhancedRunner.create(opts);
    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(
      expect.objectContaining({ thinkingEnabled: undefined })
    );
  });

  it('should create() passes middleware array (length 2: session + todolist) to AgentRunner', async () => {
    await EnhancedRunner.create(makeOptions());

    const calls = await getAgentRunnerCalls();
    const callArgs = calls[calls.length - 1][0];

    expect(callArgs.middleware).toHaveLength(3);
    expect(callArgs.middleware[0].name).toBe('command');
    expect(callArgs.middleware[1].name).toBe('session');
    expect(callArgs.middleware[2].name).toBe('todolist');
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

  it('should run() pass per-request model and thinkingEnabled to inner runner', async () => {
    const mockState = { messages: [], steps: [] };
    const mockOptions = {
      maxSteps: 5,
      model: 'gpt-4o',
      thinkingEnabled: true,
      signal: new AbortController().signal,
    };

    const runner = await EnhancedRunner.create(makeOptions());
    mockRun.mockResolvedValue({
      state: mockState,
      result: { type: 'success', answer: 'test', totalSteps: 1 },
    });

    await runner.run(mockState, mockOptions);

    expect(mockRun).toHaveBeenCalledWith(mockState, mockOptions);
  });

  it('should runStream() pass per-request model and thinkingEnabled to inner runner', async () => {
    const mockState = { messages: [], steps: [] };
    const mockOptions = {
      maxSteps: 3,
      model: 'claude-3',
      thinkingEnabled: false,
    };

    const mockAsyncGenerator = (async function* () {
      yield { type: 'step', step: 1 };
    })();

    const runner = await EnhancedRunner.create(makeOptions());
    mockRunStream.mockReturnValue(mockAsyncGenerator);

    await runner.runStream(mockState, mockOptions);

    expect(mockRunStream).toHaveBeenCalledWith(mockState, mockOptions);
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

  // ── builtinTools toggle tests ──────────────────────────────────────

  it('should include all builtin tools when builtinTools is not provided', async () => {
    const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
    vi.mocked(createBuiltinTools).mockReturnValueOnce([
      { name: 'file_read' },
      { name: 'file_write' },
      { name: 'shell' },
    ]);

    await EnhancedRunner.create(makeOptions());

    const calls = await getAgentRunnerCalls();
    const tools = calls[calls.length - 1][0].tools;
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['file_read', 'file_write', 'shell']));
  });

  it('should exclude all builtin tools when builtinTools is empty object', async () => {
    const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
    vi.mocked(createBuiltinTools).mockReturnValueOnce([
      { name: 'file_read' },
      { name: 'shell' },
      { name: 'web_search' },
    ]);

    await EnhancedRunner.create(makeOptions({ builtinTools: {} }));

    const calls = await getAgentRunnerCalls();
    const tools = calls[calls.length - 1][0].tools;
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('file_read');
    expect(names).not.toContain('shell');
    expect(names).not.toContain('web_search');
  });

  it('should include only enabled tools when builtinTools has partial entries', async () => {
    const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
    vi.mocked(createBuiltinTools).mockReturnValueOnce([
      { name: 'file_read' },
      { name: 'file_write' },
      { name: 'shell' },
      { name: 'grep' },
    ]);

    await EnhancedRunner.create(
      makeOptions({
        builtinTools: { fileRead: true, fileWrite: true },
      })
    );

    const calls = await getAgentRunnerCalls();
    const tools = calls[calls.length - 1][0].tools;
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toContain('file_read');
    expect(names).toContain('file_write');
    expect(names).not.toContain('shell');
    expect(names).not.toContain('grep');
  });

  it('should treat builtinTools as whitelist: unlisted tools excluded, listed as false excluded', async () => {
    const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
    vi.mocked(createBuiltinTools).mockReturnValueOnce([{ name: 'file_read' }, { name: 'shell' }]);

    // shell: false → excluded; file_read not listed → also excluded
    await EnhancedRunner.create(makeOptions({ builtinTools: { shell: false } }));

    const calls = await getAgentRunnerCalls();
    const tools = calls[calls.length - 1][0].tools;
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('file_read');
    expect(names).not.toContain('shell');
  });

  it('should include listed tool and exclude unlisted when builtinTools is whitelist', async () => {
    const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
    vi.mocked(createBuiltinTools).mockReturnValueOnce([{ name: 'file_read' }, { name: 'shell' }]);

    await EnhancedRunner.create(makeOptions({ builtinTools: { fileRead: true } }));

    const calls = await getAgentRunnerCalls();
    const tools = calls[calls.length - 1][0].tools;
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toContain('file_read');
    expect(names).not.toContain('shell');
  });

  // ── enableSession / enableTodolist / enableCommands toggle tests ──

  it('should skip session support when enableSession is false', async () => {
    const { createSessionSupport } = await import('../../../src/session/support.js');
    vi.mocked(createSessionSupport).mockClear();

    await EnhancedRunner.create(makeOptions({ enableSession: false }));

    expect(createSessionSupport).not.toHaveBeenCalled();
  });

  it('should skip session tools and middleware when enableSession is false', async () => {
    await EnhancedRunner.create(makeOptions({ enableSession: false }));

    const calls = await getAgentRunnerCalls();
    const callArgs = calls[calls.length - 1][0];
    const middlewareNames = callArgs.middleware.map((m: { name: string }) => m.name);
    expect(middlewareNames).not.toContain('session');
  });

  it('should initialize session support when enableSession is not set', async () => {
    const { createSessionSupport } = await import('../../../src/session/support.js');
    vi.mocked(createSessionSupport).mockClear();

    await EnhancedRunner.create(makeOptions());

    expect(createSessionSupport).toHaveBeenCalled();
  });

  it('should skip todolist support when enableTodolist is false', async () => {
    const { createTodolistSupport } = await import('../../../src/todolist/support.js');
    vi.mocked(createTodolistSupport).mockClear();

    await EnhancedRunner.create(makeOptions({ enableTodolist: false }));

    expect(createTodolistSupport).not.toHaveBeenCalled();
  });

  it('should skip todolist middleware when enableTodolist is false', async () => {
    await EnhancedRunner.create(makeOptions({ enableTodolist: false }));

    const calls = await getAgentRunnerCalls();
    const callArgs = calls[calls.length - 1][0];
    const middlewareNames = callArgs.middleware.map((m: { name: string }) => m.name);
    expect(middlewareNames).not.toContain('todolist');
  });

  it('should skip command middleware when enableCommands is false', async () => {
    await EnhancedRunner.create(makeOptions({ enableCommands: false }));

    const calls = await getAgentRunnerCalls();
    const callArgs = calls[calls.length - 1][0];
    const middlewareNames = callArgs.middleware.map((m: { name: string }) => m.name);
    expect(middlewareNames).not.toContain('command');
  });

  it('should have only todolist middleware when session and commands are disabled', async () => {
    await EnhancedRunner.create(makeOptions({ enableSession: false, enableCommands: false }));

    const calls = await getAgentRunnerCalls();
    const callArgs = calls[calls.length - 1][0];
    const middlewareNames = callArgs.middleware.map((m: { name: string }) => m.name);
    expect(middlewareNames).toEqual(['todolist']);
  });

  // ── negative path tests ────────────────────────────────────────────────

  describe('negative paths', () => {
    it('should propagate error when AgentRunner.run throws', async () => {
      mockRun.mockRejectedValue(new Error('LLM provider timeout'));
      const runner = await EnhancedRunner.create(makeOptions());

      await expect(runner.run({} as any)).rejects.toThrow('LLM provider timeout');
    });

    it('should propagate error when AgentRunner.runStream yields error', async () => {
      mockRunStream.mockImplementation(() => {
        throw new Error('Stream init failed');
      });
      const runner = await EnhancedRunner.create(makeOptions());

      expect(() => runner.runStream({} as any)).toThrow('Stream init failed');
    });

    it('should propagate error result type from inner runner', async () => {
      mockRun.mockResolvedValue({
        state: {},
        result: { type: 'error', error: new Error('policy hard stop'), totalSteps: 500 },
      });
      const runner = await EnhancedRunner.create(makeOptions());

      const { result } = await runner.run({} as any);
      expect(result.type).toBe('error');
    });

    it('should handle create with no extraTools', async () => {
      const runner = await EnhancedRunner.create(makeOptions({ extraTools: undefined }));
      expect(runner).toBeInstanceOf(EnhancedRunner);

      const calls = await getAgentRunnerCalls();
      const tools = calls[calls.length - 1][0].tools;
      // extraTools is undefined → [...(options.extraTools ?? [])] produces []
      // Tools should not include 'mock-tool' since no extraTools were passed
      const names = tools.map((t: { name: string }) => t.name);
      expect(names).not.toContain('mock-tool');
    });

    it('should return same config snapshot on repeated calls', async () => {
      const runner = await EnhancedRunner.create(makeOptions());
      const config1 = runner.getConfig();
      const config2 = runner.getConfig();
      // Same object reference — config is a stable snapshot built at create() time
      expect(config1).toBe(config2);
    });

    it('should report correct tool counts in config', async () => {
      const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
      vi.mocked(createBuiltinTools).mockReturnValueOnce([
        { name: 'file_read' },
        { name: 'file_write' },
      ]);

      const runner = await EnhancedRunner.create(makeOptions());
      const config = runner.getConfig();

      // After filter (no builtinTools toggle → all included)
      // The mock returns 2 builtin tools for this call
      expect(config.builtinToolCount).toBeGreaterThanOrEqual(2);
      expect(config.mcpToolCount).toBe(0); // loadMCPTools mock returns []
    });

    it('should handle create with empty workspacePath (falls back to cwd)', async () => {
      const runner = await EnhancedRunner.create(
        makeOptions({ workspacePath: undefined })
      );
      expect(runner).toBeInstanceOf(EnhancedRunner);

      const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
      const calls = createBuiltinTools.mock.calls;
      // workspacePath defaults to process.cwd() when undefined
      expect(calls[calls.length - 1][0].workspacePath).toBe(process.cwd());
    });

    it('should not include session/todolist middleware when both disabled', async () => {
      const runner = await EnhancedRunner.create(
        makeOptions({ enableSession: false, enableTodolist: false, enableCommands: false })
      );
      const config = runner.getConfig();
      expect(config.middlewareNames).toEqual([]);
      expect(config.enableSession).toBe(false);
      expect(config.enableTodolist).toBe(false);
    });
  });

  // ── getConfig() observability tests ──────────────────────────────────

  describe('getConfig()', () => {
    it('returns model from options', async () => {
      const runner = await EnhancedRunner.create(makeOptions({ model: 'test-model-42' }));
      expect(runner.getConfig().model).toBe('test-model-42');
    });

    it('returns sandbox=false when not configured', async () => {
      const runner = await EnhancedRunner.create(makeOptions({ sandbox: false }));
      expect(runner.getConfig().sandbox).toBe(false);
    });

    it('returns sandbox=true when configured', async () => {
      // Mock the dynamic import so we don't need a real sandbox runtime
      vi.doMock('@agentskillmania/sandbox', () => ({
        Sandbox: vi.fn().mockImplementation(() => ({})),
      }));
      const runner = await EnhancedRunner.create(makeOptions({ sandbox: true }));
      expect(runner.getConfig().sandbox).toBe(true);
    });

    it('reports tool counts', async () => {
      const runner = await EnhancedRunner.create(makeOptions());
      const config = runner.getConfig();
      expect(config.builtinToolCount).toBeGreaterThanOrEqual(0);
      expect(config.mcpToolCount).toBe(0);
      expect(config.sessionToolCount).toBeGreaterThanOrEqual(0);
      expect(config.todolistToolCount).toBeGreaterThanOrEqual(0);
    });

    it('includes middleware names', async () => {
      const runner = await EnhancedRunner.create(makeOptions());
      const config = runner.getConfig();
      expect(config.middlewareNames).toContain('session');
      expect(config.middlewareNames).toContain('todolist');
    });

    it('returns enableSession=false and excludes session from middlewareNames', async () => {
      const runner = await EnhancedRunner.create(makeOptions({ enableSession: false }));
      const config = runner.getConfig();
      expect(config.enableSession).toBe(false);
      expect(config.middlewareNames).not.toContain('session');
    });

    it('returns enableTodolist=false and excludes todolist from middlewareNames', async () => {
      const runner = await EnhancedRunner.create(makeOptions({ enableTodolist: false }));
      const config = runner.getConfig();
      expect(config.enableTodolist).toBe(false);
      expect(config.middlewareNames).not.toContain('todolist');
    });

    it('returns thinkingEnabled reflecting the option (true)', async () => {
      const runner = await EnhancedRunner.create(makeOptions({ thinkingEnabled: true }));
      expect(runner.getConfig().thinkingEnabled).toBe(true);
    });

    it('returns thinkingEnabled reflecting the option (false)', async () => {
      const runner = await EnhancedRunner.create(makeOptions({ thinkingEnabled: false }));
      expect(runner.getConfig().thinkingEnabled).toBe(false);
    });

    it('returns compressorEnabled=false when no compression configured', async () => {
      const runner = await EnhancedRunner.create(makeOptions());
      expect(runner.getConfig().compressorEnabled).toBe(false);
    });

    it('returns frozen snapshot (same object reference on repeated calls)', async () => {
      const runner = await EnhancedRunner.create(makeOptions());
      const first = runner.getConfig();
      const second = runner.getConfig();
      expect(first).toBe(second);
    });
  });
});
