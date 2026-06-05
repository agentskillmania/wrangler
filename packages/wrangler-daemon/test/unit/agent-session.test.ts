import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSession } from '../../src/core/agent-session.js';
import type { AgentSessionOptions } from '../../src/core/agent-session.js';
import type { SSEEvent } from '../../src/types.js';

const { mockEnhancedRunnerCreate, mockRunnerRunStream } = vi.hoisted(() => ({
  mockEnhancedRunnerCreate: vi.fn().mockResolvedValue({
    runStream: vi.fn(),
    getToolInfo: vi.fn().mockReturnValue([]),
    getSkillInfo: vi.fn().mockReturnValue([]),
    getConfig: vi.fn().mockReturnValue({ model: 'test-model' }),
  }),
  mockRunnerRunStream: vi.fn(),
}));
vi.mock('@agentskillmania/wrangler', () => ({
  EnhancedRunner: { create: mockEnhancedRunnerCreate },
  SessionStore: vi.fn(),
}));
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
  addUserMessage: vi.fn((state, _msg) => state),
}));

const testConfig = {
  llm: { baseUrl: 'https://api.example.com', apiKey: 'sk-test', model: 'test-model' },
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

    it('maps complete event', () => {
      const result = AgentSession.mapEvent({ type: 'complete' } as any);
      expect(result).toEqual({ event: 'done', data: {} });
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

    it('maps step:end event', () => {
      const result = AgentSession.mapEvent({
        type: 'step:end',
        step: 3,
        result: {},
        timestamp: 0,
      } as any);
      expect(result).toEqual({ event: 'step-end', data: { step: 3 } });
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

    it('maps llm:response event', () => {
      const result = AgentSession.mapEvent({
        type: 'llm:response',
        text: 'hello',
        toolCalls: null,
        timestamp: 0,
      } as any);
      expect(result).toEqual({
        event: 'llm-response',
        data: { text: 'hello', toolCalls: null },
      });
    });

    it('maps llm:response event with toolCalls', () => {
      const result = AgentSession.mapEvent({
        type: 'llm:response',
        text: '',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: '/tmp' } }],
        timestamp: 0,
      } as any);
      expect(result!.event).toBe('llm-response');
      const data = result!.data as { toolCalls: unknown[] };
      expect(data.toolCalls).toHaveLength(1);
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

    it('maps subagent:end event', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:end',
        name: 'helper',
        result: { answer: 'ok', totalSteps: 3, finalState: null },
      } as any);
      expect(result!.event).toBe('subagent-end');
      const data = result!.data as { name: string; result: string };
      expect(data.result).toContain('answer');
    });

    it('maps subagent:end with string result', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:end',
        name: 'helper',
        result: 'done',
      } as any);
      expect(result).toEqual({ event: 'subagent-end', data: { name: 'helper', result: 'done' } });
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

    beforeEach(async () => {
      mockEnhancedRunnerCreate.mockResolvedValue({
        runStream: mockRunnerRunStream,
        getToolInfo: vi.fn().mockReturnValue([]),
        getSkillInfo: vi.fn().mockReturnValue([]),
        getConfig: vi.fn().mockReturnValue({ model: 'test-model' }),
      });
      session = await AgentSession.create(
        { workspacePath: '/tmp/test', agentName: 'test' },
        testConfig
      );
    });

    it('accepts options parameter with thinkingEnabled', async () => {
      mockRunnerRunStream.mockImplementationOnce(() => {
        async function* stream() {
          yield { type: 'complete' } as any;
          return { state: { id: 'test-state' } };
        }
        return stream();
      });

      const events: SSEEvent[] = [];
      await expect(
        (async () => {
          for await (const event of session.handleMessage('hello', { thinkingEnabled: true })) {
            events.push(event);
          }
        })()
      ).resolves.not.toThrow();

      expect(events.length).toBeGreaterThan(0);
    });

    it('accepts options parameter without thinkingEnabled', async () => {
      mockRunnerRunStream.mockImplementationOnce(() => {
        async function* stream() {
          yield { type: 'complete' } as any;
          return { state: { id: 'test-state' } };
        }
        return stream();
      });

      const events: SSEEvent[] = [];
      await expect(
        (async () => {
          for await (const event of session.handleMessage('hello', {})) {
            events.push(event);
          }
        })()
      ).resolves.not.toThrow();

      expect(events.length).toBeGreaterThan(0);
    });

    it('handles undefined options parameter', async () => {
      mockRunnerRunStream.mockImplementationOnce(() => {
        async function* stream() {
          yield { type: 'complete' } as any;
          return { state: { id: 'test-state' } };
        }
        return stream();
      });

      const events: SSEEvent[] = [];
      await expect(
        (async () => {
          for await (const event of session.handleMessage('hello', undefined)) {
            events.push(event);
          }
        })()
      ).resolves.not.toThrow();

      expect(events.length).toBeGreaterThan(0);
    });

    it('passes thinkingEnabled option to runner when provided', async () => {
      const mockRunStream = vi.fn().mockImplementation(async function* () {
        yield { type: 'complete' } as any;
        return { state: { id: 'test-state' } };
      });
      mockEnhancedRunnerCreate.mockResolvedValue({
        runStream: mockRunStream,
        getToolInfo: vi.fn().mockReturnValue([]),
        getSkillInfo: vi.fn().mockReturnValue([]),
        getConfig: vi.fn().mockReturnValue({ model: 'test-model' }),
      });

      const testSession = await AgentSession.create(
        { workspacePath: '/tmp/test', agentName: 'test' },
        testConfig
      );

      // Consume the stream
      for await (const _ of testSession.handleMessage('hello', { thinkingEnabled: true })) {
        // drain
      }

      // Verify runStream was called with thinkingEnabled
      expect(mockRunStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          thinkingEnabled: true,
        })
      );
    });

    it('omits thinkingEnabled from runner options when not provided', async () => {
      const mockRunStream = vi.fn().mockImplementation(async function* () {
        yield { type: 'complete' } as any;
        return { state: { id: 'test-state' } };
      });
      mockEnhancedRunnerCreate.mockResolvedValue({
        runStream: mockRunStream,
        getToolInfo: vi.fn().mockReturnValue([]),
        getSkillInfo: vi.fn().mockReturnValue([]),
        getConfig: vi.fn().mockReturnValue({ model: 'test-model' }),
      });

      const testSession = await AgentSession.create(
        { workspacePath: '/tmp/test', agentName: 'test' },
        testConfig
      );

      // Consume the stream without options
      for await (const _ of testSession.handleMessage('hello')) {
        // drain
      }

      // Verify runStream was called without thinkingEnabled
      expect(mockRunStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
      const callOptions = mockRunStream.mock.calls[0][1] as Record<string, unknown>;
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

    it('passes default sandbox=true to EnhancedRunner', async () => {
      await AgentSession.create(baseOptions, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ sandbox: true })
      );
    });

    it('passes sandbox=false when explicitly set', async () => {
      await AgentSession.create({ ...baseOptions, sandbox: false }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ sandbox: false })
      );
    });

    it('passes builtinTools whitelist to EnhancedRunner', async () => {
      const builtinTools = { shell: false, fileRead: true };
      await AgentSession.create({ ...baseOptions, builtinTools }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ builtinTools })
      );
    });

    it('passes enableSession/enableTodolist/enableCommands to EnhancedRunner', async () => {
      await AgentSession.create(
        { ...baseOptions, enableSession: false, enableTodolist: false, enableCommands: false },
        testConfig
      );
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          enableSession: false,
          enableTodolist: false,
          enableCommands: false,
        })
      );
    });

    it('defaults enableSession/enableTodolist/enableCommands to true', async () => {
      await AgentSession.create(baseOptions, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          enableSession: true,
          enableTodolist: true,
          enableCommands: true,
        })
      );
    });

    it('passes thinkingEnabled=false when explicitly set', async () => {
      await AgentSession.create({ ...baseOptions, thinkingEnabled: false }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingEnabled: false })
      );
    });

    it('passes a2ui option to EnhancedRunner', async () => {
      const a2ui = { enabled: true };
      await AgentSession.create({ ...baseOptions, a2ui }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(expect.objectContaining({ a2ui }));
    });

    it('passes workspacePath and skillDirs to EnhancedRunner', async () => {
      const skillDirs = ['/tmp/skills'];
      const mcpConfigPaths = ['/tmp/mcp.json'];
      await AgentSession.create({ ...baseOptions, skillDirs, mcpConfigPaths }, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath: '/tmp/test-workspace',
          skillDirs,
          mcpConfigPaths,
        })
      );
    });

    it('defaults mcpConfigPaths to empty array', async () => {
      await AgentSession.create(baseOptions, testConfig);
      expect(mockEnhancedRunnerCreate).toHaveBeenCalledWith(
        expect.objectContaining({ mcpConfigPaths: [] })
      );
    });
  });

  describe('handleMessage() concurrency guard', () => {
    let session: AgentSession;
    let streamResolve: () => void;

    beforeEach(async () => {
      mockEnhancedRunnerCreate.mockResolvedValue({
        runStream: mockRunnerRunStream,
        getToolInfo: vi.fn().mockReturnValue([]),
        getSkillInfo: vi.fn().mockReturnValue([]),
        getConfig: vi.fn().mockReturnValue({ model: 'test-model' }),
      });
    });

    it('rejects concurrent handleMessage with error event', async () => {
      let resolveFirst: () => void;
      mockRunnerRunStream.mockImplementationOnce(() => {
        async function* blockingStream() {
          await new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
          yield { type: 'complete' } as any;
          return { state: { id: 'test-state' } };
        }
        return blockingStream();
      });

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
      mockRunnerRunStream
        .mockImplementationOnce(() => {
          async function* stream1() {
            yield { type: 'token', token: 'a' } as any;
            yield { type: 'complete' } as any;
            return { state: { id: 's1' } };
          }
          return stream1();
        })
        .mockImplementationOnce(() => {
          async function* stream2() {
            yield { type: 'token', token: 'b' } as any;
            yield { type: 'complete' } as any;
            return { state: { id: 's2' } };
          }
          return stream2();
        });

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
      mockRunnerRunStream.mockImplementationOnce(() => {
        async function* quickStream() {
          yield { type: 'complete' } as any;
          return { state: { id: 'test-state' } };
        }
        return quickStream();
      });

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
      mockRunnerRunStream.mockImplementationOnce(() => {
        async function* stream() {
          yield { type: 'token', token: 'hi' } as any;
          yield { type: 'complete' } as any;
          return {
            state: {
              id: 'test-state',
              config: { name: 'test', instructions: '', tools: [] },
              context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
            },
          };
        }
        return stream();
      });

      const session = await AgentSession.create(
        { workspacePath: '/tmp/test', agentName: 'test' },
        testConfig
      );

      const cockpitEvents: SSEEvent[] = [];
      session.setCockpitSender((event) => cockpitEvents.push(event));

      for await (const _ of session.handleMessage('hello')) {
        // drain
      }

      const eventTypes = cockpitEvents.map((e) => e.event);
      expect(eventTypes).toContain('token');
      expect(eventTypes).toContain('done');
    });

    it('sends agent-diagnostics to cockpit after round completes', async () => {
      const finalState = {
        id: 'test-state',
        config: { name: 'test', instructions: '', tools: [] },
        context: { messages: [], stepCount: 5, createdAt: 0, updatedAt: 0 },
      };
      mockRunnerRunStream.mockImplementationOnce(() => {
        async function* stream() {
          yield { type: 'complete' } as any;
          return { state: finalState };
        }
        return stream();
      });

      const session = await AgentSession.create(
        { workspacePath: '/tmp/test', agentName: 'test' },
        testConfig
      );

      const cockpitEvents: SSEEvent[] = [];
      session.setCockpitSender((event) => cockpitEvents.push(event));

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

    it('includes session.overview and session.info in diagnostics', async () => {
      const finalState = {
        id: 'test-state',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [{ role: 'user', content: 'hi' }],
          stepCount: 3,
          createdAt: 0,
          updatedAt: 0,
          totalTokens: { input: 100, output: 50 },
        },
      };
      mockRunnerRunStream.mockImplementationOnce(() => {
        async function* stream() {
          yield { type: 'complete' } as any;
          return { state: finalState };
        }
        return stream();
      });

      const session = await AgentSession.create(
        { workspacePath: '/tmp/test', agentName: 'test' },
        testConfig
      );

      const cockpitEvents: SSEEvent[] = [];
      session.setCockpitSender((event) => cockpitEvents.push(event));

      for await (const _ of session.handleMessage('hello')) {
        // drain
      }

      const diagEvents = cockpitEvents.filter((e) => e.event === 'agent-diagnostics');
      const data = diagEvents[diagEvents.length - 1].data as Record<string, unknown>;

      // Verify session.overview
      const overview = data.session as Record<string, Record<string, unknown>>;
      expect(overview).toBeDefined();
      expect(overview.overview).toBeDefined();
      expect((overview.overview as Record<string, unknown>).agentName).toBe('test');
      expect((overview.overview as Record<string, unknown>).model).toBe('test-model');
      expect((overview.overview as Record<string, unknown>).stepCount).toBe(3);
      expect((overview.overview as Record<string, unknown>).messageCount).toBe(1);
      expect((overview.overview as Record<string, unknown>).tokensIn).toBe(100);
      expect((overview.overview as Record<string, unknown>).tokensOut).toBe(50);
      expect((overview.overview as Record<string, unknown>).tokensTotal).toBe(150);
      expect((overview.overview as Record<string, unknown>).status).toBe('idle');

      // Verify session.info
      expect(overview.info).toBeDefined();
      expect((overview.info as Record<string, unknown>).sessionId).toBe('test-state');
      expect((overview.info as Record<string, unknown>).agentName).toBe('test');
      expect((overview.info as Record<string, unknown>).model).toBe('test-model');
      expect((overview.info as Record<string, unknown>).workspacePath).toBe('/tmp/test');
      expect((overview.info as Record<string, unknown>).tokensIn).toBe(100);
    });

    it('does not forward events after cockpitSender cleared', async () => {
      mockRunnerRunStream.mockImplementationOnce(() => {
        async function* stream() {
          yield { type: 'token', token: 'hi' } as any;
          yield { type: 'complete' } as any;
          return { state: { id: 'test-state' } };
        }
        return stream();
      });

      const session = await AgentSession.create(
        { workspacePath: '/tmp/test', agentName: 'test' },
        testConfig
      );

      const cockpitEvents: SSEEvent[] = [];
      // Set then clear — initial connection event is captured before clear
      session.setCockpitSender((event) => cockpitEvents.push(event));
      session.setCockpitSender(null);

      for await (const _ of session.handleMessage('hello')) {
        // drain
      }

      // Only the initial connection diagnostics event remains;
      // no stream events should have been forwarded after sender was cleared.
      expect(cockpitEvents.length).toBe(1);
      expect(cockpitEvents[0].event).toBe('agent-diagnostics');
    });
  });
});
