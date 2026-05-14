import { describe, it, expect, beforeEach } from 'vitest';
import { StreamConsumer } from '../../src/hooks/use-stream-consumer.js';

describe('StreamConsumer', () => {
  let consumer: StreamConsumer;

  beforeEach(() => {
    consumer = new StreamConsumer();
  });

  it('creates user entry from user-message event', () => {
    const entries = consumer.consume({
      type: 'user-message',
      content: 'Hello',
      timestamp: Date.now(),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('user');
    expect(entries[0].content).toBe('Hello');
  });

  it('creates assistant entry from text-delta events', () => {
    consumer.consume({ type: 'text-delta', text: 'Hel', timestamp: Date.now() });
    const entries = consumer.consume({
      type: 'text-delta',
      text: 'lo',
      timestamp: Date.now(),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('assistant');
    if (entries[0].type === 'assistant') {
      expect(entries[0].content).toBe('Hello');
      expect(entries[0].isStreaming).toBe(true);
    }
  });

  it('finalizes assistant entry on stream-end', () => {
    consumer.consume({ type: 'text-delta', text: 'Hi', timestamp: Date.now() });
    // A non-text-delta event triggers auto-flush of the buffered assistant
    const entries = consumer.consume({
      type: 'stream-end',
      timestamp: Date.now(),
    });
    const assistant = entries.find((e) => e.type === 'assistant');
    expect(assistant).toBeDefined();
    if (assistant && assistant.type === 'assistant') {
      expect(assistant.content).toBe('Hi');
      expect(assistant.isStreaming).toBeUndefined();
    }
  });

  it('creates tool entry from tool-start and tool-end', () => {
    consumer.consume({
      type: 'tool-start',
      toolName: 'file_read',
      toolCallId: 'tc1',
      timestamp: Date.now(),
    });
    const entries = consumer.consume({
      type: 'tool-end',
      toolName: 'file_read',
      toolCallId: 'tc1',
      result: 'file content...',
      timestamp: Date.now(),
    });
    const tool = entries.find((e) => e.type === 'tool');
    expect(tool).toBeDefined();
    if (tool && tool.type === 'tool') {
      expect(tool.tool).toBe('file_read');
      expect(tool.isRunning).toBe(false);
    }
  });

  it('creates error entry from error event', () => {
    const entries = consumer.consume({
      type: 'error',
      error: new Error('LLM failed'),
      timestamp: Date.now(),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('error');
    if (entries[0].type === 'error') {
      expect(entries[0].message).toContain('LLM failed');
    }
  });

  it('creates run-complete entry from run-complete event', () => {
    const entries = consumer.consume({
      type: 'run-complete',
      result: { steps: 5 },
      timestamp: Date.now(),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('run-complete');
    if (entries[0].type === 'run-complete') {
      expect(entries[0].result).toEqual({ steps: 5 });
    }
  });

  it('flush() returns assistant entry with isStreaming false when buffer has content', () => {
    consumer.consume({ type: 'text-delta', text: 'Hello', timestamp: Date.now() });
    const flushed = consumer.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].type).toBe('assistant');
    if (flushed[0].type === 'assistant') {
      expect(flushed[0].content).toBe('Hello');
      expect(flushed[0].isStreaming).toBe(false);
    }
  });

  it('flush() returns empty array when no buffered content', () => {
    const flushed = consumer.flush();
    expect(flushed).toEqual([]);
  });

  it('tool-end with object result serializes to JSON', () => {
    const entries = consumer.consume({
      type: 'tool-end',
      toolName: 'test',
      toolCallId: 'tc1',
      result: { key: 'value' },
      timestamp: Date.now(),
    });
    const tool = entries.find((e) => e.type === 'tool');
    expect(tool).toBeDefined();
    if (tool && tool.type === 'tool') {
      expect(tool.summary).toBe(JSON.stringify({ key: 'value' }));
      expect(tool.isRunning).toBe(false);
    }
  });

  it('tool-end truncates result longer than 100 chars', () => {
    const longResult = 'a'.repeat(120);
    const entries = consumer.consume({
      type: 'tool-end',
      toolName: 'test',
      toolCallId: 'tc1',
      result: longResult,
      timestamp: Date.now(),
    });
    const tool = entries.find((e) => e.type === 'tool');
    expect(tool).toBeDefined();
    if (tool && tool.type === 'tool') {
      expect(tool.summary).toBe('a'.repeat(100) + '...');
      expect(tool.summary.length).toBe(103);
    }
  });

  it('error with non-Error string value uses string as message', () => {
    const entries = consumer.consume({
      type: 'error',
      error: 'string error',
      timestamp: Date.now(),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('error');
    if (entries[0].type === 'error') {
      expect(entries[0].message).toBe('string error');
    }
  });

  it('error with null error produces message "null"', () => {
    const entries = consumer.consume({
      type: 'error',
      error: null,
      timestamp: Date.now(),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('error');
    if (entries[0].type === 'error') {
      expect(entries[0].message).toBe('null');
    }
  });

  it('each instance has independent seq counter (P4 fix)', () => {
    const consumer2 = new StreamConsumer();
    const e1 = consumer.consume({
      type: 'user-message',
      content: 'a',
      timestamp: 1,
    });
    const e2 = consumer2.consume({
      type: 'user-message',
      content: 'b',
      timestamp: 1,
    });
    // Both start from seq 1 — no cross-instance interference
    expect(e1[0].seq).toBe(1);
    expect(e2[0].seq).toBe(1);
  });
});
