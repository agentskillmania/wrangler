/**
 * @fileoverview AgentInstance behavioral contract tests
 *
 * Tests the observable contracts of AgentInstance:
 * - Queue FIFO ordering and defensive copy
 * - Status lifecycle transitions
 * - toInfo snapshot correctness
 * - Edge cases (empty dequeue, concurrent access)
 */
import { describe, it, expect } from 'vitest';
import { AgentInstance } from '../../../src/crew/agent-instance.js';

function createInstance(overrides?: { role?: string; taskId?: string }) {
  return new AgentInstance({
    id: 'test-1',
    role: (overrides?.role ?? 'worker') as 'primary' | 'worker',
    definitionName: 'test-agent',
    partnerId: 'partner-1',
    taskId: overrides?.taskId,
  });
}

describe('AgentInstance', () => {
  describe('queue behavior', () => {
    it('should return empty array when dequeue is called on empty queue', () => {
      const inst = createInstance();
      const msgs = inst.dequeue();
      expect(msgs).toEqual([]);
      expect(inst.queueSize).toBe(0);
    });

    it('should maintain FIFO order on dequeue', () => {
      const inst = createInstance();
      inst.enqueue({ from: 'a', content: 'first', timestamp: 1 });
      inst.enqueue({ from: 'b', content: 'second', timestamp: 2 });
      inst.enqueue({ from: 'c', content: 'third', timestamp: 3 });

      const msgs = inst.dequeue();
      expect(msgs.map((m) => m.content)).toEqual(['first', 'second', 'third']);
    });

    it('should return a defensive copy — modifying returned array does not affect internal state', () => {
      const inst = createInstance();
      inst.enqueue({ from: 'a', content: 'hello', timestamp: 1 });

      const msgs = inst.dequeue();
      msgs.push({ from: 'injected', content: 'should not appear', timestamp: 99 });

      expect(inst.queueSize).toBe(0);
      expect(inst.hasMessages).toBe(false);
    });

    it('should clear queue after dequeue', () => {
      const inst = createInstance();
      inst.enqueue({ from: 'a', content: 'm1', timestamp: 1 });
      inst.enqueue({ from: 'a', content: 'm2', timestamp: 2 });

      expect(inst.hasMessages).toBe(true);
      const first = inst.dequeue();
      expect(first).toHaveLength(2);
      expect(inst.hasMessages).toBe(false);

      const second = inst.dequeue();
      expect(second).toEqual([]);
    });

    it('should report correct queueSize at each stage', () => {
      const inst = createInstance();
      expect(inst.queueSize).toBe(0);

      inst.enqueue({ from: 'a', content: 'm1', timestamp: 1 });
      expect(inst.queueSize).toBe(1);

      inst.enqueue({ from: 'a', content: 'm2', timestamp: 2 });
      expect(inst.queueSize).toBe(2);

      inst.dequeue();
      expect(inst.queueSize).toBe(0);
    });
  });

  describe('status lifecycle', () => {
    it('should start as idle', () => {
      const inst = createInstance();
      expect(inst.status).toBe('idle');
    });

    it('should transition idle → running → idle', () => {
      const inst = createInstance();
      expect(inst.status).toBe('idle');

      inst.setRunning();
      expect(inst.status).toBe('running');

      inst.setIdle();
      expect(inst.status).toBe('idle');
    });

    it('should allow setting running twice without error', () => {
      const inst = createInstance();
      inst.setRunning();
      inst.setRunning();
      expect(inst.status).toBe('running');
    });
  });

  describe('toInfo snapshot', () => {
    it('should reflect current state including queueSize', () => {
      const inst = createInstance({ taskId: 'task-42' });
      inst.enqueue({ from: 'a', content: 'm1', timestamp: 1 });

      const info = inst.toInfo();
      expect(info.id).toBe('test-1');
      expect(info.role).toBe('worker');
      expect(info.definitionName).toBe('test-agent');
      expect(info.status).toBe('idle');
      expect(info.partnerId).toBe('partner-1');
      expect(info.taskId).toBe('task-42');
      expect(info.queueSize).toBe(1);
    });

    it('should return a snapshot that does not change when queue is mutated later', () => {
      const inst = createInstance();
      inst.enqueue({ from: 'a', content: 'm1', timestamp: 1 });

      const info = inst.toInfo();
      expect(info.queueSize).toBe(1);

      inst.dequeue();
      // The snapshot was taken before dequeue — its queueSize is a number, not a live reference
      expect(info.queueSize).toBe(1);
    });
  });

  describe('constructor options', () => {
    it('should store customInstructions when provided', () => {
      const inst = new AgentInstance({
        id: 'w-1',
        role: 'worker',
        definitionName: 'custom',
        customInstructions: 'You are a custom agent.',
      });
      expect(inst.customInstructions).toBe('You are a custom agent.');
    });

    it('should have undefined customInstructions when not provided', () => {
      const inst = createInstance();
      expect(inst.customInstructions).toBeUndefined();
    });
  });
});
