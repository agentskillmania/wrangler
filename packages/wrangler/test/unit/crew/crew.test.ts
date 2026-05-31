import { describe, it, expect, vi } from 'vitest';
import { createAgentState } from '@agentskillmania/colts';
import { Crew } from '../../../src/crew/crew.js';
import type { CrewConfig, CrewOutputEvent, CrewRunner } from '../../../src/crew/types.js';

/**
 * Type alias for accessing private Crew methods in tests.
 * Consolidates 20+ scattered `as unknown as { method }` casts into one place.
 */
type InternalCrew = Crew & {
  emit: (event: CrewOutputEvent) => void;
  buildAgentCatalog: () => string;
  createTask: (...args: unknown[]) => string;
  advanceAgent: (agent: unknown, messages: unknown[]) => Promise<void>;
};

/** Cast Crew to InternalCrew for private method access in tests */
function asInternal(crew: Crew): InternalCrew {
  return crew as unknown as InternalCrew;
}

const mockConfig: CrewConfig = {
  meta: { name: 'test-crew', description: 'test', primaryAgent: 'primary' },
  memory: 'test memory',
  agentDefs: {
    primary: { name: 'primary', instructions: 'You are primary' },
    searcher: {
      name: 'searcher',
      description: 'Searches the web',
      instructions: 'You search',
    },
  },
  skillDirs: [],
};

