import { describe, it, expect, vi } from 'vitest';
import { Crew } from '../../../src/crew/crew.js';
import type { CrewConfig, CrewOutputEvent } from '../../../src/crew/types.js';

const mockConfig: CrewConfig = {
  meta: { name: 'test-crew', description: 'test', primaryAgent: 'primary' },
  memory: 'test memory',
  agentDefs: {
    primary: { meta: { name: 'primary' }, instructions: 'You are primary' },
    searcher: {
      meta: { name: 'searcher', description: 'Searches the web' },
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

    (crew as unknown as { emit: (e: CrewOutputEvent) => void }).emit({
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

    (crew as unknown as { emit: (e: CrewOutputEvent) => void }).emit({
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
    const catalog = (crew as unknown as { buildAgentCatalog: () => string }).buildAgentCatalog();
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
    const catalog = (crew as unknown as { buildAgentCatalog: () => string }).buildAgentCatalog();
    expect(catalog).toContain('No predefined worker agents available');
  });

  describe('createTask', () => {
    it('succeeds with known worker type', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      const taskId = (crew as unknown as { createTask: (...a: unknown[]) => string }).createTask(
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
        (crew as unknown as { createTask: (...a: unknown[]) => string }).createTask(
          'nonexistent',
          'do something',
          'primary-1'
        )
      ).toThrow('Unknown worker type: nonexistent');
    });

    it('succeeds with unknown type + instructions (ad-hoc creation)', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never });
      const taskId = (crew as unknown as { createTask: (...a: unknown[]) => string }).createTask(
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

      (crew as unknown as { createTask: (...a: unknown[]) => string }).createTask(
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

      (crew as unknown as { createTask: (...a: unknown[]) => string }).createTask(
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

  describe('per-agent model', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type InternalCrew = { ensureRunner: (a: any) => void; agents: Map<string, any> };

    function getRunnerModel(crew: InternalCrew, agentDefName: string): string {
      const agent = [...crew.agents.values()].find(
        (a: { definitionName: string }) => a.definitionName === agentDefName
      );
      if (!agent) throw new Error(`Agent ${agentDefName} not found`);
      crew.ensureRunner(agent);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (agent.runner as any).options.model as string;
    }

    it('uses agentDef meta.model when available', () => {
      const configWithModel: CrewConfig = {
        ...mockConfig,
        agentDefs: {
          primary: { meta: { name: 'primary' }, instructions: 'You are primary' },
          searcher: {
            meta: { name: 'searcher', description: 'Search', model: 'claude-3' },
            instructions: 'You search',
          },
        },
      };
      const crew = new Crew(configWithModel, {
        llmClient: {} as never,
        defaultModel: 'gpt-4o',
      }) as unknown as InternalCrew;

      // Create a worker via createTask
      (crew as unknown as { createTask: (...a: unknown[]) => string }).createTask(
        'searcher',
        'test',
        'primary-1'
      );

      expect(getRunnerModel(crew, 'searcher')).toBe('claude-3');
    });

    it('falls back to defaultModel when agentDef has no model', () => {
      const crew = new Crew(mockConfig, {
        llmClient: {} as never,
        defaultModel: 'gpt-4o',
      }) as unknown as InternalCrew;

      (crew as unknown as { createTask: (...a: unknown[]) => string }).createTask(
        'searcher',
        'test',
        'primary-1'
      );

      expect(getRunnerModel(crew, 'searcher')).toBe('gpt-4o');
    });

    it('falls back to gpt-4 when neither provides model', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never }) as unknown as InternalCrew;

      (crew as unknown as { createTask: (...a: unknown[]) => string }).createTask(
        'searcher',
        'test',
        'primary-1'
      );

      expect(getRunnerModel(crew, 'searcher')).toBe('gpt-4');
    });
  });

  describe('exec tool loading', () => {
    const configWithSkills: CrewConfig = {
      ...mockConfig,
      agentDefs: {
        primary: { meta: { name: 'primary' }, instructions: 'You are primary' },
        searcher: {
          meta: { name: 'searcher', description: 'Search', skills: ['web-search', 'web-fetch'] },
          instructions: 'You search',
        },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type InternalCrew = { createExecTools: (a: any) => any[]; agents: Map<string, any> };

    function getExecToolNames(crew: InternalCrew, defName: string): string[] {
      const agent = [...crew.agents.values()].find(
        (a: { definitionName: string }) => a.definitionName === defName
      );
      if (!agent) throw new Error(`Agent ${defName} not found`);
      return crew.createExecTools(agent).map((t: { name: string }) => t.name);
    }

    it('loads exec tools for agent with skills', () => {
      const crew = new Crew(configWithSkills, {
        llmClient: {} as never,
      }) as unknown as InternalCrew;

      (crew as unknown as { createTask: (...a: unknown[]) => string }).createTask(
        'searcher',
        'test',
        'primary-1'
      );

      const toolNames = getExecToolNames(crew, 'searcher');
      expect(toolNames).toContain('web_search');
      expect(toolNames).toContain('web_fetch');
    });

    it('returns empty array for agent without skills', () => {
      const crew = new Crew(mockConfig, { llmClient: {} as never }) as unknown as InternalCrew;

      (crew as unknown as { createTask: (...a: unknown[]) => string }).createTask(
        'searcher',
        'test',
        'primary-1'
      );

      const toolNames = getExecToolNames(crew, 'searcher');
      expect(toolNames).toEqual([]);
    });

    it('returns empty array for empty skills array', () => {
      const emptySkillsConfig: CrewConfig = {
        ...mockConfig,
        agentDefs: {
          primary: { meta: { name: 'primary' }, instructions: 'You are primary' },
          searcher: {
            meta: { name: 'searcher', description: 'Search', skills: [] },
            instructions: 'You search',
          },
        },
      };
      const crew = new Crew(emptySkillsConfig, {
        llmClient: {} as never,
      }) as unknown as InternalCrew;

      (crew as unknown as { createTask: (...a: unknown[]) => string }).createTask(
        'searcher',
        'test',
        'primary-1'
      );

      const toolNames = getExecToolNames(crew, 'searcher');
      expect(toolNames).toEqual([]);
    });
  });
});
