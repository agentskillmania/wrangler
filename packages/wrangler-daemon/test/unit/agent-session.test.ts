import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSession } from '../../src/core/agent-session.js';
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
    getToolInfo: overrides.getToolInfo ?? vi.fn().mockReturnValue([]),
    getSkillInfo: overrides.getSkillInfo ?? vi.fn().mockReturnValue([]),
    getConfig: overrides.getConfig ?? vi.fn().mockReturnValue({ model: 'test-model' }),
  };
  return { runner, on, off, emit };
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
  return {
    ...actual,
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
vi.mock('@agentskillmania/colts', () => ({
  createAgentState: vi.fn().mockReturnValue({
    id: 'test-state',
    config: { name: 'test', instructions: '', tools: [] },
    context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
  }),
  addUserMessage: vi.fn((state, _msg, _maxLength?) => state),
}));

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
        timestamp: 0,
      } as any);
      expect(result!.event).toBe('llm-request');
      const data = result!.data as { messages: unknown[]; tools: string[] };
      expect(data.messages).toHaveLength(1);
      expect(data.tools).toEqual(['read_file']);
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

    it('maps waiting-human event', () => {
      const result = AgentSession.mapEvent({
        type: 'waiting-human',
        request: { questions: ['q1?'] },
        timestamp: 0,
      } as any);
      expect(result).toEqual({
        event: 'waiting-human',
        data: { request: { questions: ['q1?'] } },
      });
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
  });

  describe('AgentSessionOptions', () => {
    it('accepts new EnhancedRunner parameters', () => {
      const options: AgentSessionOptions = {
        workspacePath: '/tmp/test',
        agentName: 'test',
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
        { workspacePath: '/tmp/test', agentName: 'test' },
        testConfig
      );
    });

    it('accepts options parameter with thinkingEnabled', async () => {
      const events: SSEEvent[] = [];
      for await (const event of session.handleMessage('hello', { thinkingEnabled: true })) {
        events.push(event);
      }

      expect(events).toEqual([{ event: 'done', data: {} }]);
    });

    it('accepts options parameter without thinkingEnabled', async () => {
      const events: SSEEvent[] = [];
      for await (const event of session.handleMessage('hello', {})) {
        events.push(event);
      }

      expect(events).toEqual([{ event: 'done', data: {} }]);
    });

    it('handles undefined options parameter', async () => {
      const events: SSEEvent[] = [];
      for await (const event of session.handleMessage('hello', undefined)) {
        events.push(event);
      }

      expect(events).toEqual([{ event: 'done', data: {} }]);
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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

  describe('AgentSession.create()', () => {
    const baseOptions: AgentSessionOptions = {
      workspacePath: '/tmp/test-workspace',
      agentName: 'test-agent',
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
          skills: { dirs: skillDirs },
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
        { workspacePath: '/tmp/test', agentName: 'test', limits: { maxInputLength: 100 } },
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
        { workspacePath: '/tmp/test', agentName: 'test', limits: { maxInputLength: 100 } },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
        { workspacePath: '/tmp/test', agentName: 'test' },
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
          subAgents,
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
        },
        testConfig
      );

      const call = mockEnhancedRunnerResume.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(call.subAgents).toBeUndefined();
    });
  });
});
