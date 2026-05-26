import { describe, it, expect } from 'vitest';
import { mapDevtoolStreamEvent } from '../../../src/routes/devtool-stream.js';
import type { RunStreamEvent } from '@agentskillmania/colts';

describe('mapDevtoolStreamEvent', () => {
  it('maps token to devtool:token', () => {
    const result = mapDevtoolStreamEvent({ type: 'token', token: 'hello' } as RunStreamEvent);
    expect(result).toEqual({ event: 'devtool:token', data: { delta: 'hello' } });
  });

  it('maps thinking to devtool:thinking', () => {
    const result = mapDevtoolStreamEvent({
      type: 'thinking',
      content: 'reasoning text',
    } as RunStreamEvent);
    expect(result).toEqual({ event: 'devtool:thinking', data: { content: 'reasoning text' } });
  });

  it('maps tool:start to devtool:tool-start', () => {
    const result = mapDevtoolStreamEvent({
      type: 'tool:start',
      action: { id: 'c1', tool: 'file_read', arguments: { path: '/a' } },
    } as RunStreamEvent);
    expect(result).toEqual({
      event: 'devtool:tool-start',
      data: { id: 'c1', name: 'file_read', args: { path: '/a' } },
    });
  });

  it('maps tool:end with string result', () => {
    const result = mapDevtoolStreamEvent({
      type: 'tool:end',
      callId: 'c1',
      result: 'content',
    } as RunStreamEvent);
    expect(result).toEqual({
      event: 'devtool:tool-end',
      data: { callId: 'c1', result: 'content' },
    });
  });

  it('maps tool:end with object result as JSON string', () => {
    const result = mapDevtoolStreamEvent({
      type: 'tool:end',
      callId: 'c1',
      result: { error: 'fail' },
    } as RunStreamEvent);
    expect(result!.event).toBe('devtool:tool-end');
    expect((result!.data as { result: string }).result).toContain('"error"');
  });

  it('maps error event', () => {
    const result = mapDevtoolStreamEvent({
      type: 'error',
      error: new Error('boom'),
    } as RunStreamEvent);
    expect(result).toEqual({ event: 'devtool:error', data: { message: 'boom' } });
  });

  it('returns null for complete event', () => {
    const result = mapDevtoolStreamEvent({ type: 'complete' } as RunStreamEvent);
    expect(result).toBeNull();
  });

  it('returns null for step:start event', () => {
    const result = mapDevtoolStreamEvent({ type: 'step:start' } as RunStreamEvent);
    expect(result).toBeNull();
  });

  it('returns null for unknown event types', () => {
    const result = mapDevtoolStreamEvent({
      type: 'skill:start',
      name: 'x',
      task: 'y',
    } as RunStreamEvent);
    expect(result).toBeNull();
  });

  it('returns null for phase-change event', () => {
    const result = mapDevtoolStreamEvent({ type: 'phase-change' } as RunStreamEvent);
    expect(result).toBeNull();
  });
});
