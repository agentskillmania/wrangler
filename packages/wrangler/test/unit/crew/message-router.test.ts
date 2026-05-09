import { describe, it, expect } from 'vitest';
import { MessageRouter } from '../../../src/crew/message-router.js';

describe('MessageRouter', () => {
  it('enqueues message for target agent', () => {
    const router = new MessageRouter();
    router.enqueue('primary', { from: 'liaison-1', content: 'result', timestamp: 1 });
    const msgs = router.dequeue('primary');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('result');
  });

  it('queue accumulates messages', () => {
    const router = new MessageRouter();
    router.enqueue('a', { from: 'b', content: 'm1', timestamp: 1 });
    router.enqueue('a', { from: 'c', content: 'm2', timestamp: 2 });
    const msgs = router.dequeue('a');
    expect(msgs).toHaveLength(2);
  });

  it('dequeue clears queue', () => {
    const router = new MessageRouter();
    router.enqueue('a', { from: 'b', content: 'm1', timestamp: 1 });
    router.dequeue('a');
    const msgs2 = router.dequeue('a');
    expect(msgs2).toHaveLength(0);
  });

  it('dequeue for unknown agent returns empty', () => {
    const router = new MessageRouter();
    expect(router.dequeue('nobody')).toEqual([]);
  });

  it('hasMessages reports correctly', () => {
    const router = new MessageRouter();
    expect(router.hasMessages('a')).toBe(false);
    router.enqueue('a', { from: 'b', content: 'm', timestamp: 1 });
    expect(router.hasMessages('a')).toBe(true);
    router.dequeue('a');
    expect(router.hasMessages('a')).toBe(false);
  });

  it('agentsWithMessages lists agents with pending messages', () => {
    const router = new MessageRouter();
    router.enqueue('a', { from: 'b', content: 'm', timestamp: 1 });
    router.enqueue('c', { from: 'b', content: 'm', timestamp: 1 });
    expect(router.agentsWithMessages()).toEqual(['a', 'c']);
  });
});
