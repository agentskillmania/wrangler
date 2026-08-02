/**
 * @fileoverview Delegate Tool unit tests
 *
 * Tests the two tool-inheritance paths and the custom factory injection:
 * - Path A: inheritParentTools: true (default) → inherit parent's full registry
 * - Path B: inheritParentTools: false → only config.config.tools declared tools
 * - Custom subAgentRunnerFactory injection replaces the default factory
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tool, ILLMProvider, IToolRegistry, AgentState } from '@agentskillmania/colts';
import type { RunResult } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

// We mock createSubAgentRunner to capture what the delegate tool passes to it.
// The real createSubAgentRunner is tested separately; here we just verify the
// delegate tool calls it with the right inheritedTools for each path.
let capturedFactoryOptions: Record<string, unknown> | undefined;

const mockCreateSubAgentRunner = vi.fn((opts: Record<string, unknown>) => {
  capturedFactoryOptions = opts;
  return {
    on: vi.fn(),
    run: vi.fn().mockResolvedValue({
      state: {} as AgentState,
      result: { type: 'success', answer: 'sub-agent done', totalSteps: 1 } as RunResult,
    }),
  };
});

vi.mock('../../../src/runner/sub-agent-runner.js', () => ({
  createSubAgentRunner: mockCreateSubAgentRunner,
}));

vi.mock('../../../src/todolist/support.js', () => ({
  createTodolistSupport: vi.fn().mockReturnValue({
    tools: [],
    middleware: { name: 'todolist' },
  }),
}));

vi.mock('../../../src/runner/system-prompt.js', () => ({
  buildTimeContext: vi.fn().mockReturnValue('---\nTime: mock\n---'),
}));

describe('createDelegateTool — tool inheritance paths', () => {
  const mockLLMProvider = {} as ILLMProvider;

  /** Build a mock parent tool registry with named tools */
  function makeRegistry(tools: Tool<ZodTypeAny>[]): IToolRegistry {
    const map = new Map(tools.map((t) => [t.name, t]));
    return {
      getAll: vi.fn(() => Array.from(map.values())),
      get: vi.fn((name: string) => map.get(name)),
      register: vi.fn(),
      has: vi.fn(),
      toToolSchemas: vi.fn(() => []),
      getToolNames: vi.fn(() => Array.from(map.keys())),
      unregister: vi.fn(),
    } as unknown as IToolRegistry;
  }

  function makeTool(name: string): Tool<ZodTypeAny> {
    return { name, description: `${name} tool`, parameters: {} as ZodTypeAny, execute: vi.fn() };
  }

  beforeEach(() => {
    capturedFactoryOptions = undefined;
    mockCreateSubAgentRunner.mockClear();
  });

  it('Path A (default): inheritParentTools true → inherits full parent registry (minus delegate/load_skill)', async () => {
    const { createDelegateTool } = await import('../../../src/subagent/delegate-tool.js');

    const parentTools = [
      makeTool('file_read'),
      makeTool('shell'),
      makeTool('web_search'),
      makeTool('load_skill'),
      makeTool('delegate'), // should be filtered out (recursion)
    ];

    const configs = new Map([
      [
        'researcher',
        {
          name: 'researcher',
          description: 'research helper',
          config: {
            name: 'researcher',
            instructions: 'be helpful',
            tools: [], // ignored when inheriting
          },
          // inheritParentTools defaults to true
        },
      ],
    ]);

    const tool = createDelegateTool({
      subAgentConfigs: configs,
      llmProvider: mockLLMProvider,
      model: 'gpt-4',
      parentToolRegistry: makeRegistry(parentTools),
      emit: vi.fn(),
    });

    await tool.execute!({ agent: 'researcher', task: 'do research' } as never, undefined as never);

    const inherited = capturedFactoryOptions!.inheritedTools as Tool<ZodTypeAny>[];
    expect(inherited.map((t) => t.name)).toEqual(
      expect.arrayContaining(['file_read', 'shell', 'web_search'])
    );
    // delegate and load_skill must be filtered out
    expect(inherited.map((t) => t.name)).not.toContain('delegate');
    expect(inherited.map((t) => t.name)).not.toContain('load_skill');
  });

  it('Path B: inheritParentTools false → only config.config.tools declared tools', async () => {
    const { createDelegateTool } = await import('../../../src/subagent/delegate-tool.js');

    const parentTools = [makeTool('file_read'), makeTool('shell'), makeTool('web_search')];

    const configs = new Map([
      [
        'researcher',
        {
          name: 'researcher',
          description: 'research helper',
          config: {
            name: 'researcher',
            instructions: 'be helpful',
            // Only declare web_search — file_read and shell must NOT be inherited
            tools: [{ name: 'web_search', description: 'search', parameters: {} }],
          },
          inheritParentTools: false,
        },
      ],
    ]);

    const tool = createDelegateTool({
      subAgentConfigs: configs,
      llmProvider: mockLLMProvider,
      model: 'gpt-4',
      parentToolRegistry: makeRegistry(parentTools),
      emit: vi.fn(),
    });

    await tool.execute!({ agent: 'researcher', task: 'do research' } as never, undefined as never);

    const inherited = capturedFactoryOptions!.inheritedTools as Tool<ZodTypeAny>[];
    // Only web_search — not file_read or shell
    expect(inherited.map((t) => t.name)).toEqual(['web_search']);
  });

  it('Path B: delegate tool in config.config.tools is never inherited (no recursion)', async () => {
    const { createDelegateTool } = await import('../../../src/subagent/delegate-tool.js');

    const parentTools = [makeTool('delegate'), makeTool('file_read')];

    const configs = new Map([
      [
        'researcher',
        {
          name: 'researcher',
          description: 'research helper',
          config: {
            name: 'researcher',
            instructions: 'be helpful',
            tools: [{ name: 'delegate', description: 'delegate', parameters: {} }],
          },
          inheritParentTools: false,
        },
      ],
    ]);

    const tool = createDelegateTool({
      subAgentConfigs: configs,
      llmProvider: mockLLMProvider,
      model: 'gpt-4',
      parentToolRegistry: makeRegistry(parentTools),
      emit: vi.fn(),
    });

    await tool.execute!({ agent: 'researcher', task: 'do research' } as never, undefined as never);

    const inherited = capturedFactoryOptions!.inheritedTools as Tool<ZodTypeAny>[];
    // delegate must never be inherited even if explicitly declared
    expect(inherited.map((t) => t.name)).not.toContain('delegate');
  });
});

