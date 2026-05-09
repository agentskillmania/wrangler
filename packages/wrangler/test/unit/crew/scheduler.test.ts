import { describe, it, expect, vi } from 'vitest';
import { Scheduler } from '../../../src/crew/scheduler.js';
import { AgentInstance } from '../../../src/crew/agent-instance.js';
import { MessageRouter } from '../../../src/crew/message-router.js';
import type { CrewOutputEvent } from '../../../src/crew/types.js';

describe('Scheduler', () => {
  it('processes agents with pending messages', async () => {
    const events: CrewOutputEvent[] = [];
    const agent = new AgentInstance({
      id: 'primary-1',
      role: 'primary',
      definitionName: 'primary',
    });
    agent.enqueue({ from: 'user', content: 'hello', timestamp: 1 });

    const onAdvance = vi.fn().mockResolvedValue(undefined);

    const scheduler = new Scheduler({
      router: new MessageRouter(),
      onAdvance,
      emit: (e) => events.push(e),
    });

    await scheduler.scheduleOnce(new Map([['primary-1', agent]]));

    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith(agent);
    expect(agent.queueSize).toBe(0);
  });

  it('skips agents without messages', async () => {
    const agent = new AgentInstance({
      id: 'primary-1',
      role: 'primary',
      definitionName: 'primary',
    });

    const onAdvance = vi.fn().mockResolvedValue(undefined);

    const scheduler = new Scheduler({
      router: new MessageRouter(),
      onAdvance,
      emit: () => {},
    });

    await scheduler.scheduleOnce(new Map([['primary-1', agent]]));
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('skips running agents even if they have messages', async () => {
    const agent = new AgentInstance({
      id: 'primary-1',
      role: 'primary',
      definitionName: 'primary',
    });
    agent.enqueue({ from: 'user', content: 'hello', timestamp: 1 });
    agent.setRunning();

    const onAdvance = vi.fn().mockResolvedValue(undefined);

    const scheduler = new Scheduler({
      router: new MessageRouter(),
      onAdvance,
      emit: () => {},
    });

    await scheduler.scheduleOnce(new Map([['primary-1', agent]]));
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('emits error event when advance fails', async () => {
    const events: CrewOutputEvent[] = [];
    const agent = new AgentInstance({
      id: 'primary-1',
      role: 'primary',
      definitionName: 'primary',
    });
    agent.enqueue({ from: 'user', content: 'hello', timestamp: 1 });

    const onAdvance = vi.fn().mockRejectedValue(new Error('LLM failed'));

    const scheduler = new Scheduler({
      router: new MessageRouter(),
      onAdvance,
      emit: (e) => events.push(e),
    });

    await scheduler.scheduleOnce(new Map([['primary-1', agent]]));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(agent.status).toBe('idle');
  });

  it('processes multiple agents in sequence', async () => {
    const order: string[] = [];

    const agent1 = new AgentInstance({
      id: 'primary-1',
      role: 'primary',
      definitionName: 'primary',
    });
    agent1.enqueue({ from: 'user', content: 'msg1', timestamp: 1 });

    const agent2 = new AgentInstance({
      id: 'worker-1',
      role: 'worker',
      definitionName: 'searcher',
      partnerId: 'liaison-1',
    });
    agent2.enqueue({ from: 'liaison-1', content: 'msg2', timestamp: 2 });

    const onAdvance = vi.fn().mockImplementation(async (a: AgentInstance) => {
      order.push(a.id);
    });

    const scheduler = new Scheduler({
      router: new MessageRouter(),
      onAdvance,
      emit: () => {},
    });

    await scheduler.scheduleOnce(
      new Map([
        ['primary-1', agent1],
        ['worker-1', agent2],
      ])
    );

    expect(onAdvance).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['primary-1', 'worker-1']);
  });
});
