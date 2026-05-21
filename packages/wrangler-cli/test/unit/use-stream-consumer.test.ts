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
    expect(entries).toHaveLength(1);
    const assistant = entries.find((e) => e.type === 'assistant');
    expect(assistant).toEqual(expect.objectContaining({ type: 'assistant', content: 'Hi' }));
    if (assistant && assistant.type === 'assistant') {
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
    expect(tool).toEqual(
      expect.objectContaining({ type: 'tool', tool: 'file_read', isRunning: false })
    );
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

  it('does not append "undefined" when text-delta event lacks text field', () => {
    consumer.consume({ type: 'text-delta', text: 'Hello', timestamp: Date.now() });
    const entries = consumer.consume({ type: 'text-delta', timestamp: Date.now() });
    expect(entries).toHaveLength(1);
    if (entries[0].type === 'assistant') {
      expect(entries[0].content).toBe('Hello'); // not "Heloundefined"
    }
  });

  it('flushes thought with isStreaming false', () => {
    consumer.consume({ type: 'thinking', content: 'Hmm', timestamp: Date.now() });
    const flushed = consumer.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].type).toBe('thought');
    if (flushed[0].type === 'thought') {
      expect(flushed[0].content).toBe('Hmm');
      expect(flushed[0].isStreaming).toBe(false);
    }
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
    expect(tool).toEqual(
      expect.objectContaining({
        type: 'tool',
        summary: JSON.stringify({ key: 'value' }),
        isRunning: false,
      })
    );
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
    expect(tool).toEqual(
      expect.objectContaining({ type: 'tool', summary: 'a'.repeat(100) + '...' })
    );
    if (tool && tool.type === 'tool') {
      expect(tool.summary).toHaveLength(103);
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

  // --- Colts event type tests ---

  it('creates assistant entry from token events (colts format)', () => {
    consumer.consume({ type: 'token', token: 'Hel', timestamp: Date.now() });
    const entries = consumer.consume({
      type: 'token',
      token: 'lo',
      timestamp: Date.now(),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('assistant');
    if (entries[0].type === 'assistant') {
      expect(entries[0].content).toBe('Hello');
      expect(entries[0].isStreaming).toBe(true);
    }
  });

  it('flushes assistant on non-token event (colts format)', () => {
    consumer.consume({ type: 'token', token: 'Hi', timestamp: Date.now() });
    const entries = consumer.consume({
      type: 'phase-change',
      from: { type: 'idle' },
      to: { type: 'completed' },
      timestamp: Date.now(),
    });
    expect(entries).toHaveLength(1);
    const assistant = entries.find((e) => e.type === 'assistant');
    expect(assistant).toEqual(expect.objectContaining({ type: 'assistant', content: 'Hi' }));
  });

  it('creates tool entry from tool:start with action (colts format)', () => {
    const entries = consumer.consume({
      type: 'tool:start',
      action: { id: 'call-1', tool: 'file_read', arguments: { path: '/test.txt' } },
      timestamp: Date.now(),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('tool');
    if (entries[0].type === 'tool') {
      expect(entries[0].tool).toBe('file_read');
      expect(entries[0].isRunning).toBe(true);
    }
  });

  it('creates tool entry from tool:end with tracked callId (colts format)', () => {
    // First start the tool so the name is tracked
    consumer.consume({
      type: 'tool:start',
      action: { id: 'call-42', tool: 'shell', arguments: { cmd: 'ls' } },
      timestamp: Date.now(),
    });
    const entries = consumer.consume({
      type: 'tool:end',
      callId: 'call-42',
      result: 'file1.txt\nfile2.txt',
      timestamp: Date.now(),
    });
    const tool = entries.find((e) => e.type === 'tool');
    expect(tool).toEqual(
      expect.objectContaining({
        type: 'tool',
        tool: 'shell',
        isRunning: false,
        summary: 'file1.txt\nfile2.txt',
      })
    );
  });

  it('tool:end without callId uses unknown toolName', () => {
    const entries = consumer.consume({
      type: 'tool:end',
      result: 'some result',
      timestamp: Date.now(),
    });
    const tool = entries.find((e) => e.type === 'tool');
    expect(tool).toEqual(expect.objectContaining({ type: 'tool', tool: 'unknown' }));
  });

  it('creates run-complete entry from complete event (colts format)', () => {
    const entries = consumer.consume({
      type: 'complete',
      result: { type: 'done', answer: '42', totalSteps: 3 },
      timestamp: Date.now(),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('run-complete');
    if (entries[0].type === 'run-complete') {
      expect(entries[0].result.type).toBe('done');
    }
  });

  it('tool:end truncates long result (colts format)', () => {
    const longResult = 'b'.repeat(120);
    const entries = consumer.consume({
      type: 'tool:end',
      callId: 'call-long',
      result: longResult,
      timestamp: Date.now(),
    });
    const tool = entries.find((e) => e.type === 'tool');
    expect(tool).toEqual(
      expect.objectContaining({ type: 'tool', summary: 'b'.repeat(100) + '...' })
    );
  });

  it('tool:end with object result serializes to JSON (colts format)', () => {
    const entries = consumer.consume({
      type: 'tool:end',
      callId: 'call-obj',
      result: { files: ['a.ts', 'b.ts'] },
      timestamp: Date.now(),
    });
    const tool = entries.find((e) => e.type === 'tool');
    expect(tool).toEqual(
      expect.objectContaining({
        type: 'tool',
        summary: JSON.stringify({ files: ['a.ts', 'b.ts'] }),
      })
    );
  });

  it('tool:start without action uses unknown toolName', () => {
    const entries = consumer.consume({
      type: 'tool:start',
      timestamp: Date.now(),
    });
    expect(entries).toHaveLength(1);
    if (entries[0].type === 'tool') {
      expect(entries[0].tool).toBe('unknown');
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
