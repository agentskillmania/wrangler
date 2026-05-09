import { describe, it, expect, vi } from 'vitest';
import { Crew } from '../../../src/crew/crew.js';
import type { CrewConfig, CrewOutputEvent } from '../../../src/crew/types.js';

const mockConfig: CrewConfig = {
  meta: { name: 'test-crew', description: 'test', primaryAgent: 'primary' },
  memory: 'test memory',
  agentDefs: {
    primary: { meta: { name: 'primary' }, instructions: 'You are primary' },
    searcher: { meta: { name: 'searcher' }, instructions: 'You search' },
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
});
