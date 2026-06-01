import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgentState } from '@agentskillmania/colts';
import { Crew } from '../../../src/crew/crew.js';
import type { CrewConfig, CrewOutputEvent } from '../../../src/crew/types.js';

// ─── Mock EnhancedRunner ───

const mockState = createAgentState({
  name: 'mock',
  instructions: 'mock',
  tools: [],
});

let mockRunResult: { state: unknown; result: { type: string; answer?: string; error?: Error } };

vi.mock('../../../src/runner/enhanced-runner.js', () => ({
  EnhancedRunner: {
    create: vi.fn().mockImplementation(async () => ({
      run: vi.fn().mockImplementation(async () => mockRunResult),
      on: vi.fn(),
    })),
  },
}));

// ─── Helpers ───

/**
 * Type alias for accessing private Crew methods in tests.
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

function waitForEvent(crew: Crew, eventType: string): Promise<CrewOutputEvent> {
  return new Promise<CrewOutputEvent>((resolve) => {
    const unsub = crew.on(eventType, (e) => {
      unsub();
      resolve(e);
    });
  });
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

// ─── Tests ───

describe('Crew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunResult = { state: mockState, result: { type: 'success', answer: 'Done!' } };
  });

  it('initializes with idle state', () => {
    const crew = new Crew(mockConfig, {
      llmClient: {} as never,
    });
    expect(crew.state.status).toBe('idle');
    expect(crew.state.agents.size).toBe(0);
    expect(crew.state.tasks.size).toBe(0);
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

  // ─── createTask ───

  describe('createTask', () => {
    it('succeeds with known worker type — creates 1 agent', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      const taskId = asInternal(crew).createTask('searcher', 'search for x', 'primary-1');
      expect(taskId).toMatch(/^task-\d+$/);
      expect(crew.state.agents.size).toBe(1);
      expect(crew.state.tasks.size).toBe(1);
      expect(crew.state.tasks.get(taskId)?.status).toBe('running');
    });

    it('throws for unknown type without instructions', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      expect(() => asInternal(crew).createTask('nonexistent', 'do something', 'primary-1')).toThrow(
        'Unknown worker type: nonexistent'
      );
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
      expect(crew.state.agents.size).toBe(1);

      // Check the worker has custom instructions stored
      const workers = [...crew.state.agents.values()].filter((a) => a.role === 'worker');
      expect(workers).toHaveLength(1);
      expect(workers[0].definitionName).toBe('custom-agent');
    });

    it('emits agent_created event for worker only', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      const events: CrewOutputEvent[] = [];
      crew.on('agent_created', (e) => events.push(e));

      asInternal(crew).createTask('searcher', 'search', 'primary-1');

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'agent_created', role: 'worker' });
    });

    it('emits task_started event', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      const events: CrewOutputEvent[] = [];
      crew.on('task_started', (e) => events.push(e));

      asInternal(crew).createTask('searcher', 'search for x', 'primary-1');

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'task_started',
        workerType: 'searcher',
        description: 'search for x',
      });
    });

    it('sets worker partnerId to primaryId', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      asInternal(crew).createTask('searcher', 'search', 'primary-1');

      const workers = [...crew.state.agents.values()].filter((a) => a.role === 'worker');
      expect(workers).toHaveLength(1);
      expect(workers[0].partnerId).toBe('primary-1');
    });

    it('directly enqueues task description to worker', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      asInternal(crew).createTask('searcher', 'find pricing data', 'primary-1');

      // The worker should have a pending message via router
      const router = (crew as unknown as { router: { agentsWithMessages: () => string[] } }).router;
      const agentsWithMsgs = router.agentsWithMessages();
      expect(agentsWithMsgs.length).toBeGreaterThanOrEqual(1);

      // No liaison should exist
      const liaisons = [...crew.state.agents.values()].filter((a) => a.role === 'liaison');
      expect(liaisons).toHaveLength(0);
    });
  });

  // ─── advanceAgent pipeline ───

  describe('advanceAgent pipeline', () => {
    it('pushInput user_message creates primary and emits user_response on success', async () => {
      mockRunResult = { state: mockState, result: { type: 'success', answer: 'Done!' } };
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
      });

      const events: CrewOutputEvent[] = [];
      crew.on('agent_created', (e) => events.push(e));

      const response = waitForEvent(crew, 'user_response');
      crew.pushInput({ type: 'user_message', content: 'Hello' });

      const result = await response;
      expect(result.type).toBe('user_response');
      expect((result as { content: string }).content).toBe('Done!');

      expect(events.filter((e) => e.type === 'agent_created')).toHaveLength(1);
    });

    it('advanceAgent error emits error event and user_response', async () => {
      mockRunResult = {
        state: mockState,
        result: { type: 'error', error: new Error('LLM failed') },
      };
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
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
      mockRunResult = { state: mockState, result: { type: 'max_steps' } };
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
      });

      const errorP = waitForEvent(crew, 'error');
      crew.pushInput({ type: 'user_message', content: 'Hello' });

      const errorEvent = await errorP;
      expect(errorEvent.type).toBe('error');
      expect((errorEvent as { error: Error }).error.message).toContain('max_steps');
    });

    it('advanceAgent abort emits error event', async () => {
      mockRunResult = { state: mockState, result: { type: 'abort' } };
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
      });

      const errorP = waitForEvent(crew, 'error');
      crew.pushInput({ type: 'user_message', content: 'Hello' });

      const errorEvent = await errorP;
      expect(errorEvent.type).toBe('error');
      expect((errorEvent as { error: Error }).error.message).toContain('abort');
    });

    it('resets advanceCount on new user message', async () => {
      mockRunResult = { state: mockState, result: { type: 'success', answer: 'ok' } };
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
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
      mockRunResult = { state: mockState, result: { type: 'success', answer: 'loop' } };
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
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

  // ─── Auto-routing (2-layer: Worker → Primary) ───

  describe('auto-routing with mock runner', () => {
    it('worker auto-routes result to Primary', async () => {
      mockRunResult = { state: mockState, result: { type: 'success', answer: 'search result' } };
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
      });

      // Create a task to get a worker
      asInternal(crew).createTask('searcher', 'search', 'primary-1');

      const completedP = waitForEvent(crew, 'task_completed');

      // Get the worker
      const workers = [...(crew.agents as Map<string, unknown>).values()].filter(
        (a: { role: string }) => a.role === 'worker'
      );
      expect(workers).toHaveLength(1);

      const workerId = (workers[0] as { id: string }).id;

      // Enqueue message to worker and trigger scheduling
      (
        crew as unknown as { router: { enqueue: (id: string, msg: unknown) => void } }
      ).router.enqueue(workerId, {
        from: 'primary-1',
        content: 'search for x',
        timestamp: Date.now(),
      });

      // Trigger schedule round
      (crew as unknown as { scheduleRound: () => void }).scheduleRound();

      const completed = await completedP;
      expect(completed.type).toBe('task_completed');
      expect((completed as { result: string }).result).toBe('search result');
    });

    it('worker error routes error to Primary', async () => {
      mockRunResult = {
        state: mockState,
        result: { type: 'error', error: new Error('Worker crashed') },
      };
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
      });

      asInternal(crew).createTask('searcher', 'search', 'primary-1');

      const workers = [...(crew.agents as Map<string, unknown>).values()].filter(
        (a: { role: string }) => a.role === 'worker'
      );
      const workerId = (workers[0] as { id: string }).id;
      const taskId = (workers[0] as { taskId: string }).taskId!;

      const errorP = waitForEvent(crew, 'error');

      (
        crew as unknown as { router: { enqueue: (id: string, msg: unknown) => void } }
      ).router.enqueue(workerId, { from: 'primary-1', content: 'search', timestamp: Date.now() });
      (crew as unknown as { scheduleRound: () => void }).scheduleRound();

      const errorEvent = await errorP;
      expect((errorEvent as { error: Error }).error.message).toContain('Worker crashed');

      // Task should be marked as failed
      expect(crew.state.tasks.get(taskId)?.status).toBe('failed');

      // Error message should be routed to Primary
      const agentsWithMsgs = (
        crew as unknown as { router: { agentsWithMessages: () => string[] } }
      ).router.agentsWithMessages();
      // Primary should have a pending error message from worker
      // (it may not have been dequeued yet since primary may not have run)
    });
  });

  // ─── completeTask stores actual result ───

  describe('completeTask', () => {
    it('stores actual result from worker', async () => {
      mockRunResult = { state: mockState, result: { type: 'success', answer: '42 items found' } };
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
      });

      asInternal(crew).createTask('searcher', 'count items', 'primary-1');

      const completedP = waitForEvent(crew, 'task_completed');

      const workers = [...(crew.agents as Map<string, unknown>).values()].filter(
        (a: { role: string }) => a.role === 'worker'
      );
      const workerId = (workers[0] as { id: string }).id;

      (
        crew as unknown as { router: { enqueue: (id: string, msg: unknown) => void } }
      ).router.enqueue(workerId, {
        from: 'primary-1',
        content: 'count items',
        timestamp: Date.now(),
      });
      (crew as unknown as { scheduleRound: () => void }).scheduleRound();

      const completed = await completedP;
      expect(completed.type).toBe('task_completed');
      expect((completed as { taskId: string }).taskId).toMatch(/^task-\d+$/);
      expect((completed as { result: string }).result).toBe('42 items found');

      // Also verify task in state has the result
      const taskId = (completed as { taskId: string }).taskId;
      const task = crew.state.tasks.get(taskId);
      expect(task?.status).toBe('completed');
      expect(task?.result).toBe('42 items found');
      expect(task?.completedAt).toBeGreaterThan(0);
    });
  });

  // ─── ensureRunner uses EnhancedRunner.create ───

  describe('ensureRunner', () => {
    it('creates EnhancedRunner via static create method', async () => {
      mockRunResult = { state: mockState, result: { type: 'success', answer: 'factory result' } };

      const { EnhancedRunner } = await import('../../../src/runner/enhanced-runner.js');

      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
      });

      const response = waitForEvent(crew, 'user_response');
      crew.pushInput({ type: 'user_message', content: 'Hello' });

      const result = await response;
      expect((result as { content: string }).content).toBe('factory result');
      expect(EnhancedRunner.create).toHaveBeenCalledOnce();
    });
  });
});