describe('Crew', () => {
  it('initializes with idle state', () => {
    const crew = new Crew(mockConfig, {
      llmClient: {} as never,
    });
    expect(crew.state.status).toBe('idle');
    expect(crew.state.agents.size).toBe(0);
    expect(crew.state.tasks.size).toBe(0);
    expect(crew.state.todolist).toEqual([]);
  });

  it('state is read-only', () => {
    const crew = new Crew(mockConfig, { llmClient: {} as never });
    const state = crew.state;
    expect(() => {
      (state as Record<string, unknown>).status = 'hacked';
    }).toThrow();
  });

  it('on() returns unsubscribe function', () => {
    const crew = new Crew(mockConfig, { llmClient: {} as never });
    const handler = vi.fn();
    const unsub = crew.on('user_response', handler);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('emits events to subscribers', () => {
    const crew = new Crew(mockConfig, { llmClient: {} as never });
    const events: CrewOutputEvent[] = [];
    crew.on('error', (e) => events.push(e));

    asInternal(crew).emit({
      type: 'error',
      error: new Error('test'),
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
  });

  it('unsubscribe stops receiving events', () => {
    const crew = new Crew(mockConfig, { llmClient: {} as never });
    const handler = vi.fn();
    const unsub = crew.on('error', handler);
    unsub();

    asInternal(crew).emit({
      type: 'error',
      error: new Error('test'),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('pushInput with stop sets status to stopped', () => {
    const crew = new Crew(mockConfig, { llmClient: {} as never });
    crew.pushInput({ type: 'stop' });
    expect(crew.state.status).toBe('stopped');
  });

  it('buildAgentCatalog lists available agents', () => {
    const crew = new Crew(mockConfig, { llmClient: {} as never });
    const catalog = asInternal(crew).buildAgentCatalog();
    expect(catalog).toContain('searcher');
    expect(catalog).toContain('Searches the web');
    expect(catalog).toContain('Available worker agents');
  });

  it('buildAgentCatalog handles empty agentDefs', () => {
    const emptyConfig: CrewConfig = {
      ...mockConfig,
      agentDefs: { primary: mockConfig.agentDefs['primary'] },
    };
    const crew = new Crew(emptyConfig, { llmClient: {} as never });
    const catalog = asInternal(crew).buildAgentCatalog();
    expect(catalog).toContain('No predefined worker agents available');
  });

  describe('createTask', () => {
    it('succeeds with known worker type', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      const taskId = asInternal(crew).createTask(
        'searcher',
        'search for x',
        'primary-1'
      );
      expect(taskId).toMatch(/^task-\d+$/);
      expect(crew.state.agents.size).toBe(2);
      expect(crew.state.tasks.size).toBe(1);
      expect(crew.state.tasks.get(taskId)?.status).toBe('running');
    });

    it('throws for unknown type without instructions', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      expect(() =>
        asInternal(crew).createTask(
          'nonexistent',
          'do something',
          'primary-1'
        )
      ).toThrow('Unknown worker type: nonexistent');
    });

    it('succeeds with unknown type + instructions (ad-hoc creation)', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      const taskId = asInternal(crew).createTask(
        'custom-agent',
        'custom task',
        'primary-1',
        'You are a custom agent.'
      );
      expect(taskId).toMatch(/^task-\d+$/);
      expect(crew.state.agents.size).toBe(2);

      // Check the worker has custom instructions stored
      const workers = [...crew.state.agents.values()].filter((a) => a.role === 'worker');
      expect(workers).toHaveLength(1);
      expect(workers[0].definitionName).toBe('custom-agent');
    });

    it('emits agent_created events for liaison and worker', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      const events: CrewOutputEvent[] = [];
      crew.on('agent_created', (e) => events.push(e));

      asInternal(crew).createTask(
        'searcher',
        'search',
        'primary-1'
      );

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: 'agent_created', role: 'liaison' });
      expect(events[1]).toMatchObject({ type: 'agent_created', role: 'worker' });
    });

    it('emits task_started event', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      const events: CrewOutputEvent[] = [];
      crew.on('task_started', (e) => events.push(e));

      asInternal(crew).createTask(
        'searcher',
        'search for x',
        'primary-1'
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'task_started',
        workerType: 'searcher',
        description: 'search for x',
      });
    });
  });

  // ─── Mock runner factory helpers ───

  function createMockRunnerFactory(result: { type: string; answer?: string; error?: Error }) {
    const mockState = createAgentState({
      name: 'mock',
      instructions: 'mock',
      tools: [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    return (_options: any): CrewRunner => ({
      run: async () => ({ state: mockState, result }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: () => {},
    });
  }

  function waitForEvent(crew: Crew, eventType: string): Promise<CrewOutputEvent> {
    return new Promise<CrewOutputEvent>((resolve) => {
      const unsub = crew.on(eventType, (e) => {
        unsub();
        resolve(e);
      });
    });
  }

  describe('advanceAgent pipeline via runnerFactory', () => {
    it('pushInput user_message creates primary and emits user_response on success', async () => {
      const factory = createMockRunnerFactory({ type: 'success', answer: 'Done!' });
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        runnerFactory: factory,
      });

      const events: CrewOutputEvent[] = [];
      crew.on('agent_created', (e) => events.push(e));
      crew.on('agent_advanced', (e) => events.push(e));

      const response = waitForEvent(crew, 'user_response');
      crew.pushInput({ type: 'user_message', content: 'Hello' });

      const result = await response;
      expect(result.type).toBe('user_response');
      expect((result as { content: string }).content).toBe('Done!');

      expect(events.filter((e) => e.type === 'agent_created')).toHaveLength(1);
      expect(events.filter((e) => e.type === 'agent_advanced')).toHaveLength(1);
    });

    it('advanceAgent error emits error event and user_response', async () => {
      const factory = createMockRunnerFactory({
        type: 'error',
        error: new Error('LLM failed'),
      });
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        runnerFactory: factory,
      });

      const errorP = waitForEvent(crew, 'error');
      const responseP = waitForEvent(crew, 'user_response');

      crew.pushInput({ type: 'user_message', content: 'Hello' });

      const errorEvent = await errorP;
      expect(errorEvent.type).toBe('error');
      expect((errorEvent as { error: Error }).error.message).toContain('LLM failed');

      const response = await responseP;
      expect((response as { content: string }).content).toContain('LLM failed');
    });

    it('advanceAgent max_steps emits error event', async () => {
      const factory = createMockRunnerFactory({ type: 'max_steps' });
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        runnerFactory: factory,
      });

      const errorP = waitForEvent(crew, 'error');
      crew.pushInput({ type: 'user_message', content: 'Hello' });

      const errorEvent = await errorP;
      expect(errorEvent.type).toBe('error');
      expect((errorEvent as { error: Error }).error.message).toContain('max_steps');
    });

    it('advanceAgent abort emits error event', async () => {
      const factory = createMockRunnerFactory({ type: 'abort' });
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        runnerFactory: factory,
      });

      const errorP = waitForEvent(crew, 'error');
      crew.pushInput({ type: 'user_message', content: 'Hello' });

      const errorEvent = await errorP;
      expect(errorEvent.type).toBe('error');
      expect((errorEvent as { error: Error }).error.message).toContain('abort');
    });

    it('resets advanceCount on new user message', async () => {
      const factory = createMockRunnerFactory({ type: 'success', answer: 'ok' });
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        runnerFactory: factory,
      });

      crew.pushInput({ type: 'user_message', content: 'Hello' });
      await waitForEvent(crew, 'user_response');

      const primary = [...(crew.agents as Map<string, { advanceCount: number }>).values()].find(
        (a: { role: string }) => a.role === 'primary'
      );
      const countAfterFirst = primary!.advanceCount;
      expect(countAfterFirst).toBeGreaterThan(0);

      // Set to near-limit to prove reset works
      primary!.advanceCount = 200;

      // New user message should reset, allowing further advances
      crew.pushInput({ type: 'user_message', content: 'Another' });
      await waitForEvent(crew, 'user_response');

      // After reset + one advance, count should be 1 (not 201)
      expect(primary!.advanceCount).toBe(1);
    });

    it('max-hop guard prevents infinite loops (limit 200)', async () => {
      const factory = createMockRunnerFactory({ type: 'success', answer: 'loop' });
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        runnerFactory: factory,
      });

      crew.pushInput({ type: 'user_message', content: 'Hello' });
      await waitForEvent(crew, 'user_response');

      const primary = [...(crew.agents as Map<string, { advanceCount: number }>).values()].find(
        (a: { role: string }) => a.role === 'primary'
      );
      expect(primary!.role).toBe('primary');

      // Manually set to 200 — next advance should trigger guard
      primary!.advanceCount = 200;
      const errorP = waitForEvent(crew, 'error');
      await asInternal(crew).advanceAgent(primary, []);

      const errorEvent = await errorP;
      expect(errorEvent.type).toBe('error');
      expect((errorEvent as { error: Error }).error.message).toContain('max advances');
    });
  });

  describe('auto-routing with mock runner', () => {
    it('worker auto-routes result to liaison', async () => {
      const factory = createMockRunnerFactory({ type: 'success', answer: 'search result' });
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        runnerFactory: factory,
      });

      // Create a task to get worker + liaison pair
      asInternal(crew).createTask(
        'searcher',
        'search',
        'primary-1'
      );

      const routedP = waitForEvent(crew, 'message_routed');

      // Manually enqueue to worker and trigger scheduling
      const workers = [...(crew.agents as Map<string, unknown>).values()].filter(
        (a: { role: string }) => a.role === 'worker'
      );
      expect(workers).toHaveLength(1);

      const workerId = (workers[0] as { id: string }).id;
      const liaisonId = (workers[0] as { partnerId: string }).partnerId;

      // Clear liaison's message from createTask so only worker runs
      (crew as { router: { dequeue: (id: string) => unknown[] } }).router.dequeue(liaisonId);

      // Directly enqueue and trigger via router
      (crew as { router: { enqueue: (id: string, msg: unknown) => void } }).router.enqueue(
        workerId,
        { from: 'primary-1', content: 'search for x', timestamp: Date.now() }
      );

      // Trigger schedule round
      (crew as { scheduleRound: () => void }).scheduleRound();

      const routed = await routedP;
      expect(routed.type).toBe('message_routed');
      expect((routed as { from: string; to: string }).from).toBe(workerId);
      expect((routed as { from: string; to: string }).to).toBe(liaisonId);
    });

    it('liaison auto-routes to worker when relay flag is not set', async () => {
      const factory = createMockRunnerFactory({ type: 'success', answer: 'translate this' });
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        runnerFactory: factory,
      });

      asInternal(crew).createTask(
        'searcher',
        'search',
        'primary-1'
      );

      const liaisons = [...(crew.agents as Map<string, unknown>).values()].filter(
        (a: { role: string }) => a.role === 'liaison'
      );
      expect(liaisons).toHaveLength(1);

      const liaisonId = (liaisons[0] as { id: string }).id;
      const workerId = (liaisons[0] as { partnerId: string }).partnerId;

      (crew as { router: { enqueue: (id: string, msg: unknown) => void } }).router.enqueue(
        liaisonId,
        { from: workerId, content: 'result', timestamp: Date.now() }
      );

      const routedP = waitForEvent(crew, 'message_routed');
      (crew as { scheduleRound: () => void }).scheduleRound();

      const routed = await routedP;
      expect((routed as { from: string; to: string }).from).toBe(liaisonId);
      expect((routed as { from: string; to: string }).to).toBe(workerId);
    });

    it('liaison does NOT auto-route when relay flag is set', async () => {
      const mockState = createAgentState({ name: 'mock', instructions: 'mock', tools: [] });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let liaisonRef: any = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      const factory = (_opts: any): CrewRunner => ({
        run: async () => {
          // Simulate relay_to_primary being called during the run
          if (liaisonRef) liaisonRef.relayFlag = true;
          return {
            state: mockState,
            result: { type: 'success', answer: 'relayed to primary' },
          };
        },
        on: () => {},
      });

      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        runnerFactory: factory,
      });

      asInternal(crew).createTask(
        'searcher',
        'search',
        'primary-1'
      );

      const liaisons = [...(crew.agents as Map<string, unknown>).values()].filter(
        (a: { role: string }) => a.role === 'liaison'
      );
      const liaisonId = (liaisons[0] as { id: string }).id;
      const workerId = (liaisons[0] as { partnerId: string }).partnerId;

      // Set ref so mock runner can set relayFlag during run
      liaisonRef = (crew.agents as Map<string, { relayFlag: boolean }>).get(liaisonId);

      const advancedP = waitForEvent(crew, 'agent_advanced');
      (crew as { router: { enqueue: (id: string, msg: unknown) => void } }).router.enqueue(
        liaisonId,
        { from: workerId, content: 'result', timestamp: Date.now() }
      );
      (crew as { scheduleRound: () => void }).scheduleRound();

      await advancedP;

      // With relayFlag set, no message_routed event should be emitted for liaison → worker
      const routed = (
        crew as { router: { agentsWithMessages: () => string[] } }
      ).router.agentsWithMessages();
      expect(routed).not.toContain(workerId);
    });

    it('worker error routes error to liaison', async () => {
      const factory = createMockRunnerFactory({
        type: 'error',
        error: new Error('Worker crashed'),
      });
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        runnerFactory: factory,
      });

      asInternal(crew).createTask(
        'searcher',
        'search',
        'primary-1'
      );

      const workers = [...(crew.agents as Map<string, unknown>).values()].filter(
        (a: { role: string }) => a.role === 'worker'
      );
      const workerId = (workers[0] as { id: string }).id;
      const taskId = (workers[0] as { taskId: string }).taskId!;

      const errorP = waitForEvent(crew, 'error');
      const routedP = waitForEvent(crew, 'message_routed');

      (crew as { router: { enqueue: (id: string, msg: unknown) => void } }).router.enqueue(
        workerId,
        { from: 'primary-1', content: 'search', timestamp: Date.now() }
      );
      (crew as { scheduleRound: () => void }).scheduleRound();

      const errorEvent = await errorP;
      expect((errorEvent as { error: Error }).error.message).toContain('Worker crashed');

      // Task should be marked as failed
      expect(crew.state.tasks.get(taskId)?.status).toBe('failed');

      const routed = await routedP;
      expect((routed as { contentPreview: string }).contentPreview).toContain('Worker crashed');
    });
  });

  describe('ensureRunner with runnerFactory', () => {
    it('uses custom runnerFactory when provided', async () => {
      const mockState = createAgentState({ name: 'mock', instructions: 'mock', tools: [] });
      const factoryFn = vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({
          state: mockState,
          result: { type: 'success', answer: 'factory result' },
        }),
        on: vi.fn(),
      });

      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        runnerFactory: factoryFn as any,
      });

      const response = waitForEvent(crew, 'user_response');
      crew.pushInput({ type: 'user_message', content: 'Hello' });

      const result = await response;
      expect((result as { content: string }).content).toBe('factory result');
      expect(factoryFn).toHaveBeenCalledOnce();
      // Verify factory was called with correct model
      expect(factoryFn.mock.calls[0][0].model).toBe('gpt-4');
    });
  });
});
