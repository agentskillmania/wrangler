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

// ─── 双模式（R2P-141c，对齐 Rust delegate_tools.rs 的双模式测试面）─────────

describe('createDelegateTool — dual mode (R2P-141c)', () => {
  const mockLLMProvider = {} as ILLMProvider;

  /** 收单不执行的假监督者：run 闭包收下即弃（不调用 → 不触网），只记录受理。 */
  function fakeSupervisor() {
    const jobs: Array<{
      subtaskId: string;
      agent: string;
      task: string;
      run: (signal: AbortSignal) => Promise<DelegateResultLike>;
    }> = [];
    const sinkCalls: Array<[string, Record<string, unknown>]> = [];
    const sup = {
      jobs,
      sinkCalls,
      isAlive: () => true,
      eventSink: () => (type: string, data: Record<string, unknown>) => {
        sinkCalls.push([type, data]);
      },
      accept: (job: (typeof jobs)[number]) => {
        jobs.push(job);
      },
    };
    return { sup, slot: { current: sup as never } };
  }

  type DelegateResultLike = Record<string, unknown>;

  beforeEach(() => {
    capturedFactoryOptions = undefined;
    mockCreateSubAgentRunner.mockClear();
  });

  async function makeTool(slot?: { current: unknown }) {
    const { createDelegateTool } = await import('../../../src/subagent/delegate-tool.js');
    const configs = new Map([
      [
        'helper',
        {
          name: 'helper',
          description: 't',
          config: { name: 'helper', instructions: 'help', tools: [] },
        },
      ],
    ]);
    return createDelegateTool({
      subAgentConfigs: configs,
      llmProvider: mockLLMProvider,
      model: 'gpt-4',
      parentToolRegistry: {
        getAll: vi.fn(() => []),
        get: vi.fn(),
        register: vi.fn(),
        has: vi.fn(),
        toToolSchemas: vi.fn(() => []),
        getToolNames: vi.fn(() => []),
        unregister: vi.fn(),
      } as unknown as IToolRegistry,
      emit: vi.fn(),
      ...(slot ? { supervisorSlot: slot as never } : {}),
    });
  }

  it('supervised delegate returns the accepted receipt immediately — job handed to the supervisor, run NOT awaited', async () => {
    const { sup, slot } = fakeSupervisor();
    const tool = await makeTool(slot);

    const value = (await tool.execute!(
      { agent: 'helper', task: 'do X' } as never,
      undefined as never
    )) as Record<string, unknown>;

    expect(value['status']).toBe('accepted');
    expect(String(value['subtaskId']).startsWith('helper-')).toBe(true);
    expect(value['agent']).toBe('helper');
    expect(value['task']).toBe('do X');
    expect(String(value['message'])).toContain('delivered back to this session');

    // 子任务上交监督者（未 await——handler 已返回）。
    expect(sup.jobs).toHaveLength(1);
    expect(sup.jobs[0]!.subtaskId).toBe(value['subtaskId']);
    expect(sup.jobs[0]!.task).toBe('do X');
    // subagent:start 已经经监督者 sink 发出（受理即可见）。
    expect(sup.sinkCalls.some(([t]) => t === 'subagent:start')).toBe(true);
    // 同步路径的 runner.run 不曾被调用（异步分支不阻塞）。
    expect(mockCreateSubAgentRunner).toHaveBeenCalledTimes(1); // 构造发生
  });

  it('subtask ids stay unique within the same millisecond (registry/cancel key on id)', async () => {
    const { slot } = fakeSupervisor();
    const tool = await makeTool(slot);
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const v = (await tool.execute!(
        { agent: 'helper', task: 't' } as never,
        undefined as never
      )) as Record<string, unknown>;
      ids.push(String(v['subtaskId']));
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a supervisor whose eventSink is null falls back to the parent emit channel (benign race guard)', async () => {
    const sup = {
      isAlive: () => true,
      eventSink: () => null,
      accept: vi.fn(),
    };
    const slot = { current: sup as never };
    const emit = vi.fn();
    const { createDelegateTool } = await import('../../../src/subagent/delegate-tool.js');
    const configs = new Map([
      [
        'helper',
        {
          name: 'helper',
          description: 't',
          config: { name: 'helper', instructions: 'h', tools: [] },
        },
      ],
    ]);
    const tool = createDelegateTool({
      subAgentConfigs: configs,
      llmProvider: mockLLMProvider,
      model: 'gpt-4',
      parentToolRegistry: { getAll: vi.fn(() => []) } as unknown as IToolRegistry,
      emit,
      supervisorSlot: slot as never,
    });
    await tool.execute!({ agent: 'helper', task: 'x' } as never, undefined as never);
    expect(emit).toHaveBeenCalledWith(
      'subagent:start',
      expect.objectContaining({ name: 'helper' })
    );
    expect(sup.accept).toHaveBeenCalledTimes(1);
  });

  it('empty slot keeps the sync path: unknown-agent error shape unchanged', async () => {
    const tool = await makeTool();
    const value = (await tool.execute!(
      { agent: 'nobody', task: 'x' } as never,
      undefined as never
    )) as Record<string, unknown>;
    expect(value['status']).toBe('error');
    expect(String(value['error'])).toContain('Unknown sub-agent');
  });

  it('a dead supervisor (isAlive=false) falls back to the sync mode', async () => {
    const sup = {
      isAlive: () => false,
      eventSink: () => null,
      accept: vi.fn(),
    };
    const slot = { current: sup as never };
    const tool = await makeTool(slot);
    // 同步路径会真跑子 runner（mock 工厂已 mock run 到 success）。
    const value = (await tool.execute!(
      { agent: 'helper', task: 'x' } as never,
      undefined as never
    )) as Record<string, unknown>;
    expect(value['status']).toBe('success');
    expect(value['answer']).toBe('sub-agent done');
    expect(sup.accept).not.toHaveBeenCalled();
  });
});

