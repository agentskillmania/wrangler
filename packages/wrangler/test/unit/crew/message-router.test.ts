/**
 * @fileoverview MessageRouter behavioral contract tests
 *
 * Tests the observable contracts of MessageRouter:
 * - Dequeue returns a defensive copy (internal state not mutated by caller)
 * - FIFO ordering preserved
 * - agentsWithMessages ordering follows insertion order
 * - Edge cases (empty dequeue, clear semantics, large volume)
 */
import { describe, it, expect } from 'vitest';
import { MessageRouter } from '../../../src/crew/message-router.js';

function makeMessage(content: string) {
  return { from: 'sender', content, timestamp: Date.now() };
}

describe('MessageRouter', () => {
  describe('enqueue and dequeue', () => {
    it('should return empty array for unknown agent', () => {
      const router = new MessageRouter();
      expect(router.dequeue('nobody')).toEqual([]);
    });

    it('should return all enqueued messages in FIFO order', () => {
      const router = new MessageRouter();
      router.enqueue('a', makeMessage('first'));
      router.enqueue('a', makeMessage('second'));
      router.enqueue('a', makeMessage('third'));

      const msgs = router.dequeue('a');
      expect(msgs.map((m) => m.content)).toEqual(['first', 'second', 'third']);
    });

    it('should clear queue after dequeue — second dequeue returns empty', () => {
      const router = new MessageRouter();
      router.enqueue('a', makeMessage('m1'));
      router.dequeue('a');
      expect(router.dequeue('a')).toEqual([]);
    });

    it('should return a defensive copy — modifying returned array does not affect internal state', () => {
      const router = new MessageRouter();
      router.enqueue('a', makeMessage('original'));

      const msgs = router.dequeue('a');
      msgs.push(makeMessage('injected'));

      expect(router.hasMessages('a')).toBe(false);
      expect(router.dequeue('a')).toEqual([]);
    });

    it('should handle enqueue with empty string content', () => {
      const router = new MessageRouter();
      router.enqueue('a', makeMessage(''));

      const msgs = router.dequeue('a');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('');
    });

    it('should accumulate messages from multiple enqueues', () => {
      const router = new MessageRouter();
      router.enqueue('a', makeMessage('m1'));
      router.enqueue('b', makeMessage('m2'));
      router.enqueue('a', makeMessage('m3'));

      expect(router.dequeue('a')).toHaveLength(2);
      expect(router.dequeue('b')).toHaveLength(1);
    });
  });

  describe('hasMessages', () => {
    it('should report false for agent with no messages', () => {
      const router = new MessageRouter();
      expect(router.hasMessages('a')).toBe(false);
    });

    it('should report true after enqueue, false after dequeue', () => {
      const router = new MessageRouter();
      router.enqueue('a', makeMessage('hello'));
      expect(router.hasMessages('a')).toBe(true);

      router.dequeue('a');
      expect(router.hasMessages('a')).toBe(false);
    });
  });

  describe('agentsWithMessages', () => {
    it('should return empty array when no agent has messages', () => {
      const router = new MessageRouter();
      expect(router.agentsWithMessages()).toEqual([]);
    });

    it('should return agents in insertion order', () => {
      const router = new MessageRouter();
      router.enqueue('c', makeMessage('m'));
      router.enqueue('a', makeMessage('m'));
      router.enqueue('b', makeMessage('m'));

      expect(router.agentsWithMessages()).toEqual(['c', 'a', 'b']);
    });

    it('should exclude agents whose messages were dequeued', () => {
      const router = new MessageRouter();
      router.enqueue('a', makeMessage('m'));
      router.enqueue('b', makeMessage('m'));

      router.dequeue('a');
      expect(router.agentsWithMessages()).toEqual(['b']);
    });
  });

  describe('edge cases', () => {
    it('should handle large message volume', () => {
      const router = new MessageRouter();
      for (let i = 0; i < 100; i++) {
        router.enqueue('target', makeMessage(`msg-${i}`));
      }

      const msgs = router.dequeue('target');
      expect(msgs).toHaveLength(100);
      expect(msgs[0].content).toBe('msg-0');
      expect(msgs[99].content).toBe('msg-99');
    });
  });
});
