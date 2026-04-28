import { describe, it, expect } from 'vitest';
import { formatTranscriptEntry } from '../../../src/session/transcript.js';
import type { TranscriptEntry } from '../../../src/types.js';

describe('formatTranscriptEntry', () => {
  const ts = 1745850600000; // 2026-04-28T15:10:00.000Z

  it('should serialize user entry as JSONL line', () => {
    const entry: TranscriptEntry = { type: 'user', content: 'Hello, help me code.', timestamp: ts };
    const line = formatTranscriptEntry(entry);
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({ type: 'user', content: 'Hello, help me code.', timestamp: ts });
    expect(line.endsWith('\n')).toBe(true);
  });

  it('should serialize assistant entry as JSONL line', () => {
    const entry: TranscriptEntry = {
      type: 'assistant',
      content: 'I will help you with that.',
      timestamp: ts,
    };
    const line = formatTranscriptEntry(entry);
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({
      type: 'assistant',
      content: 'I will help you with that.',
      timestamp: ts,
    });
  });

  it('should serialize tool entry with long result (no truncation)', () => {
    const longResult = 'x'.repeat(600);
    const entry: TranscriptEntry = {
      type: 'tool',
      toolName: 'file_read',
      arguments: '{ "path": "src/app.ts" }',
      result: longResult,
      timestamp: ts,
    };
    const line = formatTranscriptEntry(entry);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('tool');
    expect(parsed.toolName).toBe('file_read');
    expect(parsed.result).toHaveLength(600);
  });

  it('should serialize error entry as JSONL line', () => {
    const entry: TranscriptEntry = {
      type: 'error',
      message: 'Tool execution failed: Permission denied',
      timestamp: ts,
    };
    const line = formatTranscriptEntry(entry);
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({
      type: 'error',
      message: 'Tool execution failed: Permission denied',
      timestamp: ts,
    });
  });
});