// ─── 全链路：delegate 受理 → 监督者后台驱动 → 完成投递（R2P-141c/142）───

describe('createDelegateTool — supervised full chain to delivery (R2P-141c/142)', () => {
  it('real supervisor: accepted receipt → background drive (watchdog signal passed) → mapped PendingDelivery lands in the mailbox hooks', async () => {
    const { createDelegateTool } = await import('../../../src/subagent/delegate-tool.js');
    const { SubagentSupervisor } = await import('../../../src/session/supervisor.js');
    type PendingDelivery = import('../../../src/session/types.js').PendingDelivery;

    const deliveries: PendingDelivery[] = [];
    const sinkEvents: Array<[string, Record<string, unknown>]> = [];
    const supervisor = new SubagentSupervisor();
    supervisor.bind({
      deliver: (d) => deliveries.push(d),
      emit: (type, data) => sinkEvents.push([type, data]),
    });
    const slot = { current: supervisor as never };

    // 子 runner 桩：跑到 success；捕获收到的 run 选项（signal 断言用）。
    const subRun = vi.fn(async () => ({
      state: {} as AgentState,
      result: {
        type: 'success',
        answer: 'scout says hi',
        totalSteps: 2,
        tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        duration: 7,
      } as RunResult,
    }));

    const configs = new Map([
      [
        'scout',
        {
          name: 'scout',
          description: 't',
          config: { name: 'scout', instructions: 's', tools: [] },
        },
      ],
    ]);
    const tool = createDelegateTool({
      subAgentConfigs: configs,
      llmProvider: {} as ILLMProvider,
      model: 'gpt-4',
      parentToolRegistry: { getAll: vi.fn(() => []) } as unknown as IToolRegistry,
      emit: vi.fn(),
      supervisorSlot: slot,
      subAgentRunnerFactory: (() =>
        ({
          on: vi.fn(),
          run: subRun,
        }) as never) as never,
    });

    const receipt = (await tool.execute!(
      { agent: 'scout', task: 'look around' } as never,
      undefined as never
    )) as Record<string, unknown>;
    expect(receipt['status']).toBe('accepted', '受理即返回，不等子 runner');

    // 监督者后台推完：投递落箱（answer → content，status 映射）。
    await vi.waitFor(() => expect(deliveries.length).toBe(1));
    const d = deliveries[0]!;
    expect(d.agent).toBe('scout');
    expect(d.status).toBe('success');
    expect(d.content).toBe('scout says hi');
    expect(String(d.subtaskId).startsWith('scout-')).toBe(true);

    // 子任务生命周期帧经监督者 sink（会话通道写口）发出。
    const types = sinkEvents.map(([t]) => t);
    expect(types).toContain('subagent:start');
    expect(types).toContain('subagent:end');
    const endFrame = sinkEvents.find(([t]) => t === 'subagent:end')![1];
    expect((endFrame['result'] as Record<string, unknown>)['status']).toBe('success');

    // run 收到监督者侧的中止口（看门狗/取消级联经 AbortSignal 组合传入；
    // 配置 timeout 未设 → 组合源只有监督者 signal）。
    expect(subRun).toHaveBeenCalledTimes(1);
    const runOpts = subRun.mock.calls[0]![1] as { signal?: AbortSignal } | undefined;
    expect(runOpts?.signal).toBeInstanceOf(AbortSignal);
  });
});
