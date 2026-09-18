import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import {
  AgentSession,
  HISTORY_CAP,
  humanRequestPayloads,
  findPendingInterrupt,
  hitlResponseFromValue,
} from '../../src/core/agent-session.js';
import type { HistoryEntry } from '../../src/core/agent-session.js';
import type { AgentSessionOptions } from '../../src/core/agent-session.js';
import type { SSEEvent } from '../../src/types.js';

/**
 * Shared mock-runner factory.
 *
 * agent-session.handleMessage no longer consumes an AsyncGenerator from
 * runStream(). Instead it calls runner.on(type, handler) to subscribe,
 * then runner.run(state, opts) which returns Promise<{ state, result }>.
 * Events flow through the registered EventEmitter handlers during run().
 *
 * This helper returns a mock runner plus a handle to the handlers map so
 * individual tests can simulate runner.emit(...) by invoking handlers
 * directly from inside their run() implementation.
 */
function createMockRunner(
  overrides: {
    run?: ReturnType<typeof vi.fn>;
    getToolInfo?: ReturnType<typeof vi.fn>;
    getSkillInfo?: ReturnType<typeof vi.fn>;
    getConfig?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const eventHandlers: Record<string, (...args: unknown[]) => void> = {};
  const on = vi.fn((type: string, handler: (...args: unknown[]) => void) => {
    eventHandlers[type] = handler;
  });
  const off = vi.fn((type: string, _handler: (...args: unknown[]) => void) => {
    delete eventHandlers[type];
  });
  const emit = (type: string, ...args: unknown[]) => eventHandlers[type]?.(...args);
  const setSessionTitleListener = vi.fn();
  const runner = {
    run:
      overrides.run ??
      vi.fn().mockResolvedValue({
        state: {
          id: 'test-state',
          config: { name: 'test', instructions: '', tools: [] },
          context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
        },
        result: {
          type: 'success',
          answer: '',
          totalSteps: 1,
          tokens: { input: 0, output: 0 },
        },
      }),
    on,
    off,
    setSessionTitleListener,
    getToolInfo: overrides.getToolInfo ?? vi.fn().mockReturnValue([]),
    getSkillInfo: overrides.getSkillInfo ?? vi.fn().mockReturnValue([]),
    getConfig: overrides.getConfig ?? vi.fn().mockReturnValue({ model: 'test-model' }),
  };
  return { runner, on, off, emit, setSessionTitleListener };
}

/**
 * Convenience: build a mock runner whose run() emits a sequence of events
 * (defaulting to just `complete`) before resolving with the given finalState.
 * The runner is wired into mockEnhancedRunnerCreate.
 *
 * @param eventsToEmit - array of [type, payload?] tuples to emit before resolving
 * @param finalState   - the `state` returned by run(); defaults to a minimal state
 * @param overrides    - extra runner overrides (getToolInfo, getConfig, ...)
 */
function mockRunnerWithEvents(
  eventsToEmit: Array<[string, unknown?]> = [['complete']],
  finalState: Record<string, unknown> = {
    id: 'test-state',
    config: { name: 'test', instructions: '', tools: [] },
    context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
  },
  overrides: {
    getToolInfo?: ReturnType<typeof vi.fn>;
    getSkillInfo?: ReturnType<typeof vi.fn>;
    getConfig?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const mock = createMockRunner({
    run: vi.fn().mockImplementation(async () => {
      for (const [type, payload] of eventsToEmit) {
        if (payload === undefined) mock.emit(type);
        else mock.emit(type, payload);
      }
      return {
        state: finalState,
        result: {
          type: 'success',
          answer: '',
          totalSteps: 1,
          tokens: { input: 0, output: 0 },
        },
      };
    }),
    getToolInfo: overrides.getToolInfo,
    getSkillInfo: overrides.getSkillInfo,
    getConfig: overrides.getConfig,
  });
  mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);
  return mock;
}

const { mockEnhancedRunnerCreate, mockEnhancedRunnerResume } = vi.hoisted(() => ({
  mockEnhancedRunnerCreate: vi.fn(),
  mockEnhancedRunnerResume: vi.fn().mockResolvedValue({
    runner: {
      run: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      setSessionTitleListener: vi.fn(),
      getToolInfo: vi.fn().mockReturnValue([]),
      getSkillInfo: vi.fn().mockReturnValue([]),
      getConfig: vi.fn().mockReturnValue({ model: 'test-model' }),
    },
    state: {
      id: 'resumed-state-id',
      config: { name: 'resumed-agent', instructions: '', tools: [] },
      context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
    },
  }),
}));
vi.mock('@agentskillmania/wrangler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/wrangler')>();
  // R2P-201 后 agent-session 经 wrangler 再导出消费内核符号；wrangler dist
  // 是 externalized 依赖——其内部的 colts re-export 不经 vitest mock 拦截，
  // 所以这里显式从 colts mock 转发被测路径用到的符号（工厂内的动态
  // import 走 mock registry），保持原测试意图（state 构造 mock 成固定 id）。
  const colts = await import('@agentskillmania/colts');
  return {
    ...actual,
    createAgentState: colts.createAgentState,
    updateState: colts.updateState,
    addUserMessage: colts.addUserMessage,
    FilesystemSkillProvider: colts.FilesystemSkillProvider,
    EnhancedRunner: { create: mockEnhancedRunnerCreate, resume: mockEnhancedRunnerResume },
    SessionStore: vi.fn(),
  };
});
vi.mock('@agentskillmania/llm-client', () => ({
  LLMClient: vi.fn().mockReturnValue({
    registerProvider: vi.fn(),
    registerApiKey: vi.fn(),
  }),
}));
vi.mock('@agentskillmania/colts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/colts')>();
  return {
    ...actual,
    createAgentState: vi.fn().mockReturnValue({
      id: 'test-state',
      config: { name: 'test', instructions: '', tools: [] },
      context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
    }),
    addUserMessage: vi.fn((state, _msg, _maxLength?) => state),
    updateState: vi.fn((state) => state),
    FilesystemSkillProvider: vi.fn(),
    // daemon.ts 启动时经 wrangler ensureNodeSkillFsOps 注册（R2P-201 起
    // Node fs 绑定走 wrangler 门面）；此处仅钉 mock 不触真实 node:fs。
    setDefaultSkillFsOps: vi.fn(),
  };
});

const testConfig = {
  llm: {
    providers: [
      {
        name: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com',
        models: [{ modelId: 'test-model' }],
      },
    ],
  },
  server: { port: 3100, host: 'localhost' },
} satisfies import('../../src/types.js').DaemonConfig;

