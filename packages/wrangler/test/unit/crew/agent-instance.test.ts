import { describe, it, expect } from 'vitest';
import { AgentInstance } from '../../../src/crew/agent-instance.js';

describe('AgentInstance', () => {
  it('creates with correct initial state', () => {
    const inst = new AgentInstance({
      id: 'primary-1',
      role: 'primary',
      definitionName: 'primary',
    });
    expect(inst.id).toBe('primary-1');
    expect(inst.role).toBe('primary');
    expect(inst.status).toBe('idle');
    expect(inst.queueSize).toBe(0);
  });

  it('enqueues and reports queue size', () => {
    const inst = new AgentInstance({
      id: 'worker-1',
      role: 'worker',
      definitionName: 'searcher',
      partnerId: 'liaison-1',
    });
    inst.enqueue({ from: 'liaison-1', content: 'hello', timestamp: 1 });
    expect(inst.queueSize).toBe(1);
  });

  it('dequeues and clears queue', () => {
    const inst = new AgentInstance({
      id: 'worker-1',
      role: 'worker',
      definitionName: 'searcher',
      partnerId: 'liaison-1',
    });
    inst.enqueue({ from: 'liaison-1', content: 'm1', timestamp: 1 });
    inst.enqueue({ from: 'liaison-1', content: 'm2', timestamp: 2 });
    const msgs = inst.dequeue();
    expect(msgs).toHaveLength(2);
    expect(inst.queueSize).toBe(0);
  });

  it('hasMessages reports correctly', () => {
    const inst = new AgentInstance({
      id: 'worker-1',
      role: 'worker',
      definitionName: 'searcher',
      partnerId: 'liaison-1',
    });
    expect(inst.hasMessages).toBe(false);
    inst.enqueue({ from: 'x', content: 'y', timestamp: 1 });
    expect(inst.hasMessages).toBe(true);
  });

  it('status transitions', () => {
    const inst = new AgentInstance({
      id: 'primary-1',
      role: 'primary',
      definitionName: 'primary',
    });
    expect(inst.status).toBe('idle');
    inst.setRunning();
    expect(inst.status).toBe('running');
    inst.setIdle();
    expect(inst.status).toBe('idle');
  });

  it('toInfo returns correct snapshot', () => {
    const inst = new AgentInstance({
      id: 'worker-1',
      role: 'worker',
      definitionName: 'searcher',
      partnerId: 'liaison-1',
      taskId: 'task-1',
    });
    const info = inst.toInfo();
    expect(info.id).toBe('worker-1');
    expect(info.role).toBe('worker');
    expect(info.definitionName).toBe('searcher');
    expect(info.status).toBe('idle');
    expect(info.partnerId).toBe('liaison-1');
    expect(info.taskId).toBe('task-1');
    expect(info.queueSize).toBe(0);
  });
});