describe('createDelegateTool — custom factory injection', () => {
  const mockLLMProvider = {} as ILLMProvider;

  beforeEach(() => {
    capturedFactoryOptions = undefined;
    mockCreateSubAgentRunner.mockClear();
  });

  it('uses custom subAgentRunnerFactory when provided', async () => {
    const { createDelegateTool } = await import('../../../src/subagent/delegate-tool.js');

    const customFactory = vi.fn(() => ({
      on: vi.fn(),
      run: vi.fn().mockResolvedValue({
        state: {} as AgentState,
        result: {
          type: 'success',
          answer: 'custom',
          totalSteps: 1,
          tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
          duration: 5000,
        } as RunResult,
      }),
    }));

    const configs = new Map([
      [
        'researcher',
        {
          name: 'researcher',
          description: 'research helper',
          config: { name: 'researcher', instructions: 'be helpful', tools: [] },
        },
      ],
    ]);

    const registry = {
      getAll: vi.fn(() => []),
      get: vi.fn(),
      register: vi.fn(),
      has: vi.fn(),
      toToolSchemas: vi.fn(() => []),
      getToolNames: vi.fn(() => []),
      unregister: vi.fn(),
    } as unknown as IToolRegistry;

    const tool = createDelegateTool({
      subAgentConfigs: configs,
      llmProvider: mockLLMProvider,
      model: 'gpt-4',
      parentToolRegistry: registry,
      subAgentRunnerFactory: customFactory,
      emit: vi.fn(),
    });

    const result = await tool.execute!(
      { agent: 'researcher', task: 'do research' } as never,
      undefined as never
    );

    expect(customFactory).toHaveBeenCalledTimes(1);
    // The default createSubAgentRunner should NOT have been called
    expect(mockCreateSubAgentRunner).not.toHaveBeenCalled();
    // Result comes from the custom factory's run()
    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        answer: 'custom',
        totalSteps: 1,
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        duration: expect.any(Number),
      })
    );
  });

  it('falls back to default createSubAgentRunner when no factory provided', async () => {
    const { createDelegateTool } = await import('../../../src/subagent/delegate-tool.js');

    const configs = new Map([
      [
        'researcher',
        {
          name: 'researcher',
          description: 'research helper',
          config: { name: 'researcher', instructions: 'be helpful', tools: [] },
        },
      ],
    ]);

    const registry = {
      getAll: vi.fn(() => []),
      get: vi.fn(),
      register: vi.fn(),
      has: vi.fn(),
      toToolSchemas: vi.fn(() => []),
      getToolNames: vi.fn(() => []),
      unregister: vi.fn(),
    } as unknown as IToolRegistry;

    const tool = createDelegateTool({
      subAgentConfigs: configs,
      llmProvider: mockLLMProvider,
      model: 'gpt-4',
      parentToolRegistry: registry,
      emit: vi.fn(),
    });

    await tool.execute!({ agent: 'researcher', task: 'do research' } as never, undefined as never);

    expect(mockCreateSubAgentRunner).toHaveBeenCalledTimes(1);
  });
});