/** 注入 factory 使用的 mock LLM 客户端（daemon core 不再捆绑内置 LLM） */
const mockLLMClient = { call: vi.fn(), stream: vi.fn(), getModelMeta: vi.fn() };
describe('AgentSession', () => {
  describe('mapEvent', () => {
    it('maps token event', () => {
      const result = AgentSession.mapEvent({ type: 'token', token: 'hello' } as any);
      expect(result).toEqual({ event: 'token', data: { delta: 'hello' } });
    });

    it('maps thinking event', () => {
      const result = AgentSession.mapEvent({ type: 'thinking', content: 'hmm' } as any);
      expect(result).toEqual({ event: 'thinking', data: { content: 'hmm' } });
    });

    it('maps tool:start event', () => {
      const result = AgentSession.mapEvent({
        type: 'tool:start',
        action: { id: 'call-1', tool: 'read_file', arguments: { path: '/tmp/x' } },
      } as any);
      expect(result).toEqual({
        event: 'tool-start',
        data: { id: 'call-1', name: 'read_file', args: { path: '/tmp/x' } },
      });
    });

    it('maps tool:end event with string result', () => {
      const result = AgentSession.mapEvent({
        type: 'tool:end',
        callId: 'call-1',
        result: 'file contents',
      } as any);
      expect(result).toEqual({
        event: 'tool-end',
        data: { callId: 'call-1', result: 'file contents' },
      });
    });

    it('maps tool:end with object result as JSON', () => {
      const result = AgentSession.mapEvent({
        type: 'tool:end',
        callId: 'call-1',
        result: { error: 'not found' },
      } as any);
      expect(result!.event).toBe('tool-end');
      const data = result!.data as { callId: string; result: string };
      expect(data.result).toContain('error');
    });

    it('maps complete event with RunResult fields', () => {
      const result = AgentSession.mapEvent({
        type: 'complete',
        result: {
          type: 'success',
          answer: '42',
          totalSteps: 3,
          tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
          duration: 5000,
        },
        timestamp: 0,
      } as any);
      expect(result!.event).toBe('done');
      const data = result!.data as Record<string, unknown>;
      expect(data.type).toBe('success');
      expect(data.answer).toBe('42');
      expect(data.totalSteps).toBe(3);
      expect(data.tokens).toEqual({ input: 100, output: 50, cacheRead: 10, cacheWrite: 5 });
      expect(data.duration).toBe(5000);
    });

    it('maps error event', () => {
      const result = AgentSession.mapEvent({ type: 'error', error: new Error('boom') } as any);
      expect(result).toEqual({ event: 'error', data: { message: 'boom' } });
    });

    it('maps step:start event', () => {
      const result = AgentSession.mapEvent({
        type: 'step:start',
        step: 3,
        state: {},
        timestamp: 0,
      } as any);
      expect(result).toEqual({ event: 'step-start', data: { step: 3 } });
    });

    it('maps step:end event with tokens and duration', () => {
      const result = AgentSession.mapEvent({
        type: 'step:end',
        step: 3,
        result: {
          type: 'done',
          answer: 'ok',
          tokens: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0 },
          duration: 1500,
        },
        timestamp: 0,
      } as any);
      expect(result!.event).toBe('step-end');
      const data = result!.data as Record<string, unknown>;
      expect(data.step).toBe(3);
      expect(data.tokens).toEqual({ input: 50, output: 20, cacheRead: 0, cacheWrite: 0 });
      expect(data.duration).toBe(1500);
    });

    it('maps phase-change event', () => {
      const result = AgentSession.mapEvent({
        type: 'phase-change',
        from: 'thinking',
        to: 'tool_call',
        timestamp: 0,
      } as any);
      expect(result).toEqual({
        event: 'phase-change',
        data: { from: 'thinking', to: 'tool_call' },
      });
    });

    it('maps compressing event', () => {
      const result = AgentSession.mapEvent({ type: 'compressing', timestamp: 0 } as any);
      expect(result).toEqual({ event: 'compressing', data: {} });
    });

    it('maps compressed event', () => {
      const result = AgentSession.mapEvent({
        type: 'compressed',
        summary: 'summarized',
        removedCount: 5,
        coveredMessages: 5,
        timestamp: 0,
      } as any);
      expect(result).toEqual({
        event: 'compressed',
        data: { summary: 'summarized', removedCount: 5, coveredMessages: 5 },
      });
    });

    it('maps compressed event without coveredMessages (legacy kernel payload)', () => {
      // Older colts kernels omitted coveredMessages — the field must be
      // absent (not null) on the wire, never a hard error.
      const result = AgentSession.mapEvent({
        type: 'compressed',
        summary: 'summarized',
        removedCount: 5,
        timestamp: 0,
      } as any);
      expect(result).toEqual({
        event: 'compressed',
        data: { summary: 'summarized', removedCount: 5 },
      });
    });

    it('maps llm:request event', () => {
      const result = AgentSession.mapEvent({
        type: 'llm:request',
        messages: [{ role: 'user', content: 'hi' }],
        tools: ['read_file'],
        skill: null,
        model: 'claude-sonnet-4-20250514',
        contextWindow: 200000,
        timestamp: 0,
      } as any);
      expect(result!.event).toBe('llm-request');
      const data = result!.data as {
        messages: unknown[];
        tools: string[];
        model: string;
        contextWindow: number;
      };
      expect(data.messages).toHaveLength(1);
      expect(data.tools).toEqual(['read_file']);
      expect(data.model).toBe('claude-sonnet-4-20250514');
      expect(data.contextWindow).toBe(200000);
    });

    it('maps llm:response event with tokens', () => {
      const result = AgentSession.mapEvent({
        type: 'llm:response',
        text: 'hello',
        toolCalls: null,
        tokens: { input: 30, output: 10, cacheRead: 5, cacheWrite: 0 },
        timestamp: 0,
      } as any);
      expect(result!.event).toBe('llm-response');
      const data = result!.data as Record<string, unknown>;
      expect(data.text).toBe('hello');
      expect(data.toolCalls).toBeNull();
      expect(data.tokens).toEqual({ input: 30, output: 10, cacheRead: 5, cacheWrite: 0 });
    });

    it('maps llm:response event with toolCalls', () => {
      const result = AgentSession.mapEvent({
        type: 'llm:response',
        text: '',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: '/tmp' } }],
        tokens: { input: 20, output: 0, cacheRead: 0, cacheWrite: 0 },
        timestamp: 0,
      } as any);
      expect(result!.event).toBe('llm-response');
      const data = result!.data as { toolCalls: unknown[]; tokens: { input: number } };
      expect(data.toolCalls).toHaveLength(1);
      expect(data.tokens.input).toBe(20);
    });

    it('maps todo:list event to todo-list SSE with Rust wire shape', () => {
      const result = AgentSession.mapEvent({
        type: 'todo:list',
        items: [
          { id: 1, subject: 'a', status: 'in_progress' },
          {
            id: 2,
            subject: 'b',
            status: 'pending',
            description: 'd',
            blocks: [],
            blockedBy: [1],
          },
          { id: 3, subject: 'c', status: 'completed', blocks: [1, 2], blockedBy: [] },
        ],
        timestamp: 0,
      } as any);
      expect(result!.event).toBe('todo-list');
      expect(result!.data).toEqual({
        items: [
          { id: 1, subject: 'a', status: 'in_progress' },
          { id: 2, subject: 'b', status: 'pending', description: 'd', blocked_by: [1] },
          { id: 3, subject: 'c', status: 'completed', blocks: [1, 2] },
        ],
      });
    });

    it('maps session-cleared event (/clear reset)', () => {
      const result = AgentSession.mapEvent({
        type: 'session-cleared',
        timestamp: 0,
      } as any);
      expect(result).toEqual({ event: 'session-cleared', data: {} });
    });

    it('maps tools:start (plural) to array of events', () => {
      const result = AgentSession.mapEvent({
        type: 'tools:start',
        actions: [
          { id: 'c1', tool: 'tool_a', arguments: {} },
          { id: 'c2', tool: 'tool_b', arguments: {} },
        ],
      } as any);
      expect(Array.isArray(result)).toBe(true);
      const events = result as SSEEvent[];
      expect(events).toHaveLength(2);
      expect(events[0].event).toBe('tool-start');
    });

    it('maps tools:end (plural) to array of events', () => {
      const result = AgentSession.mapEvent({
        type: 'tools:end',
        results: { c1: 'result-a', c2: 'result-b' },
      } as any);
      expect(Array.isArray(result)).toBe(true);
      const events = result as SSEEvent[];
      expect(events).toHaveLength(2);
      expect(events[0].event).toBe('tool-end');
    });

    it('maps skill:loading event', () => {
      const result = AgentSession.mapEvent({ type: 'skill:loading', name: 'my-skill' } as any);
      expect(result).toEqual({ event: 'skill-loading', data: { name: 'my-skill' } });
    });

    it('maps skill:loaded event', () => {
      const result = AgentSession.mapEvent({
        type: 'skill:loaded',
        name: 'my-skill',
        tokenCount: 500,
      } as any);
      expect(result).toEqual({
        event: 'skill-loaded',
        data: { name: 'my-skill', tokenCount: 500 },
      });
    });

    it('maps skill:start event', () => {
      const result = AgentSession.mapEvent({
        type: 'skill:start',
        name: 'my-skill',
        task: 'do stuff',
      } as any);
      expect(result).toEqual({
        event: 'skill-start',
        data: { name: 'my-skill', task: 'do stuff' },
      });
    });

    it('maps skill:end event', () => {
      const result = AgentSession.mapEvent({
        type: 'skill:end',
        name: 'my-skill',
        result: 'done',
      } as any);
      expect(result).toEqual({ event: 'skill-end', data: { name: 'my-skill', result: 'done' } });
    });

    it('maps subagent:start event', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:start',
        name: 'helper',
        task: 'assist',
      } as any);
      expect(result).toEqual({ event: 'subagent-start', data: { name: 'helper', task: 'assist' } });
    });

    it('maps subagent:tool:start event with action', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:tool:start',
        subtaskId: 'helper-1',
        subagentName: 'helper',
        action: { id: 'call-x', tool: 'read_file', arguments: { path: '/tmp/x' } },
      } as any);
      expect(result).toEqual({
        event: 'subagent-tool-start',
        data: {
          subtaskId: 'helper-1',
          name: 'helper',
          action: { id: 'call-x', tool: 'read_file', arguments: { path: '/tmp/x' } },
        },
      });
    });

    it('maps subagent:tool:end event forwarding callId', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:tool:end',
        subtaskId: 'helper-1',
        subagentName: 'helper',
        callId: 'call-x',
        result: 'file contents',
      } as any);
      expect(result).toEqual({
        event: 'subagent-tool-end',
        data: {
          subtaskId: 'helper-1',
          name: 'helper',
          callId: 'call-x',
          result: 'file contents',
        },
      });
    });

    it('maps subagent:tools:start (plural) to array of subagent-tool-start events', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:tools:start',
        subtaskId: 'helper-1',
        subagentName: 'helper',
        actions: [
          { id: 'c1', tool: 'tool_a', arguments: { q: 1 } },
          { id: 'c2', tool: 'tool_b', arguments: { q: 2 } },
        ],
      } as any);
      expect(Array.isArray(result)).toBe(true);
      const events = result as SSEEvent[];
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        event: 'subagent-tool-start',
        data: {
          subtaskId: 'helper-1',
          name: 'helper',
          action: { id: 'c1', tool: 'tool_a', arguments: { q: 1 } },
        },
      });
      expect(events[1]).toEqual({
        event: 'subagent-tool-start',
        data: {
          subtaskId: 'helper-1',
          name: 'helper',
          action: { id: 'c2', tool: 'tool_b', arguments: { q: 2 } },
        },
      });
    });

    it('maps subagent:tools:end (plural) to array of subagent-tool-end events', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:tools:end',
        subtaskId: 'helper-1',
        subagentName: 'helper',
        results: { c1: 'result-a', c2: { rows: 3 } },
      } as any);
      expect(Array.isArray(result)).toBe(true);
      const events = result as SSEEvent[];
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        event: 'subagent-tool-end',
        data: {
          subtaskId: 'helper-1',
          name: 'helper',
          callId: 'c1',
          result: 'result-a',
        },
      });
      expect(events[1]).toEqual({
        event: 'subagent-tool-end',
        data: {
          subtaskId: 'helper-1',
          name: 'helper',
          callId: 'c2',
          result: JSON.stringify({ rows: 3 }, null, 2),
        },
      });
    });

    it('maps subagent:end event with DelegateResult object', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:end',
        name: 'helper',
        subtaskId: 'helper-123',
        result: {
          status: 'success',
          answer: 'ok',
          totalSteps: 3,
          tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
          duration: 5000,
        },
      } as any);
      expect(result!.event).toBe('subagent-end');
      const data = result!.data as Record<string, unknown>;
      expect(data.name).toBe('helper');
      expect(data.subtaskId).toBe('helper-123');
      expect(data.status).toBe('success');
      expect(data.answer).toBe('ok');
      expect(data.totalSteps).toBe(3);
      expect(data.tokens).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
      expect(data.duration).toBe(5000);
    });

    it('maps subagent:end with non-JSON string result', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:end',
        name: 'helper',
        subtaskId: 'helper-456',
        result: 'done',
      } as any);
      expect(result!.event).toBe('subagent-end');
      const data = result!.data as Record<string, unknown>;
      expect(data.name).toBe('helper');
      expect(data.subtaskId).toBe('helper-456');
      expect(data.result).toBe('done');
      // Non-JSON string → status unknown, structured fields absent
      expect(data.status).toBe('unknown');
    });

    it('maps subagent:end with error DelegateResult', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:end',
        name: 'coder',
        subtaskId: 'coder-1',
        result: JSON.stringify({
          status: 'error',
          error: 'TypeError: undefined',
          totalSteps: 2,
          tokens: { input: 200, output: 50, cacheRead: 0, cacheWrite: 0 },
          duration: 3000,
        }),
      } as any);
      const data = result!.data as Record<string, unknown>;
      expect(data.status).toBe('error');
      expect(data.error).toBe('TypeError: undefined');
      expect(data.totalSteps).toBe(2);
    });

    it('maps subagent:end with max_steps DelegateResult', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:end',
        name: 'writer',
        subtaskId: 'writer-1',
        result: JSON.stringify({
          status: 'max_steps',
          lastAnswer: 'partial work',
          totalSteps: 50,
          tokens: { input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0 },
          duration: 120000,
        }),
      } as any);
      const data = result!.data as Record<string, unknown>;
      expect(data.status).toBe('max_steps');
      expect(data.totalSteps).toBe(50);
    });

    it('maps subagent:end with timeout DelegateResult', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:end',
        name: 'analyst',
        subtaskId: 'analyst-1',
        result: JSON.stringify({
          status: 'timeout',
          partialResult: 'incomplete analysis',
          totalSteps: 12,
          tokens: { input: 1000, output: 300, cacheRead: 0, cacheWrite: 0 },
          duration: 60000,
        }),
      } as any);
      const data = result!.data as Record<string, unknown>;
      expect(data.status).toBe('timeout');
      expect(data.duration).toBe(60000);
    });

    it('maps tools:end with object result', () => {
      const result = AgentSession.mapEvent({
        type: 'tools:end',
        results: { c1: { error: 'fail' }, c2: 'ok' },
      } as any);
      const events = result as SSEEvent[];
      expect(events).toHaveLength(2);
      const objResult = events.find((e) => (e.data as { callId: string }).callId === 'c1');
      expect((objResult!.data as { result: string }).result).toContain('error');
    });

    // ── waiting-human done 帧：requests 全量数组（R2P-165③）──

    it('maps waiting-human complete with the full requests array', () => {
      const result = AgentSession.mapEvent({
        type: 'complete',
        result: {
          type: 'waiting-human',
          request: {
            type: 'question',
            questions: [{ id: 'q1', question: 'A?', type: 'text' }],
            toolCallId: 'call-1',
          },
          requests: [
            {
              type: 'question',
              questions: [{ id: 'q1', question: 'A?', type: 'text' }],
              toolCallId: 'call-1',
            },
            {
              type: 'tool-confirm',
              toolName: 'shell',
              args: { cmd: 'rm -rf' },
              toolCallId: 'call-2',
            },
          ],
          totalSteps: 1,
          tokens: { input: 0, output: 0 },
          duration: 10,
        },
      } as any);
      const data = result!.data as Record<string, unknown>;
      expect(data.type).toBe('waiting-human');
      const requests = data.requests as Array<Record<string, unknown>>;
      // 全量下发：两个挂起请求都在（并行双问），形状与单 request 字段一致
      // （question → requestId/questions；tool-confirm → requestId/confirm）。
      expect(requests).toHaveLength(2);
      expect(requests[0]).toEqual({
        requestId: 'call-1',
        questions: [{ id: 'q1', question: 'A?', type: 'text' }],
        context: undefined,
      });
      expect(requests[1]).toEqual({
        requestId: 'call-2',
        confirm: { toolName: 'shell', arguments: { cmd: 'rm -rf' } },
      });
    });

    it('falls back to the single request for legacy waiting-human results', () => {
      const result = AgentSession.mapEvent({
        type: 'complete',
        result: {
          type: 'waiting-human',
          request: {
            type: 'question',
            questions: [{ id: 'q1', question: 'A?', type: 'text' }],
            toolCallId: 'call-1',
          },
          totalSteps: 1,
        },
      } as any);
      const data = result!.data as Record<string, unknown>;
      const requests = data.requests as Array<Record<string, unknown>>;
      expect(requests).toHaveLength(1);
      expect(requests[0].requestId).toBe('call-1');
    });

    it('keeps non-waiting done frames free of the requests field', () => {
      const result = AgentSession.mapEvent({
        type: 'complete',
        result: { type: 'success', answer: 'ok', totalSteps: 1 },
      } as any);
      const data = result!.data as Record<string, unknown>;
      expect('requests' in data).toBe(false);
    });
  });

  describe('HITL wire helpers (R2P-165)', () => {
    const questionRequest = {
      type: 'question',
      questions: [{ id: 'q1', question: 'A?', type: 'text' }],
      context: 'ctx',
      toolCallId: 'call-1',
    } as const;
    const confirmRequest = {
      type: 'tool-confirm',
      toolName: 'shell',
      args: { cmd: 'ls' },
      toolCallId: 'call-2',
    } as const;

    it('humanRequestPayloads serializes both request variants in frame shape', () => {
      const payloads = humanRequestPayloads([questionRequest, confirmRequest] as any);
      expect(payloads[0]).toEqual({
        requestId: 'call-1',
        questions: questionRequest.questions,
        context: 'ctx',
      });
      expect(payloads[1]).toEqual({
        requestId: 'call-2',
        confirm: { toolName: 'shell', arguments: { cmd: 'ls' } },
      });
    });

    it('findPendingInterrupt matches by tool-call id AND by question id', () => {
      const state = {
        context: {
          pendingInterrupts: [
            { request: { ...questionRequest, toolCallId: 'call-1' }, createdAt: 1 },
          ],
        },
      } as any;
      expect(findPendingInterrupt(state, 'call-1')?.request.toolCallId).toBe('call-1');
      expect(findPendingInterrupt(state, 'q1')?.request.toolCallId).toBe('call-1');
      expect(findPendingInterrupt(state, 'nope')).toBeUndefined();
    });

    it('findPendingInterrupt tolerates a missing list (legacy archives)', () => {
      expect(findPendingInterrupt({ context: {} } as any, 'call-1')).toBeUndefined();
    });

    it('hitlResponseFromValue passes question answers through and defaults confirm to reject', () => {
      const q = hitlResponseFromValue(questionRequest as any, {
        q1: { type: 'direct', value: 'A' },
      });
      expect(q).toEqual({
        ok: true,
        response: { type: 'question', answers: { q1: { type: 'direct', value: 'A' } } },
      });
      // tool-confirm：approved 缺席按拒绝（镜像 Rust response_from_value）
      expect(hitlResponseFromValue(confirmRequest as any, {})).toEqual({
        ok: true,
        response: { type: 'tool-confirm', approved: false },
      });
      expect(hitlResponseFromValue(confirmRequest as any, { approved: true })).toEqual({
        ok: true,
        response: { type: 'tool-confirm', approved: true },
      });
    });

    it('hitlResponseFromValue rejects garbage question payloads at the boundary (返修 P3)', () => {
      // 非对象（字符串/数组/null）——垃圾载荷在注入之前被拒。
      expect(hitlResponseFromValue(questionRequest as any, 'yes').ok).toBe(false);
      expect(hitlResponseFromValue(questionRequest as any, ['yes']).ok).toBe(false);
      expect(hitlResponseFromValue(questionRequest as any, null).ok).toBe(false);
      // 条目缺 type / type 未知——错误信息点名问题 id，可诊断。
      const missingType = hitlResponseFromValue(questionRequest as any, { q1: 'A' });
      expect(missingType.ok).toBe(false);
      if (!missingType.ok) expect(missingType.error).toContain("question 'q1'");
      expect(
        hitlResponseFromValue(questionRequest as any, { q1: { type: 'telepathy', value: 'A' } }).ok
      ).toBe(false);
      // 空对象合法（零问答对，同 Rust 宽容）。
      expect(hitlResponseFromValue(questionRequest as any, {}).ok).toBe(true);
    });
  });

  describe('AskHuman bridge requestId (R2P-165①)', () => {
    it('issues collision-proof UUID requestIds — parallel double-ask parks two distinct entries', async () => {
      mockRunnerWithEvents();
      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      // The AskHuman handler the session wired into EnhancedRunner.create.
      const createOptions = mockEnhancedRunnerCreate.mock.calls.at(-1)![0] as {
        tools: {
          askHumanHandler: (p: {
            questions: Array<{ id: string; question: string; type: string }>;
          }) => Promise<unknown>;
        };
      };
      const handler = createOptions.tools.askHumanHandler;

      // Observe the human-input frames via the cockpit channel (the chat
      // sseSender is only wired during an active run).
      const frames: SSEEvent[] = [];
      session.addCockpitSender((e) => frames.push(e));

      // Two asks in the same batch — under the old `human-${Date.now()}` both
      // parked under ONE key (same millisecond), so the first respond settled
      // the wrong promise.
      const p1 = handler({ questions: [{ id: 'q1', question: 'A?', type: 'text' }] });
      const p2 = handler({ questions: [{ id: 'q2', question: 'B?', type: 'text' }] });

      const humanFrames = frames.filter((f) => f.event === 'human-input');
      expect(humanFrames).toHaveLength(2);
      const ids = humanFrames.map((f) => (f.data as Record<string, unknown>).requestId as string);
      expect(ids[0]).not.toBe(ids[1]);
      for (const id of ids) {
        expect(id).toMatch(/^human-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      }
      // ③ additive full-list field: each frame carries its request in the
      // same shape as the single-request fields.
      expect((humanFrames[0].data as Record<string, unknown>).requests).toEqual([
        {
          requestId: ids[0],
          questions: [{ id: 'q1', question: 'A?', type: 'text' }],
          context: undefined,
        },
      ]);

      // Each id resolves exactly its own parked promise.
      expect(session.respondHumanInput(ids[0], { q1: { type: 'direct', value: 'A' } })).toBe(true);
      expect(session.respondHumanInput(ids[0], { q1: { type: 'direct', value: 'A' } })).toBe(false);
      expect(session.respondHumanInput(ids[1], { q2: { type: 'direct', value: 'B' } })).toBe(true);
      await expect(p1).resolves.toEqual({ q1: { type: 'direct', value: 'A' } });
      await expect(p2).resolves.toEqual({ q2: { type: 'direct', value: 'B' } });
    });
  });

  describe('session-title wiring (R2P-232, aligned Rust 2287cc1)', () => {
    it('late-binds the naming sink: a Phase-2 title upgrade lands on the cockpit stream + history with the minimal {title} payload', async () => {
      const mock = mockRunnerWithEvents();
      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      // The constructor wired the naming middleware's late-bound slot into
      // the runner (the TS analog of Rust's set_naming_event_sink).
      expect(mock.setSessionTitleListener).toHaveBeenCalledTimes(1);
      const sink = mock.setSessionTitleListener.mock.calls[0][0] as (t: string) => void;

      // Observe via the cockpit channel — the frame rides broadcast + rolling
      // history (the main-round done may close the chat SSE before the title
      // LLM resolves; Rust polls the session history for the same reason).
      const frames: SSEEvent[] = [];
      session.addCockpitSender((e) => frames.push(e));

      sink('修复登录问题');

      const titleFrames = frames.filter((f) => f.event === 'session-title');
      expect(titleFrames).toHaveLength(1);
      // 最小契约形状：载荷只有 title 键（与 Rust events.rs 的
      // session-title 帧及 ACP 翻译层逐字段一致）。
      expect(titleFrames[0].data).toEqual({ title: '修复登录问题' });
      expect(Object.keys(titleFrames[0].data as Record<string, unknown>)).toEqual(['title']);

      // Late subscribers still see it via history replay.
      const replayed: SSEEvent[] = [];
      session.addCockpitSender((e) => replayed.push(e));
      expect(replayed.some((f) => f.event === 'session-title')).toBe(true);
    });
  });

  describe('respondViaState (R2P-165② warm-state tier)', () => {
    /** State with two pending question interrupts (as colts persists them). */
    function seededState() {
      return {
        id: 'seeded',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [],
          stepCount: 0,
          createdAt: 0,
          updatedAt: 0,
          pendingInterrupts: [
            {
              request: {
                type: 'question',
                questions: [{ id: 'q1', question: 'A?', type: 'text' }],
                toolCallId: 'call-1',
              },
              createdAt: 1,
            },
            {
              request: {
                type: 'question',
                questions: [{ id: 'q2', question: 'B?', type: 'text' }],
                toolCallId: 'call-2',
              },
              createdAt: 2,
            },
          ],
        },
      };
    }

    async function createSessionWithSeed(seed: unknown) {
      const saveState = vi.fn();
      mockRunnerWithEvents([], seed);
      const session = await AgentSession.create(
        {
          sessionId: 'seeded',
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
          sessionStore: {
            loadState: vi.fn().mockResolvedValue(seed),
            loadDeliveries: vi.fn().mockResolvedValue([]),
            saveState,
            isDirBound: false,
          } as unknown as AgentSessionOptions['sessionStore'],
        },
        testConfig
      );
      return { session, saveState };
    }

    it('answers one of two pending interrupts, reports the remaining request, writes through', async () => {
      const { session, saveState } = await createSessionWithSeed(seededState());
      const outcome = await session.respondViaState('q1', {
        q1: { type: 'direct', value: 'A' },
      });
      expect(outcome.status).toBe('answered');
      expect(outcome.remaining).toHaveLength(1);
      expect(outcome.remaining[0].toolCallId).toBe('call-2');
      // Injection: tool result for call-1 is in history, call-2 stays pending.
      const state = session.getState();
      const toolMsg = state.context.messages.find(
        (m: { toolCallId?: string }) => m.toolCallId === 'call-1'
      );
      expect(toolMsg?.role).toBe('tool');
      expect(state.context.pendingInterrupts).toHaveLength(1);
      // Write-through to the session store (Rust 09b03af: waiting-state
      // injections must hit disk — memory-only answers roll back).
      expect(saveState).toHaveBeenCalledWith('seeded', state);
    });

    it('matches by tool-call id as well', async () => {
      const { session } = await createSessionWithSeed(seededState());
      const outcome = await session.respondViaState('call-1', {
        q1: { type: 'direct', value: 'A' },
      });
      expect(outcome.status).toBe('answered');
      expect(outcome.remaining[0].toolCallId).toBe('call-2');
    });

    it('empties the list when the last interrupt is answered (continuation may run)', async () => {
      const { session } = await createSessionWithSeed(seededState());
      await session.respondViaState('q1', { q1: { type: 'direct', value: 'A' } });
      const outcome = await session.respondViaState('call-2', {
        q2: { type: 'free-text', value: 'off-script' },
      });
      expect(outcome.status === 'answered' && outcome.remaining).toHaveLength(0);
      expect(session.getState().context.pendingInterrupts).toBeUndefined();
    });

    it('reports not-found for an unknown id', async () => {
      const { session } = await createSessionWithSeed(seededState());
      expect((await session.respondViaState('zzz', {})).status).toBe('not-found');
    });

    it('rejects garbage payloads before touching state (返修 P3)', async () => {
      const { session } = await createSessionWithSeed(seededState());
      const outcome = await session.respondViaState('q1', 'yes');
      expect(outcome.status).toBe('invalid');
      // State untouched: both interrupts still pending, no tool message.
      expect(session.getState().context.pendingInterrupts).toHaveLength(2);
    });

    it('holds a busy latch across the write-through — a concurrent turn cannot interleave (返修 P2-2)', async () => {
      // Park saveState mid-write: the stale-snapshot window the latch guards.
      let releaseSave!: () => void;
      const saveGate = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      const saveState = vi.fn().mockImplementation(async () => {
        await saveGate;
      });
      const seed = seededState();
      const mock = mockRunnerWithEvents([], seed);
      const session = await AgentSession.create(
        {
          sessionId: 'seeded',
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
          sessionStore: {
            loadState: vi.fn().mockResolvedValue(seed),
            loadDeliveries: vi.fn().mockResolvedValue([]),
            saveState,
            isDirBound: false,
          } as unknown as AgentSessionOptions['sessionStore'],
        },
        testConfig
      );

      const promise = session.respondViaState('q1', { q1: { type: 'direct', value: 'A' } });
      // Injection is in memory; the write is parked — the latch must be ON
      // (without it a turn that completes inside the window gets its afterRun
      // persistence rolled back by our late stale write).
      expect(session.busy).toBe(true);

      const events: SSEEvent[] = [];
      for await (const sse of session.handleMessage('hello')) events.push(sse);
      // Concurrent turn rejected with the standard busy error, NOT driven.
      expect(events).toEqual([
        { event: 'error', data: { message: 'Session is busy processing a message' } },
      ]);
      expect(mock.runner.run).not.toHaveBeenCalled();

      releaseSave();
      const outcome = await promise;
      expect(outcome.status).toBe('answered');
      expect(session.busy).toBe(false);
      // The write that landed is the injected snapshot; the rejected turn
      // left no trace on it.
      expect(saveState).toHaveBeenCalledTimes(1);
      const written = JSON.stringify(saveState.mock.calls[0][1]);
      expect(written).toContain('call-1');
      expect(written).not.toContain('hello');
    });
  });

  describe('truncateTurns (R2P-154a warm truncation path, aligned Rust 0a2cc4e/098adbd)', () => {
    /** 两轮会话（u1/a1 | u2/a2）+ todoList + 统计字段，磁盘与内存同形。 */
    function twoTurnState() {
      return {
        id: 'seeded',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [
            { role: 'user', content: 'u1' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'u2' },
            { role: 'assistant', content: 'a2' },
          ],
          stepCount: 3,
          createdAt: 0,
          updatedAt: 0,
          totalTokens: { input: 10, output: 4 },
          todoList: { items: [], nextId: 1 },
        },
      };
    }

    /** 带一个 pending 中断的种子（用于 park respondViaState 撑起 busy 闩锁）。 */
    function pendingInterruptState() {
      return {
        id: 'seeded',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [],
          stepCount: 0,
          createdAt: 0,
          updatedAt: 0,
          pendingInterrupts: [
            {
              request: {
                type: 'question',
                questions: [{ id: 'q1', question: 'A?', type: 'text' }],
                toolCallId: 'call-1',
              },
              createdAt: 1,
            },
          ],
        },
      };
    }

    async function createWarmSession(seed: unknown) {
      mockRunnerWithEvents([], seed);
      return AgentSession.create(
        {
          sessionId: 'seeded',
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
          sessionStore: {
            loadState: vi.fn().mockResolvedValue(seed),
            loadDeliveries: vi.fn().mockResolvedValue([]),
            saveState: vi.fn(),
            isDirBound: false,
          } as unknown as AgentSessionOptions['sessionStore'],
        },
        testConfig
      );
    }

    it('truncates on disk and reloads the truncated state into memory (anti-rollback)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'truncate-warm-'));
      const statePath = join(dir, 'state.json');
      const onDisk = twoTurnState();
      await writeFile(statePath, JSON.stringify(onDisk));
      try {
        // 温会话内存态与磁盘同形（最后一轮刚落定的形状）——没有内存重载
        // 的话,下一次消费轮取旧内存态、随 afterRun 落盘,截断被回滚。
        const session = await createWarmSession(onDisk);

        const out = await session.truncateTurns(statePath, 1);
        expect(out).toEqual({ ok: true, keptTurns: 1 });

        // 磁盘:一轮保留,todoList 删键,统计/计费不动。
        const disk = JSON.parse(await readFile(statePath, 'utf-8')) as {
          context: Record<string, unknown> & {
            messages: Array<{ content: string }>;
            totalTokens: { input: number; output: number };
          };
        };
        expect(disk.context.messages.map((m) => m.content)).toEqual(['u1', 'a1']);
        expect('todoList' in disk.context).toBe(false);
        expect(disk.context.totalTokens).toEqual({ input: 10, output: 4 });

        // 内存跟盘走（getState 反映截断态）。
        const memCtx = session.getState().context as Record<string, unknown> & {
          messages: Array<{ content: string }>;
        };
        expect(memCtx.messages.map((m) => m.content)).toEqual(['u1', 'a1']);
        expect('todoList' in memCtx).toBe(false);
        // 闩锁释放。
        expect(session.busy).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('keepTurns=0 empties messages — the emptied state stays a legal AgentState', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'truncate-warm-0'));
      const statePath = join(dir, 'state.json');
      const onDisk = twoTurnState();
      await writeFile(statePath, JSON.stringify(onDisk));
      try {
        const session = await createWarmSession(onDisk);
        const out = await session.truncateTurns(statePath, 0);
        expect(out).toEqual({ ok: true, keptTurns: 0 });
        const memCtx = session.getState().context as { messages: unknown[] };
        expect(memCtx.messages).toEqual([]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    // 评审 P3⑨：磁盘上 JSON 合法但形状畸形的 state（手改/半损，context 非
    // 对象）不能毒化内存——重载前最小形状校验,不合则跳过重载保旧内存,
    // 对齐 Rust load_state 的降级语义（截断本身照常成功落盘）。
    it('malformed on-disk context skips the memory reload and keeps the old in-memory state', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'truncate-warm-shape'));
      const statePath = join(dir, 'state.json');
      const good = twoTurnState();
      await writeFile(statePath, JSON.stringify({ ...good, context: 'corrupted-not-an-object' }));
      try {
        // 会话创建时内存是好态；磁盘在会话存活期间被手改/半损成畸形
        // context（JSON 合法、形状不合法）。
        const session = await createWarmSession(good);

        const out = await session.truncateTurns(statePath, 1);
        expect(out).toEqual({ ok: true, keptTurns: 0 });

        // 内存保旧:仍是创建时的好态,未被畸形磁盘态覆盖。
        const memCtx = session.getState().context as { messages: Array<{ content: string }> };
        expect(memCtx.messages.map((m) => m.content)).toEqual(['u1', 'a1', 'u2', 'a2']);
        // 磁盘照常被截断流程改写(畸形 context 原样序列化回去)。
        const disk = JSON.parse(await readFile(statePath, 'utf-8')) as { context: unknown };
        expect(disk.context).toBe('corrupted-not-an-object');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('reports 404 when the state file is missing', async () => {
      const session = await createWarmSession(twoTurnState());
      const out = await session.truncateTurns(join(tmpdir(), 'no-such-state.json'), 1);
      expect(out).toEqual({ ok: false, code: 404, error: 'Session state not found' });
    });

    it('reports 409 without touching disk when the session is busy (latch guard)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'truncate-warm-busy'));
      const statePath = join(dir, 'state.json');
      const onDisk = twoTurnState();
      await writeFile(statePath, JSON.stringify(onDisk));
      try {
        // Park respondViaState 的写穿盘 —— busy 闩锁被撑起。
        let releaseSave!: () => void;
        const saveGate = new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
        const seed = pendingInterruptState();
        mockRunnerWithEvents([], seed);
        const session = await AgentSession.create(
          {
            sessionId: 'seeded',
            workspacePath: '/tmp/test',
            agentName: 'test',
            runtime: defaultNodeHostEnv,
            llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
            sessionStore: {
              loadState: vi.fn().mockResolvedValue(seed),
              loadDeliveries: vi.fn().mockResolvedValue([]),
              saveState: vi.fn().mockImplementation(async () => {
                await saveGate;
              }),
              isDirBound: false,
            } as unknown as AgentSessionOptions['sessionStore'],
          },
          testConfig
        );
        const parked = session.respondViaState('q1', { q1: { type: 'direct', value: 'A' } });
        expect(session.busy).toBe(true);

        const out = await session.truncateTurns(statePath, 1);
        expect(out).toEqual({ ok: false, code: 409, error: 'Session is busy' });
        // 磁盘原样未动。
        const disk = JSON.parse(await readFile(statePath, 'utf-8')) as {
          context: { messages: unknown[] };
        };
        expect(disk.context.messages).toHaveLength(4);

        releaseSave();
        await parked;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('assertResumableState guard passthrough (R2P-165④)', () => {
    const PENDING_MSG =
      'Unanswered tool call(s) on the last assistant message: call-1 ' +
      '(pending human interrupt — answer it via respond() + removePendingInterrupt() before resuming). ' +
      'Answer the pending interrupts and inject their tool results before calling run().';
    const DANGLING_MSG =
      'Unanswered tool call(s) on the last assistant message: call-9 ' +
      '(no tool result, not approved, not pending — dangling tool_call; the provider would reject the next call with 400). ' +
      'Answer the pending interrupts and inject their tool results before calling run().';

    it.each([
      ['pending-interrupt tier', PENDING_MSG],
      ['dangling tool_call tier', DANGLING_MSG],
    ])('surfaces the %s error text verbatim on the SSE error frame', async (_name, message) => {
      // colts run() throws assertResumableState errors into its catch, which
      // emits an `error` event (daemon maps it 1:1) before the error result.
      mockRunnerWithEvents([['error', { error: { message } }]]);

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const events: SSEEvent[] = [];
      for await (const sse of session.handleMessage('hello')) events.push(sse);

      const errorFrame = events.find((e) => e.event === 'error');
      expect(errorFrame).toBeDefined();
      // 原样透传：两档文案（先应答再续跑 / 悬挂 tool_call provider 400）
      // 到达前端，可诊断。
      expect((errorFrame!.data as { message: string }).message).toBe(message);
    });
  });

  describe('AgentSessionOptions', () => {
    it('accepts new EnhancedRunner parameters', () => {
      const options: AgentSessionOptions = {
        workspacePath: '/tmp/test',
        agentName: 'test',
        runtime: defaultNodeHostEnv,
        builtinTools: { shell: false, fileRead: true },
        enableSession: false,
        enableTodolist: false,
        enableCommands: true,
        sandbox: false,
        thinkingEnabled: false,
        a2ui: { enabled: true },
      };
      expect(options.builtinTools!.shell).toBe(false);
      expect(options.enableSession).toBe(false);
      expect(options.sandbox).toBe(false);
      expect(options.a2ui!.enabled).toBe(true);
    });
  });

  describe('handleMessage() options parameter', () => {
    let session: AgentSession;
    let runnerEmit: (type: string, ...args: unknown[]) => void;

    beforeEach(async () => {
      const mock = createMockRunner({
        run: vi.fn().mockImplementation(async () => {
          // Simulate the runner emitting a `complete` event, then resolving.
          runnerEmit('complete');
          return {
            state: {
              id: 'test-state',
              config: { name: 'test', instructions: '', tools: [] },
              context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
            },
            result: {
              type: 'success',
              answer: '',
              totalSteps: 1,
              tokens: { input: 0, output: 0 },
            },
          };
        }),
      });
      runnerEmit = mock.emit;
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);
      session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );
    });

    it('accepts options parameter with thinkingEnabled', async () => {
      const events: SSEEvent[] = [];
      for await (const event of session.handleMessage('hello', { thinkingEnabled: true })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('done');
      expect(events[0].data).toHaveProperty('timestamp');
    });

    it('accepts options parameter without thinkingEnabled', async () => {
      const events: SSEEvent[] = [];
      for await (const event of session.handleMessage('hello', {})) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('done');
      expect(events[0].data).toHaveProperty('timestamp');
    });

    it('handles undefined options parameter', async () => {
      const events: SSEEvent[] = [];
      for await (const event of session.handleMessage('hello', undefined)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('done');
      expect(events[0].data).toHaveProperty('timestamp');
    });

    it('passes thinkingEnabled option to runner when provided', async () => {
      const mock = createMockRunner({
        run: vi.fn().mockImplementation(async () => {
          mock.emit('complete');
          return {
            state: {
              id: 'test-state',
              config: { name: 'test', instructions: '', tools: [] },
              context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
            },
            result: {
              type: 'success',
              answer: '',
              totalSteps: 1,
              tokens: { input: 0, output: 0 },
            },
          };
        }),
      });
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);

      const testSession = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      // Consume the stream
      for await (const _ of testSession.handleMessage('hello', { thinkingEnabled: true })) {
        // drain
      }

      // Verify run was called with thinkingEnabled
      expect(mock.runner.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          thinkingEnabled: true,
        })
      );
    });

    it('omits thinkingEnabled from runner options when not provided', async () => {
      const mock = createMockRunner({
        run: vi.fn().mockImplementation(async () => {
          mock.emit('complete');
          return {
            state: {
              id: 'test-state',
              config: { name: 'test', instructions: '', tools: [] },
              context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
            },
            result: {
              type: 'success',
              answer: '',
              totalSteps: 1,
              tokens: { input: 0, output: 0 },
            },
          };
        }),
      });
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);

      const testSession = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      // Consume the stream without options
      for await (const _ of testSession.handleMessage('hello')) {
        // drain
      }

      // Verify run was called without thinkingEnabled
      expect(mock.runner.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
      const callOptions = mock.runner.run.mock.calls[0][1] as Record<string, unknown>;
      expect(callOptions.thinkingEnabled).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Idle-TTL activity touch (R2P-121, mirrors Rust Session::touch being
  // called at every turn-drive entry): driveTurn is the shared choke
  // point for handleMessage and continueRun, so ONE touch there covers
  // every turn start. The SessionManager uses this timestamp to decide
  // warm→cold eviction — a session with recent turn activity must not be
  // evicted even if its registration is older than the TTL.
  // ────────────────────────────────────────────────────────────────────
  describe('idle-TTL activity touch (R2P-121)', () => {
    it('handleMessage (turn start) touches sessionManager activity with the session id', async () => {
      mockRunnerWithEvents();
      const touchAgentSession = vi.fn();
      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          sessionId: 'touch-target',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
          sessionManager: { getStatus: vi.fn().mockReturnValue('idle'), touchAgentSession },
        },
        testConfig
      );

      const events: SSEEvent[] = [];
      for await (const sse of session.handleMessage('hello')) events.push(sse);
      expect(events.some((e) => e.event === 'done')).toBe(true);

      // Turn start = activity: touched exactly once with the session id.
      expect(touchAgentSession).toHaveBeenCalledTimes(1);
      expect(touchAgentSession).toHaveBeenCalledWith('touch-target');
    });

    it('continueRun (respond continuation) also goes through driveTurn and touches', async () => {
      mockRunnerWithEvents();
      const touchAgentSession = vi.fn();
      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          sessionId: 'cont-target',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
          sessionManager: { getStatus: vi.fn().mockReturnValue('idle'), touchAgentSession },
        },
        testConfig
      );

      for await (const _ of session.continueRun()) {
        // drain
      }
      expect(touchAgentSession).toHaveBeenCalledWith('cont-target');
    });

    it('a rejected (busy) turn does not touch again — the in-flight turn already did', async () => {
      mockRunnerWithEvents();
      const touchAgentSession = vi.fn();
      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          sessionId: 'busy-target',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
          sessionManager: { getStatus: vi.fn().mockReturnValue('running'), touchAgentSession },
        },
        testConfig
      );

      // First turn: drives (touches once), completes.
      for await (const _ of session.handleMessage('first')) {
        // drain
      }
      expect(touchAgentSession).toHaveBeenCalledTimes(1);

      // Simulate an in-flight turn: busy → the busy rejection path yields
      // an error WITHOUT entering driveTurn, so no second touch.
      (session as unknown as { _busy: boolean })._busy = true;
      const events: SSEEvent[] = [];
      for await (const sse of session.handleMessage('second')) events.push(sse);
      expect(events).toEqual([
        { event: 'error', data: { message: 'Session is busy processing a message' } },
      ]);
      expect(touchAgentSession).toHaveBeenCalledTimes(1);
    });

    it('no sessionManager injected → no touch, no crash (old hosts keep working)', async () => {
      mockRunnerWithEvents();
      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const events: SSEEvent[] = [];
      for await (const sse of session.handleMessage('hello')) events.push(sse);
      expect(events.some((e) => e.event === 'done')).toBe(true);
    });

    it('a getStatus-only sessionManager stub (no touchAgentSession) keeps working', async () => {
      mockRunnerWithEvents();
      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
          sessionManager: { getStatus: vi.fn().mockReturnValue('idle') },
        },
        testConfig
      );

      const events: SSEEvent[] = [];
      for await (const sse of session.handleMessage('hello')) events.push(sse);
      expect(events.some((e) => e.event === 'done')).toBe(true);
    });
  });

  describe('AgentSession.create()', () => {
    const baseOptions: AgentSessionOptions = {
      workspacePath: '/tmp/test-workspace',
      agentName: 'test-agent',
      runtime: defaultNodeHostEnv,
      llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
    };

    beforeEach(() => {
      mockEnhancedRunnerCreate.mockClear();
    });

    it('passes default sandbox={enabled:true} to EnhancedRunner', async () => {
      await AgentSession.create(baseOptions, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ sandbox: { enabled: true } })
      );
    });

    it('passes sandbox={enabled:false} when explicitly set', async () => {
      await AgentSession.create({ ...baseOptions, sandbox: false }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ sandbox: { enabled: false } })
      );
    });

    it('passes builtinTools whitelist to EnhancedRunner via tools.builtinFilter', async () => {
      const builtinFilter = { shell: false, fileRead: true };
      await AgentSession.create({ ...baseOptions, tools: { builtinFilter } }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ tools: expect.objectContaining({ builtinFilter }) })
      );
    });

    it('passes session/todolist/commands enabled=false to EnhancedRunner', async () => {
      await AgentSession.create(
        {
          ...baseOptions,
          session: { enabled: false },
          todolist: { enabled: false },
          commands: { enabled: false },
        },
        testConfig
      );
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({ enabled: false }),
          todolist: { enabled: false },
          commands: { enabled: false },
        })
      );
    });

    it('defaults session/todolist/commands enabled to true', async () => {
      await AgentSession.create(baseOptions, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({ enabled: true }),
          todolist: { enabled: true },
          commands: { enabled: true },
          specPlan: { enabled: true },
        })
      );
    });

    it('passes thinking.enabled=false when explicitly set', async () => {
      await AgentSession.create({ ...baseOptions, thinking: { enabled: false } }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ thinking: { enabled: false } })
      );
    });

    it('passes a2ui option to EnhancedRunner', async () => {
      const a2ui = { enabled: true };
      await AgentSession.create({ ...baseOptions, a2ui }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(expect.objectContaining({ a2ui }));
    });

    it('passes workspacePath and skills/tools groups to EnhancedRunner', async () => {
      const skillDirs = ['/tmp/skills'];
      const mcpConfigPaths = ['/tmp/mcp.json'];
      await AgentSession.create(
        { ...baseOptions, skills: { dirs: skillDirs }, tools: { mcpConfigPaths } },
        testConfig
      );
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath: '/tmp/test-workspace',
          // provider is also passed through; assert only the dirs passthrough
          skills: expect.objectContaining({ dirs: skillDirs }),
          tools: expect.objectContaining({ mcpConfigPaths }),
        })
      );
    });

    it('passes empty tools.mcpConfigPaths when unset', async () => {
      await AgentSession.create(baseOptions, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ tools: expect.objectContaining({ mcpConfigPaths: [] }) })
      );
    });

    it('passes subAgents to EnhancedRunner when provided (crew session)', async () => {
      const subAgents = [
        {
          name: 'researcher',
          description: 'research helper',
          config: { name: 'researcher', instructions: 'be helpful', tools: [] },
        },
      ];
      await AgentSession.create({ ...baseOptions, subAgents }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ delegation: { subAgents } })
      );
    });

    it('passes crewId to EnhancedRunner when provided (crew session)', async () => {
      await AgentSession.create({ ...baseOptions, crewId: 'demo-crew' }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ crewId: 'demo-crew' })
      );
    });

    it('passes limits to EnhancedRunner when provided', async () => {
      const limits = { maxInputLength: 50000, maxSteps: 20, toolTimeout: 30000 };
      await AgentSession.create({ ...baseOptions, limits }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(expect.objectContaining({ limits }));
    });

    it('omits limits when not provided', async () => {
      await AgentSession.create(baseOptions, testConfig);
      const call = mockEnhancedRunnerCreate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(call.limits).toBeUndefined();
    });

    it('omits subAgents and crewId for non-crew session (backward compat)', async () => {
      await AgentSession.create(baseOptions, testConfig);
      const call = mockEnhancedRunnerCreate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(call.subAgents).toBeUndefined();
      expect(call.crewId).toBeUndefined();
    });
  });

  describe('handleMessage() maxInputLength enforcement', () => {
    it('yields error event and returns when message exceeds maxInputLength', async () => {
      // Set up a runner mock — it should NOT be called because the message
      // is rejected before runner.run().
      const mock = createMockRunner({
        run: vi.fn().mockResolvedValue({
          state: {
            id: 'test-state',
            config: { name: 'test', instructions: '', tools: [] },
            context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
          },
          result: { type: 'success', answer: '', totalSteps: 0, tokens: { input: 0, output: 0 } },
        }),
      });
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          limits: { maxInputLength: 100 },
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const longMessage = 'x'.repeat(101);
      const events: SSEEvent[] = [];
      for await (const event of session.handleMessage(longMessage)) {
        events.push(event);
      }

      // Should yield exactly one error event
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('error');
      expect((events[0].data as { message: string }).message).toContain('maximum length of 100');
      expect((events[0].data as { message: string }).message).toContain('got 101');

      // Runner must not have been invoked — message rejected before LLM call
      expect(mock.runner.run).not.toHaveBeenCalled();

      // busy flag must reset so subsequent messages can proceed
      expect(session.busy).toBe(false);
    });

    it('passes message to runner when under maxInputLength', async () => {
      const mock = createMockRunner({
        run: vi.fn().mockImplementation(async () => {
          mock.emit('complete');
          return {
            state: {
              id: 'test-state',
              config: { name: 'test', instructions: '', tools: [] },
              context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
            },
            result: { type: 'success', answer: '', totalSteps: 1, tokens: { input: 0, output: 0 } },
          };
        }),
      });
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          limits: { maxInputLength: 100 },
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const events: SSEEvent[] = [];
      for await (const event of session.handleMessage('short message')) {
        events.push(event);
      }

      // Should reach the runner and emit done
      expect(mock.runner.run).toHaveBeenCalledTimes(1);
      expect(events.some((e) => e.event === 'done')).toBe(true);
    });

    it('does not enforce limit when maxInputLength is undefined', async () => {
      const mock = createMockRunner({
        run: vi.fn().mockImplementation(async () => {
          mock.emit('complete');
          return {
            state: {
              id: 'test-state',
              config: { name: 'test', instructions: '', tools: [] },
              context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
            },
            result: { type: 'success', answer: '', totalSteps: 1, tokens: { input: 0, output: 0 } },
          };
        }),
      });
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const events: SSEEvent[] = [];
      for await (const event of session.handleMessage('x'.repeat(100000))) {
        events.push(event);
      }

      expect(mock.runner.run).toHaveBeenCalledTimes(1);
      expect(events.some((e) => e.event === 'done')).toBe(true);
    });
  });

  describe('handleMessage() concurrency guard', () => {
    let session: AgentSession;

    it('rejects concurrent handleMessage with error event', async () => {
      let resolveFirst: () => void;
      const mock = createMockRunner({
        run: vi.fn().mockImplementation(async () => {
          // Block until resolveFirst() is called, simulating a long-running agent round.
          await new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
          mock.emit('complete');
          return {
            state: {
              id: 'test-state',
              config: { name: 'test', instructions: '', tools: [] },
              context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
            },
            result: {
              type: 'success',
              answer: '',
              totalSteps: 1,
              tokens: { input: 0, output: 0 },
            },
          };
        }),
      });
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);

      session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      // Start first message (blocks until resolveFirst is called)
      const firstIter = session.handleMessage('first');
      const firstPromise = firstIter[Symbol.asyncIterator]().next();

      // Yield to let the stream start
      await new Promise((r) => setTimeout(r, 10));

      // Second message should immediately yield error
      const secondEvents: SSEEvent[] = [];
      for await (const event of session.handleMessage('second')) {
        secondEvents.push(event);
      }

      expect(secondEvents).toHaveLength(1);
      expect(secondEvents[0].event).toBe('error');
      expect((secondEvents[0].data as { message: string }).message).toContain('busy');

      // Unblock the first stream
      resolveFirst!();
      await firstPromise;
    });

    it('allows sequential messages after first completes', async () => {
      let callCount = 0;
      const mock = createMockRunner({
        run: vi.fn().mockImplementation(async () => {
          callCount += 1;
          // Emit a distinct token per call, then complete.
          mock.emit('token', { token: callCount === 1 ? 'a' : 'b' });
          mock.emit('complete');
          return {
            state: {
              id: callCount === 1 ? 's1' : 's2',
              config: { name: 'test', instructions: '', tools: [] },
              context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
            },
            result: {
              type: 'success',
              answer: '',
              totalSteps: 1,
              tokens: { input: 0, output: 0 },
            },
          };
        }),
      });
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);

      session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const events1: SSEEvent[] = [];
      for await (const event of session.handleMessage('first')) {
        events1.push(event);
      }

      const events2: SSEEvent[] = [];
      for await (const event of session.handleMessage('second')) {
        events2.push(event);
      }

      expect(events1.some((e) => e.event === 'done')).toBe(true);
      expect(events2.some((e) => e.event === 'done')).toBe(true);
    });

    it('busy flag resets after stream completes', async () => {
      const mock = createMockRunner({
        run: vi.fn().mockImplementation(async () => {
          mock.emit('complete');
          return {
            state: {
              id: 'test-state',
              config: { name: 'test', instructions: '', tools: [] },
              context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
            },
            result: {
              type: 'success',
              answer: '',
              totalSteps: 1,
              tokens: { input: 0, output: 0 },
            },
          };
        }),
      });
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);

      session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      expect(session.busy).toBe(false);

      // Consume entire stream
      for await (const _ of session.handleMessage('hello')) {
        // just drain
      }

      expect(session.busy).toBe(false);
    });
  });

  describe('cockpit event forwarding', () => {
    it('forwards all mapped events to cockpit during handleMessage', async () => {
      mockRunnerWithEvents([['token', { token: 'hi' }], ['complete']]);

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const cockpitEvents: SSEEvent[] = [];
      session.addCockpitSender((event) => cockpitEvents.push(event));

      for await (const _ of session.handleMessage('hello')) {
        // drain
      }

      const eventTypes = cockpitEvents.map((e) => e.event);
      expect(eventTypes).toContain('token');
      expect(eventTypes).toContain('done');
    });

    it('sends agent-diagnostics to cockpit after round completes', async () => {
      mockRunnerWithEvents([['complete']], {
        id: 'test-state',
        config: { name: 'test', instructions: '', tools: [] },
        context: { messages: [], stepCount: 5, createdAt: 0, updatedAt: 0 },
      });

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const cockpitEvents: SSEEvent[] = [];
      session.addCockpitSender((event) => cockpitEvents.push(event));

      for await (const _ of session.handleMessage('hello')) {
        // drain
      }

      // Filter to agent-diagnostics events; the last one is from sendStateSnapshot after round completes
      const diagEvents = cockpitEvents.filter((e) => e.event === 'agent-diagnostics');
      expect(diagEvents.length).toBeGreaterThanOrEqual(1);
      const data = diagEvents[diagEvents.length - 1].data as Record<string, unknown>;
      expect((data.agent as Record<string, unknown>).id).toBe('test-state');
      expect(
        ((data.agent as Record<string, unknown>).context as Record<string, unknown>).stepCount
      ).toBe(5);
    });

    async function captureLastDiagnostics(
      finalState: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
      mockRunnerWithEvents([['complete']], finalState);

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const cockpitEvents: SSEEvent[] = [];
      session.addCockpitSender((event) => cockpitEvents.push(event));

      for await (const _ of session.handleMessage('hello')) {
        // drain
      }

      const diagEvents = cockpitEvents.filter((e) => e.event === 'agent-diagnostics');
      return diagEvents[diagEvents.length - 1].data as Record<string, unknown>;
    }

    it('includes session.overview in diagnostics', async () => {
      const data = await captureLastDiagnostics({
        id: 'test-state',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [{ role: 'user', content: 'hi' }],
          stepCount: 3,
          createdAt: 0,
          updatedAt: 0,
          totalTokens: { input: 100, output: 50 },
        },
      });

      const overview = (data.session as Record<string, Record<string, unknown>>).overview;
      expect(overview.agentName).toBe('test');
      expect(overview.model).toBe('test-model');
      expect(overview.stepCount).toBe(3);
      expect(overview.messageCount).toBe(1);
      expect(overview.tokensIn).toBe(100);
      expect(overview.tokensOut).toBe(50);
      expect(overview.tokensTotal).toBe(150);
      expect(overview.status).toBe('idle');
    });

    it('includes session.info in diagnostics', async () => {
      const data = await captureLastDiagnostics({
        id: 'test-state',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [{ role: 'user', content: 'hi' }],
          stepCount: 3,
          createdAt: 0,
          updatedAt: 0,
          totalTokens: { input: 100, output: 50 },
        },
      });

      const info = (data.session as Record<string, Record<string, unknown>>).info;
      expect(info.sessionId).toBe('test-state');
      expect(info.agentName).toBe('test');
      expect(info.model).toBe('test-model');
      expect(info.workspacePath).toBe('/tmp/test');
      expect(info.tokensIn).toBe(100);
    });

    it('forwards emitCockpitEvent to all registered senders (multicast)', async () => {
      mockRunnerWithEvents([['complete']]);

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const senderA: SSEEvent[] = [];
      const senderB: SSEEvent[] = [];
      session.addCockpitSender((event) => senderA.push(event));
      session.addCockpitSender((event) => senderB.push(event));

      // Drain the initial diagnostics replay so it doesn't pollute assertions.
      await new Promise((r) => setTimeout(r, 10));
      senderA.length = 0;
      senderB.length = 0;

      session.emitCockpitEvent({ event: 'ping', data: { x: 1 } });

      // Both senders must receive the event — single-sender slot would have dropped A.
      expect(senderA.some((e) => e.event === 'ping')).toBe(true);
      expect(senderB.some((e) => e.event === 'ping')).toBe(true);
    });

    it('removing one cockpit sender does not affect others', async () => {
      mockRunnerWithEvents([['complete']]);

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const senderA: SSEEvent[] = [];
      const senderB: SSEEvent[] = [];
      const removeA = session.addCockpitSender((event) => senderA.push(event));
      session.addCockpitSender((event) => senderB.push(event));

      // Drain the initial diagnostics replay so it doesn't pollute assertions.
      await new Promise((r) => setTimeout(r, 10));
      senderA.length = 0;
      senderB.length = 0;

      // Disconnect A only.
      removeA();
      session.emitCockpitEvent({ event: 'ping', data: { n: 1 } });

      expect(senderA.length).toBe(0);
      expect(senderB.some((e) => e.event === 'ping')).toBe(true);
    });

    it('does not forward events after cockpitSender cleared', async () => {
      mockRunnerWithEvents([['token', { token: 'hi' }], ['complete']]);

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const cockpitEvents: SSEEvent[] = [];
      // Register then immediately unregister before the async diagnostics
      // snapshot lands. With proper disposer semantics, neither the pending
      // diagnostics nor any subsequent stream events should arrive.
      const remove = session.addCockpitSender((event) => cockpitEvents.push(event));
      remove();

      for await (const _ of session.handleMessage('hello')) {
        // drain
      }

      expect(cockpitEvents.length).toBe(0);
    });

    async function captureRunnerDiagnostics(): Promise<Record<string, unknown>> {
      mockRunnerWithEvents(
        [['complete']],
        {
          id: 'test-state',
          config: { name: 'test', instructions: '', tools: [] },
          context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
        },
        {
          getToolInfo: vi
            .fn()
            .mockReturnValue([
              { name: 'file_read', description: 'Read files', type: 'builtin', enabled: true },
            ]),
          getSkillInfo: vi
            .fn()
            .mockReturnValue([
              { name: 'spec-plan', description: 'Plan specs', source: '/skills/spec-plan' },
            ]),
          getConfig: vi.fn().mockReturnValue({
            model: 'test-model',
            sandbox: true,
            thinkingEnabled: false,
            enablePromptThinking: false,
            a2ui: { enabled: true },
            compressorEnabled: true,
            enableSession: true,
            enableTodolist: false,
            enableCommands: true,
          }),
        }
      );

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const cockpitEvents: SSEEvent[] = [];
      session.addCockpitSender((event) => cockpitEvents.push(event));

      for await (const _ of session.handleMessage('hello')) {
        // drain
      }

      const diagEvents = cockpitEvents.filter((e) => e.event === 'agent-diagnostics');
      return (diagEvents[diagEvents.length - 1].data as Record<string, unknown>).runner as Record<
        string,
        unknown
      >;
    }

    it('includes runner.feature flags in diagnostics', async () => {
      const runner = await captureRunnerDiagnostics();
      const features = runner.features as Record<string, unknown>;
      expect(features.sandbox).toBe(true);
      expect(features.thinkingEnabled).toBe(false);
      expect(features.enablePromptThinking).toBe(false);
      expect(features.a2uiEnabled).toBe(true);
      expect(features.compressorEnabled).toBe(true);
      expect(features.enableSession).toBe(true);
      expect(features.enableTodolist).toBe(false);
      expect(features.enableCommands).toBe(true);
    });

    it('includes runner.tools in diagnostics', async () => {
      const runner = await captureRunnerDiagnostics();
      expect(runner.tools).toEqual([
        { name: 'file_read', description: 'Read files', type: 'builtin', enabled: true },
      ]);
    });

    it('includes runner.skills in diagnostics', async () => {
      const runner = await captureRunnerDiagnostics();
      expect(runner.skills).toEqual([
        { name: 'spec-plan', description: 'Plan specs', source: '/skills/spec-plan' },
      ]);
    });

    it('handles missing a2ui config gracefully in features', async () => {
      mockRunnerWithEvents([['complete']], undefined, {
        getConfig: vi.fn().mockReturnValue({ model: 'test-model' }),
      });

      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const cockpitEvents: SSEEvent[] = [];
      session.addCockpitSender((event) => cockpitEvents.push(event));

      for await (const _ of session.handleMessage('hello')) {
        // drain
      }

      const diagEvents = cockpitEvents.filter((e) => e.event === 'agent-diagnostics');
      const data = diagEvents[diagEvents.length - 1].data as Record<string, unknown>;
      const features = (data.runner as Record<string, unknown>).features as Record<string, unknown>;
      expect(features.a2uiEnabled).toBe(false);
    });
  });

  describe('AgentSession.resume()', () => {
    it('returns an AgentSession with runner and state from EnhancedRunner.resume()', async () => {
      const session = await AgentSession.resume(
        '/tmp/session-123',
        {
          sessionId: 'session-123',
          workspacePath: '/tmp/workspace',
          agentName: 'resumed-agent',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      expect(session).toBeInstanceOf(AgentSession);
      expect(session.sessionId).toBe('session-123');
      expect(session.agentName).toBe('resumed-agent');
      expect(session.getState().id).toBe('resumed-state-id');
      expect(mockEnhancedRunnerResume).toHaveBeenCalledWith(
        '/tmp/session-123',
        expect.objectContaining({
          llm: expect.objectContaining({ client: expect.any(Object) }),
          askHumanHandler: expect.any(Function),
        })
      );
    });

    it('re-throws errors from EnhancedRunner.resume()', async () => {
      mockEnhancedRunnerResume.mockRejectedValueOnce(new Error('Session not found'));

      await expect(
        AgentSession.resume(
          '/tmp/missing',
          {
            sessionId: 'missing',
            workspacePath: '/tmp/workspace',
            agentName: 'test',
            runtime: defaultNodeHostEnv,
            llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
          },
          testConfig
        )
      ).rejects.toThrow('Session not found');
    });

    it('passes subAgents through to EnhancedRunner.resume() when provided', async () => {
      mockEnhancedRunnerResume.mockClear();
      const subAgents = [
        {
          name: 'researcher',
          description: 'research helper',
          config: { name: 'researcher', instructions: 'be helpful', tools: [] },
        },
      ];

      await AgentSession.resume(
        '/tmp/crew-session',
        {
          sessionId: 'crew-session',
          workspacePath: '/tmp/workspace',
          agentName: 'orchestrator',
          runtime: defaultNodeHostEnv,
          subAgents,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      expect(mockEnhancedRunnerResume).toHaveBeenCalledWith(
        '/tmp/crew-session',
        expect.objectContaining({ subAgents })
      );
    });

    it('omits subAgents on resume when not provided (non-crew session)', async () => {
      mockEnhancedRunnerResume.mockClear();

      await AgentSession.resume(
        '/tmp/plain-session',
        {
          sessionId: 'plain-session',
          workspacePath: '/tmp/workspace',
          agentName: 'plain-agent',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      const call = mockEnhancedRunnerResume.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(call.subAgents).toBeUndefined();
    });
  });

  // ─── 会话级事件通道（R2P-122，P2-b seq 的结构前提）────────────────────
  //
  // 对齐 Rust session/live.rs 的 emit：唯一写入点「先落史后广播」——
  // 落下的史就是广播的帧（同一序号空间）。本批裁剪：seq 只在 HistoryEntry
  // 里自增保留，不上 SSE 线协议（那是 P2-b）。
  describe('session event channel (R2P-122)', () => {
    /** 最小 finalState（mockRunnerWithEvents 的默认同形）。 */
    const turnFinalState = {
      id: 'test-state',
      config: { name: 'test', instructions: '', tools: [] },
      context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
    };

    /**
     * 多轮 runner：run() 每被调用一次，弹出一个「事件脚本」逐帧发射后
     * 返回终态——同会话跨轮订正事件序列用。
     */
    function mockRunnerWithScripts(scripts: Array<Array<[string, unknown?]>>) {
      const queue = [...scripts];
      const mock = createMockRunner({
        run: vi.fn().mockImplementation(async () => {
          const script = queue.shift() ?? [['complete']];
          for (const [type, payload] of script) {
            if (payload === undefined) mock.emit(type);
            else mock.emit(type, payload);
          }
          return {
            state: turnFinalState,
            result: { type: 'success', answer: '', totalSteps: 1, tokens: { input: 0, output: 0 } },
          };
        }),
      });
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);
      return mock;
    }

    async function createChannelSession() {
      return AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          sessionId: 'channel-test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );
    }

    it('records history BEFORE broadcast — the landed frame is the broadcast frame (shared seq space)', async () => {
      mockRunnerWithScripts([[['token', { token: 'a' }], ['token', { token: 'b' }], ['complete']]]);
      const session = await createChannelSession();

      const received: HistoryEntry[] = [];
      const detach = session.subscribe((entry) => {
        received.push(entry);
        // 先落史后广播：订阅者收到本帧的此刻，滚动历史已含本帧且恰为末帧
        // （同步实现下无时序窗——落史失败的广播不发生）。
        const hist = session.historySnapshot();
        expect(hist[hist.length - 1]).toEqual(entry);
      });

      const events: SSEEvent[] = [];
      for await (const sse of session.handleMessage('hello')) events.push(sse);
      detach();

      // 订阅者收到的与历史一致（同对象、同序）。
      expect(received).toEqual(session.historySnapshot());
      // seq 会话内单调递增，从 1 起（对齐 Rust frame_seq 的 fetch_add+1）。
      expect(received.map((e) => e.seq)).toEqual([1, 2, 3]);
      // R2P-151：seq 上线协议——订阅回调不再剥 seq，wire 帧 data 含 seq
      // （对齐 Rust frame_to_sse 的注入形状：seq 进 data 对象）。信封仍是
      // event/data 两键，seq 住在 data 里。
      expect(events).toEqual(
        received.map((e) => ({ event: e.event, data: { ...e.data, seq: e.seq } }))
      );
      for (const sse of events) {
        expect(Object.keys(sse).sort()).toEqual(['data', 'event']);
      }
      expect(events.map((e) => (e.data as { seq: number }).seq)).toEqual([1, 2, 3]);
      expect((events[0].data as { seq: number }).seq).toBe(1, '首帧 seq=1');
      // turnSeq 只进 done 帧——过程帧不带（轮次归属是终帧契约）。
      expect('turnSeq' in (events[0].data as object)).toBe(false);
    });

    it('subscriber receives increments from attach — pre-attach history is NOT replayed', async () => {
      mockRunnerWithScripts([
        [['token', { token: 'turn-one' }], ['complete']],
        [['token', { token: 'turn-two' }], ['complete']],
      ]);
      const session = await createChannelSession();

      // 第一轮：历史里落下 2 帧（token + done），订阅者尚未 attach。
      for await (const _ of session.handleMessage('first')) {
        // drain
      }
      const historyAfterTurnOne = session.historySnapshot();
      expect(historyAfterTurnOne.length).toBe(2);

      // attach 后第二轮：只收增量（不重放第一轮）。
      const received: HistoryEntry[] = [];
      const detach = session.subscribe((entry) => received.push(entry));
      const wire: SSEEvent[] = [];
      for await (const sse of session.handleMessage('second')) {
        wire.push(sse);
      }
      detach();

      expect(received.length).toBe(2);
      expect(received[0].seq).toBe(3, 'seq 续前轮单调，不重置');
      const deltas = received.map((e) => (e.data as { delta?: string }).delta);
      expect(deltas).toEqual(['turn-two', undefined], 'no replay of turn-one token');
      // 全史 = 第一轮 2 帧 + 第二轮 2 帧，seq 连续。
      const full = session.historySnapshot();
      expect(full.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
      // 跨轮 wire 级单调（R2P-151）：本轮 data.seq 续前轮，不重置。
      expect(wire.map((e) => (e.data as { seq: number }).seq)).toEqual([3, 4]);
    });

    it('rolling history drops the OLDEST beyond HISTORY_CAP (aligned with Rust live.rs)', async () => {
      // 一轮猛吐 HISTORY_CAP + 2 个 token（+1 done）——历史封顶在
      // HISTORY_CAP，最旧的 3 帧被丢。500k 突发只走推入侧（同步突发
      // ~百毫秒级）；per-request 队列的 shift 排空是 O(n²)，故只拉少量
      // 帧后提前 return()（顺带钉死「流提前终止必须退订」的 finally 路径）。
      const burst: Array<[string, unknown?]> = [];
      for (let i = 0; i < HISTORY_CAP + 2; i++) {
        burst.push(['token', { token: `e${i}` }]);
      }
      burst.push(['complete']);
      // 第二轮小脚本：验证提前退订后下一轮流不受上一轮残留污染。
      mockRunnerWithScripts([burst, [['token', { token: 'after-burst' }], ['complete']]]);
      const session = await createChannelSession();

      const gen = session.handleMessage('hello');
      const first = await gen.next();
      expect(first.done).toBe(false);
      expect(first.value).toEqual({
        event: 'token',
        data: expect.objectContaining({ delta: 'e0' }),
      });
      await gen.return(undefined); // 提前终止：detach 必须在 finally 里发生
      await vi.waitFor(() => expect(session.busy).toBe(false));

      const hist = session.historySnapshot();
      expect(hist.length).toBe(HISTORY_CAP, 'history length capped');
      // 共 HISTORY_CAP + 3 帧，丢最旧 3 帧（e0/e1/e2）：首帧 seq = 4，末帧是 done。
      expect(hist[0].seq).toBe(4);
      expect((hist[0].data as { delta?: string }).delta).toBe('e3');
      expect(hist.at(-1)!.event).toBe('done');
      expect(hist.at(-1)!.seq).toBe(HISTORY_CAP + 3);

      // 提前终止后的下一轮：只含自己的帧——上一轮的爆量队列与订阅
      // 残留都不 bleed 进来。
      const events: SSEEvent[] = [];
      for await (const sse of session.handleMessage('next')) events.push(sse);
      expect(events).toEqual([
        { event: 'token', data: expect.objectContaining({ delta: 'after-burst' }) },
        expect.objectContaining({ event: 'done' }),
      ]);
    });

    it('unsubscribed listeners receive nothing further (history keeps recording)', async () => {
      mockRunnerWithScripts([[['complete']], [['token', { token: 'late' }], ['complete']]]);
      const session = await createChannelSession();

      const received: HistoryEntry[] = [];
      const detach = session.subscribe((entry) => received.push(entry));
      for await (const _ of session.handleMessage('first')) {
        // drain
      }
      detach();
      const receivedAtDetach = received.length;
      expect(receivedAtDetach).toBe(1);

      for await (const _ of session.handleMessage('second')) {
        // drain
      }
      expect(received.length).toBe(receivedAtDetach, '退订后不再收');
      // 退订只摘听者：历史照常落（第二轮 2 帧续在后面）。
      expect(session.historySnapshot().length).toBe(3);
      expect(session.historySnapshot().at(-1)!.event).toBe('done');
    });

    describe('session event channel: subscriber isolation (R2P-122 review P2)', () => {
      it('a throwing subscriber does not break the broadcast chain or pollute the stream', async () => {
        mockRunnerWithScripts([[['token', { token: 'a' }], ['complete']]]);
        const session = await AgentSession.create(
          {
            workspacePath: '/tmp/test',
            agentName: 'test',
            sessionId: 'channel-isolate-test',
            runtime: defaultNodeHostEnv,
            llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
          },
          testConfig
        );

        const good: HistoryEntry[] = [];
        const bad = vi.fn(() => {
          throw new Error('bad subscriber');
        });
        const detachBad = session.subscribe(bad);
        const detachGood = session.subscribe((entry) => good.push(entry));

        const events: SSEEvent[] = [];
        for await (const sse of session.handleMessage('hello')) events.push(sse);
        detachBad();
        detachGood();

        // 好订阅者照常收到全部帧（坏订阅者未拖断广播链）。
        expect(good.map((e) => e.event)).toEqual(['token', 'done']);
        // 坏订阅者的异常未被吞成合成 error 帧（历史、好订阅者、SSE 三处皆无）。
        expect(good.some((e) => e.event === 'error')).toBe(false);
        expect(session.historySnapshot().some((e) => e.event === 'error')).toBe(false);
        expect(events.some((e) => e.event === 'error')).toBe(false);
      });
    });

    // ─── turnSeq（R2P-152，对齐 Rust 1b24852：done 帧归属地基）────────────
    describe('turnSeq (R2P-152)', () => {
      it('two turns — each done frame carries its OWN turnSeq, strictly increasing and turn-aligned', async () => {
        mockRunnerWithScripts([
          [['token', { token: 'one' }], ['complete']],
          [['token', { token: 'two' }], ['complete']],
        ]);
        const session = await createChannelSession();

        const turns: SSEEvent[][] = [];
        for (const msg of ['first', 'second']) {
          const events: SSEEvent[] = [];
          for await (const sse of session.handleMessage(msg)) events.push(sse);
          turns.push(events);
        }

        // wire 级：每轮恰一个 done，data.turnSeq 与轮对齐且严格递增。
        const dones = turns.map(
          (events) => events.find((e) => e.event === 'done')!.data as { turnSeq: number }
        );
        expect(dones.map((d) => d.turnSeq)).toEqual([1, 2]);
        // 历史级：turnSeq 随落史进滚动历史——常驻流重放段照样可见，
        // 重连后 done 归属不丢。
        const histDones = session
          .historySnapshot()
          .filter((e) => e.event === 'done')
          .map((e) => e.data as { turnSeq: number });
        expect(histDones.map((d) => d.turnSeq)).toEqual([1, 2]);
      });

      it('consumption turn (continueRun / HITL resume) gets a NEW turnSeq — not confused with the user turn', async () => {
        // 用户轮以 waiting-human 终结（HITL 挂起），消费轮走 continueRun
        // （respond 路由清空中断后的续跑同款收口）——两个 done 各带各的
        // turnSeq，常驻流下可归属。归属消费归 Task 3（R2P-153），此处钉字段。
        mockRunnerWithScripts([
          [
            [
              'complete',
              {
                result: {
                  type: 'waiting-human',
                  request: {
                    type: 'question',
                    questions: [{ id: 'q1', question: 'A?', type: 'text' }],
                    toolCallId: 'call-1',
                  },
                  totalSteps: 1,
                  tokens: { input: 0, output: 0 },
                },
              },
            ],
          ],
          [['token', { token: 'resumed' }], ['complete']],
        ]);
        const session = await createChannelSession();

        const userTurn: SSEEvent[] = [];
        for await (const sse of session.handleMessage('hello')) userTurn.push(sse);
        const userDone = userTurn.find((e) => e.event === 'done')!.data as {
          turnSeq: number;
          type: string;
        };
        expect(userDone.type).toBe('waiting-human');
        expect(userDone.turnSeq).toBe(1);

        const consumptionTurn: SSEEvent[] = [];
        for await (const sse of session.continueRun()) consumptionTurn.push(sse);
        const consumptionDone = consumptionTurn.find((e) => e.event === 'done')!.data as {
          turnSeq: number;
        };
        expect(consumptionDone.turnSeq).toBe(2, '消费轮新号，不与用户轮混淆');
      });

      it('busy-rejected drives consume no turn number (gaps only from real drives)', async () => {
        mockRunnerWithScripts([[['complete']], [['complete']]]);
        const session = await createChannelSession();

        // 第一轮正常跑完（turnSeq=1）。
        for await (const _ of session.handleMessage('first')) {
          // drain
        }
        // busy 拒绝路径不进 driveTurn——不耗号。
        (session as unknown as { _busy: boolean })._busy = true;
        const rejected: SSEEvent[] = [];
        for await (const sse of session.handleMessage('rejected')) rejected.push(sse);
        (session as unknown as { _busy: boolean })._busy = false;
        expect(rejected.map((e) => e.event)).toEqual(['error']);

        // 第二轮真实驱动 → turnSeq=2（拒绝没消耗 2）。
        const events: SSEEvent[] = [];
        for await (const sse of session.handleMessage('second')) events.push(sse);
        expect((events.find((e) => e.event === 'done')!.data as { turnSeq: number }).turnSeq).toBe(
          2
        );
      });
    });
  });

  // ─── 邮箱 + 消费轮（R2P-141b，对齐 Rust live.rs 的 deliver/run_mail_consumer）───
  describe('mailbox + consumption turn (R2P-141b)', () => {
    const mkDelivery = (id: string) => ({
      subtaskId: `${id}-sub`,
      agent: 'researcher',
      content: `result of ${id}`,
      status: 'success',
      completedAt: 42,
    });

    async function createMailboxSession(store?: unknown) {
      return AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          sessionId: 'mailbox-test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
          ...(store ? { sessionStore: store as AgentSessionOptions['sessionStore'] } : {}),
        },
        testConfig
      );
    }

    /** 多轮 runner：run() 每被调用一次弹出一个「事件脚本」逐帧发射后返回终态。 */
    function mockScripts(scripts: Array<Array<[string, unknown?]>>) {
      const queue = [...scripts];
      const mock = createMockRunner({
        run: vi.fn().mockImplementation(async () => {
          const script = queue.shift() ?? [['complete']];
          for (const [type, payload] of script) {
            if (payload === undefined) mock.emit(type);
            else mock.emit(type, payload);
          }
          return {
            state: {
              id: 'test-state',
              config: { name: 'test', instructions: '', tools: [] },
              context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
            },
            result: { type: 'success', answer: '', totalSteps: 1, tokens: { input: 0, output: 0 } },
          };
        }),
      });
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);
      return mock;
    }

    it('formatDeliveries marks mail with <delivery> tags (pure contract)', async () => {
      const { formatDeliveries } = await import('../../src/core/agent-session.js');
      const text = formatDeliveries([mkDelivery('x')]);
      expect(text).toContain('<delivery agent="researcher" subtaskId="x-sub" status="success">');
      expect(text).toContain('result of x');
      expect(text).toContain('</delivery>');
      expect(text).toContain('delivered automatically');
    });

    it('deliver on idle session drives a mail consumption turn (marker + MAIL_INPUT_CAP seed)', async () => {
      const { MAIL_INPUT_CAP } = await import('../../src/core/agent-session.js');
      mockScripts([[['complete']]]);
      const session = await createMailboxSession();
      const { addUserMessage } = (await import('@agentskillmania/colts')) as unknown as {
        addUserMessage: { mock: { calls: Array<[unknown, string, number | undefined]> } };
      };
      const callsBefore = addUserMessage.mock.calls.length;

      session.deliver(mkDelivery('r1'));

      // 消费轮跑完：done 帧落史（后台驱动，历史可见）且邮箱清空。
      await vi.waitFor(() =>
        expect(session.historySnapshot().some((e) => e.event === 'done')).toBe(true)
      );
      expect(session.hasPendingDeliveries()).toBe(false);
      // 播种消息带 <delivery> 标记，且以 MAIL_INPUT_CAP 为限额（内部消息
      // 不受人类输入限额约束）。
      const seedCall = addUserMessage.mock.calls
        .slice(callsBefore)
        .find(([, msg]) => String(msg).includes('<delivery'));
      expect(seedCall).toBeDefined();
      expect(String(seedCall![1])).toContain('result of r1');
      expect(seedCall![2]).toBe(MAIL_INPUT_CAP);
      // 消费轮的 done 帧上常驻流（历史可见）。
      const dones = session
        .historySnapshot()
        .filter((e) => e.event === 'done')
        .map((e) => e.data as { turnSeq: number });
      expect(dones.length).toBe(1, '消费轮自己开轮（无用户轮在先）');
    });

    it('delivery frame lands in rolling history on deliver (background frame, no turn running)', async () => {
      mockScripts([[['complete']]]);
      const session = await createMailboxSession();

      session.deliver(mkDelivery('e1'));

      const frame = session.historySnapshot().find((e) => e.event === 'delivery');
      expect(frame).toBeDefined();
      expect(frame!.data).toMatchObject({
        subtaskId: 'e1-sub',
        agent: 'researcher',
        status: 'success',
        content: 'result of e1',
      });
      await vi.waitFor(() => expect(session.hasPendingDeliveries()).toBe(false));
    });

    it('deliver while busy: write-through waits, the turn-end hook digests afterwards (new turnSeq)', async () => {
      let releaseRun: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
      const mock = createMockRunner({
        run: vi.fn().mockImplementation(async () => {
          mock.emit('token', { token: 'turn-one' });
          await gate;
          mock.emit('complete');
          return {
            state: {
              id: 'test-state',
              config: { name: 'test', instructions: '', tools: [] },
              context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
            },
            result: { type: 'success', answer: '', totalSteps: 1, tokens: { input: 0, output: 0 } },
          };
        }),
      });
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);
      const session = await createMailboxSession();

      const iterator = session.handleMessage('hello')[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      expect(session.busy).toBe(true, 'turn in flight');

      session.deliver(mkDelivery('r2'));
      expect(session.hasPendingDeliveries()).toBe(true, 'busy: 写穿邮箱，不打扰进行中的轮');

      releaseRun!();
      for (;;) {
        const r = await iterator.next();
        if (r.done) break;
      }
      // 轮收尾钩子接力消费：等两个 done 都落史（用户轮 1 + 消费轮 2）。
      const doneSeqs = (): number[] =>
        session
          .historySnapshot()
          .filter((e) => e.event === 'done')
          .map((e) => (e.data as { turnSeq: number }).turnSeq);
      await vi.waitFor(() => expect(doneSeqs()).toEqual([1, 2]));
      expect(session.hasPendingDeliveries()).toBe(false, 'hook digested the mail');
    });

    it('mail is NOT consumed while a human input is pending (wait for the human)', async () => {
      const mock = mockScripts([[['complete']], [['complete']]]);
      const session = await createMailboxSession();
      // 未答 HITL 中断驻留内存态——消费轮必须等人（respond 轮的钩子再试）。
      (session as unknown as { state: unknown }).state = {
        ...(session.getState() as unknown as object),
        context: {
          ...(session.getState() as unknown as { context: object }).context,
          pendingInterrupts: [
            {
              request: { type: 'question', toolCallId: 'c1', questions: [] },
            },
          ],
        },
      };

      session.deliver(mkDelivery('hitl'));
      await new Promise((r) => setTimeout(r, 50));

      expect(session.hasPendingDeliveries()).toBe(true, 'HITL 未答——邮件驻留');
      expect(mock.runner.run).not.toHaveBeenCalled();
    });

    it('oversized delivery batch is dropped visibly (error frame, not requeued forever)', async () => {
      const { MAIL_INPUT_CAP } = await import('../../src/core/agent-session.js');
      mockScripts([[['complete']]]);
      const session = await createMailboxSession();

      const huge = mkDelivery('huge');
      huge.content = 'x'.repeat(MAIL_INPUT_CAP + 10);
      session.deliver(huge);

      await vi.waitFor(() => {
        expect(
          session
            .historySnapshot()
            .some(
              (e) =>
                e.event === 'error' &&
                String((e.data as { message?: string }).message).includes('oversized')
            )
        ).toBe(true);
      });
      expect(session.hasPendingDeliveries()).toBe(false, 'dropped, not requeued');
      expect(
        (session.getState() as unknown as { context: { messages: unknown[] } }).context.messages
      ).toHaveLength(0);
    });

    it('mailbox write-through persists batches; materialize (loadMailbox) re-consumes on warm-up', async () => {
      const savedBatches: unknown[][] = [];
      const fakeStore = {
        isDirBound: true,
        loadState: vi.fn().mockResolvedValue(null),
        saveState: vi.fn(),
        getMeta: vi.fn().mockResolvedValue(null),
        loadDeliveries: vi.fn().mockResolvedValue([mkDelivery('boot')]),
        saveDeliveries: vi.fn(async (_key: undefined, items: unknown[]) => {
          savedBatches.push(items);
        }),
        getSessionDir: vi.fn().mockReturnValue('/tmp/mailbox-test'),
      };
      const mock = mockScripts([[['complete']]]);
      // 崩溃语义（对齐 Rust「邮箱在盘不丢投递」）：重新物化装载侧车并补消费。
      const session = await createMailboxSession(fakeStore);

      // 物化即消费：loadDeliveries 读回 1 条 → 消费轮跑一轮 → 排空。
      await vi.waitFor(() => expect(session.hasPendingDeliveries()).toBe(false));
      expect(fakeStore.loadDeliveries).toHaveBeenCalledWith(undefined);
      // drain 写穿空箱（盘上不回魂）。
      await vi.waitFor(() => {
        const last = savedBatches.at(-1);
        expect(Array.isArray(last) && last.length === 0).toBe(true);
      });
      expect(mock.runner.run).toHaveBeenCalledTimes(1, '只消费轮驱动（无用户轮）');
    });
  });

  // ─── 委派槽接线（R2P-141c，对齐 Rust materialize 绑定监督者槽）───────────
  describe('delegate supervisor slot wiring (R2P-141c)', () => {
    it('constructor late-binds the session supervisor into the runner delegate slot', async () => {
      const setDelegateSupervisor = vi.fn();
      const mock = createMockRunner();
      (mock.runner as unknown as Record<string, unknown>).setDelegateSupervisor =
        setDelegateSupervisor;
      mockEnhancedRunnerCreate.mockResolvedValue(mock.runner);
      await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          sessionId: 'slot-wiring-test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );

      expect(setDelegateSupervisor).toHaveBeenCalledTimes(1);
      const bound = setDelegateSupervisor.mock.calls[0][0] as unknown as {
        isAlive: () => boolean;
        accept: (job: unknown) => void;
        cancelAll: () => void;
      };
      // 绑定的即本会话的监督者：活体（可异步受理）、可级联取消。
      expect(bound.isAlive()).toBe(true);
      expect(typeof bound.accept).toBe('function');
      expect(typeof bound.cancelAll).toBe('function');
    });

    it('a runner without the setter tolerates the wiring (old mocks / no delegation)', async () => {
      mockRunnerWithEvents();
      const session = await AgentSession.create(
        {
          workspacePath: '/tmp/test',
          agentName: 'test',
          sessionId: 'no-setter-test',
          runtime: defaultNodeHostEnv,
          llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
        },
        testConfig
      );
      expect(session.hasActiveChildren()).toBe(false, 'no slot = sync mode; registry stays empty');
    });
  });
});
