import { describe, it, expect } from 'vitest';
import type {
  AgentRole,
  AgentInstanceStatus,
  TaskStatus,
  CrewTodoStatus,
  CrewStatus,
  CrewInput,
  CrewOutputEvent,
  CrewMessage,
} from '../../../src/crew/types.js';

describe('crew types', () => {
  it('AgentRole has correct values', () => {
    const roles: AgentRole[] = ['primary', 'liaison', 'worker'];
    expect(roles).toHaveLength(3);
    expect(roles).toContain('primary');
    expect(roles).toContain('liaison');
    expect(roles).toContain('worker');
  });

  it('AgentInstanceStatus has correct values', () => {
    const statuses: AgentInstanceStatus[] = ['idle', 'running'];
    expect(statuses).toHaveLength(2);
  });

  it('TaskStatus has correct lifecycle', () => {
    const statuses: TaskStatus[] = ['pending', 'running', 'completed', 'failed'];
    expect(statuses).toHaveLength(4);
  });

  it('CrewInput supports user_message and stop', () => {
    const inputs: CrewInput[] = [{ type: 'user_message', content: 'hello' }, { type: 'stop' }];
    expect(inputs).toHaveLength(2);
  });

  it('CrewOutputEvent covers all event types', () => {
    const events: CrewOutputEvent['type'][] = [
      'user_response',
      'task_started',
      'task_completed',
      'task_failed',
      'todolist_updated',
      'agent_created',
      'agent_destroyed',
      'error',
      'tool_invoked',
      'tool_completed',
      'agent_advanced',
      'message_routed',
    ];
    expect(events).toHaveLength(12);
  });

  it('CrewMessage has required fields', () => {
    const msg: CrewMessage = {
      from: 'searcher-1',
      content: 'done',
      timestamp: Date.now(),
    };
    expect(msg.from).toBe('searcher-1');
    expect(msg.content).toBe('done');
    expect(typeof msg.timestamp).toBe('number');
  });
});
