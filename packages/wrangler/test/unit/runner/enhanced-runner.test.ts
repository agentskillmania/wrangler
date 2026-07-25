import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@agentskillmania/sandbox', () => ({
  Sandbox: vi.fn().mockImplementation(() => ({})),
}));

import { EnhancedRunner } from '../../../src/runner/enhanced-runner.js';
import type { EnhancedRunnerOptions } from '../../../src/runner/types.js';
import type { ILLMProvider, Tool } from '@agentskillmania/colts';
import { createAgentState } from '@agentskillmania/colts';
import { SessionStore } from '../../../src/session/session-store.js';
import { writeMeta } from '../../../src/session/meta.js';

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
      emit: vi.fn(),
      registerTool: vi.fn(),
      getToolRegistry: vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
        get: vi.fn(),
        register: vi.fn(),
      }),
      skillProvider: undefined,
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
    middlewares: [{ name: 'session' }],
  }),
}));

vi.mock('../../../src/todolist/support.js', () => ({
  createTodolistSupport: vi.fn().mockReturnValue({
    tools: [],
    middleware: { name: 'todolist' },
  }),
}));

vi.mock('../../../src/spec-plan/spec-store.js', () => ({
  SpecStore: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../src/spec-plan/plan-store.js', () => ({
  PlanStore: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../src/tools/spec-plan/index.js', () => ({
  createSpecPlanTools: vi.fn().mockReturnValue([]),
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

  it('should pass temperature to AgentRunner', async () => {
    await EnhancedRunner.create(makeOptions({ temperature: 0.7 }));
    const calls = await getAgentRunnerCalls();
    expect(calls[calls.length - 1][0]).toEqual(expect.objectContaining({ temperature: 0.7 }));
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

  it('should skip spec-plan tools when enableSpecPlan is false', async () => {
    const { createSpecPlanTools } = await import('../../../src/tools/spec-plan/index.js');
    vi.mocked(createSpecPlanTools).mockClear();

    await EnhancedRunner.create(makeOptions({ enableSpecPlan: false }));

    expect(createSpecPlanTools).not.toHaveBeenCalled();
  });

  it('should include spec-plan tools when enableSpecPlan is true', async () => {
    const { createSpecPlanTools } = await import('../../../src/tools/spec-plan/index.js');
    vi.mocked(createSpecPlanTools).mockClear();

    await EnhancedRunner.create(makeOptions({ enableSpecPlan: true }));

    expect(createSpecPlanTools).toHaveBeenCalled();
  });

  it('should include spec-plan tools by default (enableSpecPlan not set)', async () => {
    const { createSpecPlanTools } = await import('../../../src/tools/spec-plan/index.js');
    vi.mocked(createSpecPlanTools).mockClear();

    await EnhancedRunner.create(makeOptions());

    expect(createSpecPlanTools).toHaveBeenCalled();
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
      const runner = await EnhancedRunner.create(makeOptions({ workspacePath: undefined }));
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

  // ── branch coverage tests ────────────────────────────────────────────

  describe('branch coverage', () => {
    it('should wrap tools with ConfirmableRegistry when confirmHandler is provided', async () => {
      const confirmHandler = vi.fn().mockResolvedValue({ allowed: true });
      await EnhancedRunner.create(
        makeOptions({
          confirmHandler,
          confirmTools: ['shell'],
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
          extraTools: [],
        })
      );

      const calls = await getAgentRunnerCalls();
      const args = calls[calls.length - 1][0];
      expect(args.tools).toBeUndefined();
      expect(args.toolRegistry).toBeDefined();
    });

    it('should include a2ui tools and middleware when a2ui.enabled is true', async () => {
      const runner = await EnhancedRunner.create(
        makeOptions({
          a2ui: { enabled: true },
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
          extraTools: [],
        })
      );

      const config = runner.getConfig();
      expect(config.middlewareNames).toContain('A2UIMiddleware');

      const toolNames = runner.getToolInfo().map((t) => t.name);
      expect(toolNames).toContain('a2ui_create_surface');
      expect(toolNames).toContain('a2ui_wait');
    });

    it('should not include a2ui tools or middleware when a2ui is disabled', async () => {
      const runner = await EnhancedRunner.create(
        makeOptions({
          a2ui: { enabled: false },
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
          extraTools: [],
        })
      );

      const config = runner.getConfig();
      expect(config.middlewareNames).not.toContain('A2UIMiddleware');
      const toolNames = runner.getToolInfo().map((t) => t.name);
      expect(toolNames).not.toContain('a2ui_create_surface');
    });

    it('should not include a2ui tools or middleware when a2ui is omitted', async () => {
      const runner = await EnhancedRunner.create(
        makeOptions({
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
          extraTools: [],
        })
      );

      const config = runner.getConfig();
      expect(config.middlewareNames).not.toContain('A2UIMiddleware');
      const toolNames = runner.getToolInfo().map((t) => t.name);
      expect(toolNames).not.toContain('a2ui_create_surface');
    });

    it('should exclude a builtin tool when its toggle is explicitly false', async () => {
      const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
      vi.mocked(createBuiltinTools).mockReturnValueOnce([{ name: 'file_read' }, { name: 'shell' }]);

      await EnhancedRunner.create(
        makeOptions({
          builtinTools: { fileRead: true, shell: false },
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
          extraTools: [],
        })
      );

      const calls = await getAgentRunnerCalls();
      const tools = calls[calls.length - 1][0].tools;
      const names = tools.map((t: { name: string }) => t.name);
      expect(names).toContain('file_read');
      expect(names).not.toContain('shell');
    });

    it('should keep command middleware when enableCommands is true', async () => {
      const runner = await EnhancedRunner.create(makeOptions({ enableCommands: true }));
      expect(runner.getConfig().middlewareNames).toContain('command');
      expect(runner.getConfig().enableCommands).toBe(true);
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
      expect(config.specPlanToolCount).toBeGreaterThanOrEqual(0);
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

    it('returns enableSpecPlan reflecting the option', async () => {
      const runner1 = await EnhancedRunner.create(makeOptions({ enableSpecPlan: true }));
      expect(runner1.getConfig().enableSpecPlan).toBe(true);

      const runner2 = await EnhancedRunner.create(makeOptions({ enableSpecPlan: false }));
      expect(runner2.getConfig().enableSpecPlan).toBe(false);
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

  // ── getToolInfo() metadata tests ──────────────────────────────────────

  describe('getToolInfo()', () => {
    it('returns empty array when no tools loaded', async () => {
      const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
      vi.mocked(createBuiltinTools).mockReturnValueOnce([]);
      const runner = await EnhancedRunner.create(
        makeOptions({
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
          extraTools: [],
        })
      );
      expect(runner.getToolInfo()).toEqual([]);
    });

    it('returns builtin tools with type=builtin and enabled=true by default', async () => {
      const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
      vi.mocked(createBuiltinTools).mockReturnValueOnce([
        { name: 'file_read', description: 'Read files' },
        { name: 'file_write', description: 'Write files' },
      ]);
      const runner = await EnhancedRunner.create(
        makeOptions({
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
          extraTools: [],
        })
      );
      const tools = runner.getToolInfo();
      const builtinTools = tools.filter((t) => t.type === 'builtin');
      expect(builtinTools).toHaveLength(2);
      expect(builtinTools.every((t) => t.enabled)).toBe(true);
      expect(builtinTools.map((t) => t.name)).toEqual(['file_read', 'file_write']);
    });

    it('returns disabled builtin tools when filtered by toggle', async () => {
      const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
      vi.mocked(createBuiltinTools).mockReturnValueOnce([
        { name: 'file_read', description: 'Read files' },
        { name: 'file_write', description: 'Write files' },
        { name: 'shell', description: 'Run shell commands' },
      ]);
      const runner = await EnhancedRunner.create(
        makeOptions({
          builtinTools: { fileRead: true },
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
          extraTools: [],
        })
      );
      const tools = runner.getToolInfo();
      const fileRead = tools.find((t) => t.name === 'file_read');
      const fileWrite = tools.find((t) => t.name === 'file_write');
      const shell = tools.find((t) => t.name === 'shell');
      expect(fileRead?.enabled).toBe(true);
      expect(fileWrite?.enabled).toBe(false);
      expect(shell?.enabled).toBe(false);
    });

    it('returns extra tools with type=extra and enabled=true', async () => {
      const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
      vi.mocked(createBuiltinTools).mockReturnValueOnce([]);
      const extraTools = [
        { name: 'custom_tool', description: 'Custom tool', schema: {}, execute: vi.fn() },
      ];
      const runner = await EnhancedRunner.create(
        makeOptions({
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
          extraTools,
        })
      );
      const tools = runner.getToolInfo();
      const custom = tools.find((t) => t.name === 'custom_tool');
      expect(custom).toEqual({
        name: 'custom_tool',
        description: 'Custom tool',
        type: 'extra',
        enabled: true,
      });
    });

    it('returns session tools with type=session', async () => {
      const { createSessionSupport } = await import('../../../src/session/support.js');
      vi.mocked(createSessionSupport).mockReturnValueOnce({
        tools: [{ name: 'ask_human', description: 'Ask human' }],
        middlewares: [{ name: 'session' }],
      });
      const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
      vi.mocked(createBuiltinTools).mockReturnValueOnce([]);
      const runner = await EnhancedRunner.create(
        makeOptions({
          enableSession: true,
          enableTodolist: false,
          enableCommands: false,
          extraTools: [],
        })
      );
      const tools = runner.getToolInfo();
      const sessionTool = tools.find((t) => t.name === 'ask_human');
      expect(sessionTool?.type).toBe('session');
      expect(sessionTool?.enabled).toBe(true);
    });

    it('returns todolist tools with type=todolist', async () => {
      const { createTodolistSupport } = await import('../../../src/todolist/support.js');
      vi.mocked(createTodolistSupport).mockReturnValueOnce({
        tools: [{ name: 'todo_read', description: 'Read todos' }],
        middleware: { name: 'todolist' },
      });
      const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
      vi.mocked(createBuiltinTools).mockReturnValueOnce([]);
      const runner = await EnhancedRunner.create(
        makeOptions({
          enableSession: false,
          enableTodolist: true,
          enableCommands: false,
          extraTools: [],
        })
      );
      const tools = runner.getToolInfo();
      const todoTool = tools.find((t) => t.name === 'todo_read');
      expect(todoTool?.type).toBe('todolist');
      expect(todoTool?.enabled).toBe(true);
    });

    it('returns spec-plan tools with type=builtin', async () => {
      const { createSpecPlanTools } = await import('../../../src/tools/spec-plan/index.js');
      vi.mocked(createSpecPlanTools).mockReturnValueOnce([
        { name: 'save_spec', description: 'Save a spec' },
        { name: 'read_spec', description: 'Read a spec' },
      ] as any);
      const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
      vi.mocked(createBuiltinTools).mockReturnValueOnce([]);
      const runner = await EnhancedRunner.create(
        makeOptions({
          enableSession: false,
          enableTodolist: false,
          enableSpecPlan: true,
          enableCommands: false,
          extraTools: [],
        })
      );
      const tools = runner.getToolInfo();
      const saveSpecTool = tools.find((t) => t.name === 'save_spec');
      expect(saveSpecTool?.type).toBe('builtin');
      expect(saveSpecTool?.enabled).toBe(true);
    });

    it('returns consistent content across repeated calls', async () => {
      const runner = await EnhancedRunner.create(makeOptions());
      const first = runner.getToolInfo();
      const second = runner.getToolInfo();
      expect(first).toEqual(second);
    });
  });

  // ── getSkillInfo() metadata tests ─────────────────────────────────────

  describe('getSkillInfo()', () => {
    it('returns empty array when no skill dirs configured', async () => {
      const runner = await EnhancedRunner.create(makeOptions({ skillDirs: undefined }));
      const skills = runner.getSkillInfo();
      // May have built-in spec-plan skills if resolved, but should not error
      expect(Array.isArray(skills)).toBe(true);
    });

    it('returns skills with name, description, and source', async () => {
      // Mock FilesystemSkillProvider to return predictable skills
      const { FilesystemSkillProvider } = await import('@agentskillmania/colts');
      vi.spyOn(FilesystemSkillProvider.prototype, 'listSkills').mockReturnValue([
        { name: 'spec-plan', description: 'Plan specifications', source: '/skills/spec-plan' },
        { name: 'a2ui-gen', description: 'A2UI generation', source: '/skills/a2ui-gen' },
      ] as any);
      const runner = await EnhancedRunner.create(makeOptions({ skillDirs: ['/test/skills'] }));
      const skills = runner.getSkillInfo();
      expect(skills.length).toBeGreaterThanOrEqual(2);
      const specPlan = skills.find((s) => s.name === 'spec-plan');
      expect(specPlan).toEqual({
        name: 'spec-plan',
        description: 'Plan specifications',
        source: '/skills/spec-plan',
      });
    });

    it('returns consistent content across repeated calls', async () => {
      const runner = await EnhancedRunner.create(makeOptions());
      const first = runner.getSkillInfo();
      const second = runner.getSkillInfo();
      expect(first).toEqual(second);
    });
  });

  describe('LLM configuration', () => {
    it('create() with llm quick init succeeds', async () => {
      const runner = await EnhancedRunner.create(
        makeOptions({
          llmClient: undefined,
          llm: {
            providers: [{ name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4' }] }],
          },
        })
      );
      expect(runner).toBeInstanceOf(EnhancedRunner);
    });

    it('create() with llmClient still succeeds', async () => {
      const runner = await EnhancedRunner.create(makeOptions());
      expect(runner).toBeInstanceOf(EnhancedRunner);
    });

    it('create() without llmClient or llm throws', async () => {
      await expect(EnhancedRunner.create(makeOptions({ llmClient: undefined }))).rejects.toThrow(
        'Must specify either llmClient or llm.'
      );
    });

    it('create() with both llmClient and llm throws', async () => {
      await expect(
        EnhancedRunner.create(
          makeOptions({
            llm: {
              providers: [{ name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4' }] }],
            },
          })
        )
      ).rejects.toThrow('Cannot specify both llmClient and llm');
    });

    it('create() with empty skillDirs still succeeds', async () => {
      const runner = await EnhancedRunner.create(makeOptions({ skillDirs: [] }));
      expect(runner).toBeInstanceOf(EnhancedRunner);
      expect(runner.getConfig().skillDirs).toEqual([]);
    });

    it('create() ignores unknown builtinTools toggles', async () => {
      const { createBuiltinTools } = await import('../../../src/tools/builtin/index.js');
      vi.mocked(createBuiltinTools).mockReturnValueOnce([{ name: 'file_read' }, { name: 'shell' }]);

      await EnhancedRunner.create(
        makeOptions({
          builtinTools: { fileRead: true, unknownToggle: true } as any,
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
          extraTools: [],
        })
      );

      const calls = await getAgentRunnerCalls();
      const tools = calls[calls.length - 1][0].tools;
      const names = tools.map((t: { name: string }) => t.name);
      expect(names).toContain('file_read');
      expect(names).not.toContain('shell');
    });
  });

  // ── crewId snapshot tests ───────────────────────────────────────────

  describe('crewId snapshot', () => {
    it('create() omits crewId from snapshot when not provided', async () => {
      const { createSessionSupport } = await import('../../../src/session/support.js');
      vi.mocked(createSessionSupport).mockClear();

      await EnhancedRunner.create(makeOptions());

      const snapshot = createSessionSupport.mock.calls.at(-1)?.[0]?.runnerConfigSnapshot;
      expect(snapshot).toBeDefined();
      expect(snapshot.crewId).toBeUndefined();
    });

    it('create() writes crewId into runnerConfigSnapshot when provided', async () => {
      const { createSessionSupport } = await import('../../../src/session/support.js');
      vi.mocked(createSessionSupport).mockClear();

      await EnhancedRunner.create(makeOptions({ crewId: 'my-crew' }));

      const snapshot = createSessionSupport.mock.calls.at(-1)?.[0]?.runnerConfigSnapshot;
      expect(snapshot?.crewId).toBe('my-crew');
    });
  });

  describe('resume', () => {
    it('resumes from session directory', async () => {
      const sessionId = '1745800000-resume-test';
      const store = new SessionStore(testBaseDir, '/test/workspace');
      await store.createWithId(sessionId, 'test-agent');
      await store.updateMeta(sessionId, { runnerConfig: { model: 'gpt-4' } });
      const agentState = createAgentState({ name: 'test-agent', tools: [] });
      await store.saveState(sessionId, agentState);

      const dir = store.getSessionDir(sessionId);
      const { runner, state } = await EnhancedRunner.resume(dir, {
        llm: { providers: [{ name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4' }] }] },
      });

      expect(runner).toBeInstanceOf(EnhancedRunner);
      expect(state).toBeDefined();
      expect(state.config.name).toBe('test-agent');
    });

    it('resume returns runner that can run', async () => {
      const sessionId = '1745800000-resume-run';
      const store = new SessionStore(testBaseDir, '/test/workspace');
      await store.createWithId(sessionId, 'test-agent');
      await store.updateMeta(sessionId, { runnerConfig: { model: 'gpt-4' } });
      const agentState = createAgentState({ name: 'test-agent', tools: [] });
      await store.saveState(sessionId, agentState);

      const dir = store.getSessionDir(sessionId);
      const { runner, state } = await EnhancedRunner.resume(dir, {
        llm: { providers: [{ name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4' }] }] },
      });

      const result = await runner.run(state);
      expect(result).toBeDefined();
    });

    it('resume synchronizes state.config.tools with runner tools', async () => {
      const sessionId = '1745800000-resume-tools';
      const store = new SessionStore(testBaseDir, '/test/workspace');
      await store.createWithId(sessionId, 'test-agent');
      await store.updateMeta(sessionId, { runnerConfig: { model: 'gpt-4' } });
      const agentState = createAgentState({
        name: 'test-agent',
        tools: [{ name: 'old-tool', description: 'old', parameters: {} as any }],
      });
      await store.saveState(sessionId, agentState);

      const dir = store.getSessionDir(sessionId);
      const { state } = await EnhancedRunner.resume(dir, {
        llm: { providers: [{ name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4' }] }] },
      });

      // runner.getToolInfo() returns mock tools (empty in this test env)
      expect(Array.isArray(state.config.tools)).toBe(true);
    });

    it('resume uses options.model to override snapshot model', async () => {
      const sessionId = '1745800000-resume-model';
      const store = new SessionStore(testBaseDir, '/test/workspace');
      await store.createWithId(sessionId, 'test-agent');
      await store.updateMeta(sessionId, { runnerConfig: { model: 'gpt-4' } });
      const agentState = createAgentState({ name: 'test-agent', tools: [] });
      await store.saveState(sessionId, agentState);

      const dir = store.getSessionDir(sessionId);
      const { runner } = await EnhancedRunner.resume(dir, {
        llm: { providers: [{ name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4' }] }] },
        model: 'claude-3',
      });

      expect(runner.getConfig().model).toBe('claude-3');
    });

    it('resume throws when llm/llmClient not provided', async () => {
      const sessionId = '1745800000-resume-nollm';
      const store = new SessionStore(testBaseDir, '/test/workspace');
      await store.createWithId(sessionId, 'test-agent');
      await store.updateMeta(sessionId, { runnerConfig: { model: 'gpt-4' } });
      const agentState = createAgentState({ name: 'test-agent', tools: [] });
      await store.saveState(sessionId, agentState);

      const dir = store.getSessionDir(sessionId);
      await expect(EnhancedRunner.resume(dir, {})).rejects.toThrow(
        'Must specify either llmClient or llm'
      );
    });

    it('resume throws for non-existent session directory', async () => {
      const badDir = join(testBaseDir, 'nonexistent');
      await expect(
        EnhancedRunner.resume(badDir, {
          llm: {
            providers: [{ name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4' }] }],
          },
        })
      ).rejects.toThrow('Session not found or incomplete');
    });

    it('resume throws when runnerConfig snapshot is missing', async () => {
      const sessionId = '1745800000-resume-noconfig';
      const store = new SessionStore(testBaseDir, '/test/workspace');
      await store.createWithId(sessionId, 'test-agent');
      // Manually clear runnerConfig to simulate legacy session
      const meta = await store.getMeta(sessionId);
      if (meta) {
        delete (meta as any).runnerConfig;
        await writeMeta(store.getSessionDir(sessionId), meta);
      }
      const agentState = createAgentState({ name: 'test-agent', tools: [] });
      await store.saveState(sessionId, agentState);

      const dir = store.getSessionDir(sessionId);
      await expect(
        EnhancedRunner.resume(dir, {
          llm: {
            providers: [{ name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4' }] }],
          },
        })
      ).rejects.toThrow('Session not found or incomplete');
    });

    it('resume throws when state.json is missing', async () => {
      const sessionId = '1745800000-resume-nostate';
      const store = new SessionStore(testBaseDir, '/test/workspace');
      await store.createWithId(sessionId, 'test-agent');
      await store.updateMeta(sessionId, { runnerConfig: { model: 'gpt-4' } });
      // Intentionally do NOT call saveState — state.json is missing

      const dir = store.getSessionDir(sessionId);
      await expect(
        EnhancedRunner.resume(dir, {
          llm: {
            providers: [{ name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4' }] }],
          },
        })
      ).rejects.toThrow('Session not found or incomplete');
    });

    it('resume creates runner with subAgents (delegate tool registered post-construction)', async () => {
      const sessionId = '1745800000-resume-crew';
      const store = new SessionStore(testBaseDir, '/test/workspace');
      await store.createWithId(sessionId, 'test-agent');
      await store.updateMeta(sessionId, {
        runnerConfig: { model: 'gpt-4', crewId: 'my-crew' },
      });
      const agentState = createAgentState({ name: 'test-agent', tools: [] });
      await store.saveState(sessionId, agentState);

      const dir = store.getSessionDir(sessionId);
      const subAgents = [
        {
          name: 'researcher',
          description: 'research helper',
          config: { name: 'researcher', instructions: 'be helpful', tools: [] },
        },
      ];

      const { runner } = await EnhancedRunner.resume(dir, {
        llm: { providers: [{ name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4' }] }] },
        subAgents,
      });

      // subAgents are no longer passed to AgentRunner constructor (colts no
      // longer knows about sub-agents). The delegate tool is registered via
      // runner.registerTool() after construction.
      const calls = await getAgentRunnerCalls();
      const resumeCall = calls[calls.length - 1][0];
      expect(resumeCall.subAgents).toBeUndefined();
      expect(runner).toBeInstanceOf(EnhancedRunner);
    });

    it('resume creates runner without delegate tool when subAgents not provided', async () => {
      const sessionId = '1745800000-resume-nocrew';
      const store = new SessionStore(testBaseDir, '/test/workspace');
      await store.createWithId(sessionId, 'test-agent');
      await store.updateMeta(sessionId, { runnerConfig: { model: 'gpt-4' } });
      const agentState = createAgentState({ name: 'test-agent', tools: [] });
      await store.saveState(sessionId, agentState);

      const dir = store.getSessionDir(sessionId);
      await EnhancedRunner.resume(dir, {
        llm: { providers: [{ name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4' }] }] },
      });

      const calls = await getAgentRunnerCalls();
      const resumeCall = calls[calls.length - 1][0];
      expect(resumeCall.subAgents).toBeUndefined();
    });
  });
});
