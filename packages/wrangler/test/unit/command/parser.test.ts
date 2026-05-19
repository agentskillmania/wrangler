import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../../src/command/parser.js';
import type { ParsedCommand } from '../../../src/command/types.js';

describe('parseCommand', () => {
  it('returns null for non-command input (plain text)', () => {
    expect(parseCommand('hello world')).toBeNull();
    expect(parseCommand('this is plain text')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCommand('')).toBeNull();
  });

  it('returns null for whitespace only', () => {
    expect(parseCommand('   ')).toBeNull();
    expect(parseCommand('\t\n')).toBeNull();
  });

  it('returns null when slash is not at start', () => {
    expect(parseCommand('hello /command')).toBeNull();
    expect(parseCommand('  /command')).toBeNull();
    expect(parseCommand('text /command more')).toBeNull();
  });

  it('parses simple command without target or body', () => {
    const result = parseCommand('/clear');
    expect(result).toEqual<ParsedCommand>({
      name: 'clear',
      target: undefined,
      body: '',
    });
  });

  it('parses command with target only', () => {
    const result = parseCommand('/skill:code-review');
    expect(result).toEqual<ParsedCommand>({
      name: 'skill',
      target: 'code-review',
      body: '',
    });
  });

  it('parses command with target and body', () => {
    const result = parseCommand('/skill:code-review fix this bug');
    expect(result).toEqual<ParsedCommand>({
      name: 'skill',
      target: 'code-review',
      body: 'fix this bug',
    });
  });

  it('parses command with body but no target', () => {
    const result = parseCommand('/compact   some extra text');
    expect(result).toEqual<ParsedCommand>({
      name: 'compact',
      target: undefined,
      body: 'some extra text',
    });
  });

  it('parses command with multiline body', () => {
    const result = parseCommand('/prompt first line\nsecond line\nthird line');
    expect(result).toEqual<ParsedCommand>({
      name: 'prompt',
      target: undefined,
      body: 'first line\nsecond line\nthird line',
    });
  });

  it('trims trailing whitespace from body', () => {
    const result = parseCommand('/test body text   ');
    expect(result).toEqual<ParsedCommand>({
      name: 'test',
      target: undefined,
      body: 'body text',
    });
  });

  it('handles edge case: slash alone', () => {
    expect(parseCommand('/')).toBeNull();
  });

  it('handles edge case: command with numbers', () => {
    const result = parseCommand('/123');
    expect(result).toEqual<ParsedCommand>({
      name: '123',
      target: undefined,
      body: '',
    });
  });

  it('handles edge case: command with underscore', () => {
    const result = parseCommand('/run_test');
    expect(result).toEqual<ParsedCommand>({
      name: 'run_test',
      target: undefined,
      body: '',
    });
  });

  it('handles edge case: command with dash', () => {
    const result = parseCommand('/setup-dev');
    expect(result).toEqual<ParsedCommand>({
      name: 'setup-dev',
      target: undefined,
      body: '',
    });
  });

  it('handles target with dash', () => {
    const result = parseCommand('/skill:code-review-pro');
    expect(result).toEqual<ParsedCommand>({
      name: 'skill',
      target: 'code-review-pro',
      body: '',
    });
  });

  it('handles target with underscore', () => {
    const result = parseCommand('/skill:deep_code_read');
    expect(result).toEqual<ParsedCommand>({
      name: 'skill',
      target: 'deep_code_read',
      body: '',
    });
  });

  it('handles target with numbers', () => {
    const result = parseCommand('/skill:v2');
    expect(result).toEqual<ParsedCommand>({
      name: 'skill',
      target: 'v2',
      body: '',
    });
  });

  it('handles command with only whitespace after colon', () => {
    const result = parseCommand('/skill:   ');
    expect(result).toEqual<ParsedCommand>({
      name: 'skill',
      target: undefined,
      body: '',
    });
  });

  it('handles complex body with special characters', () => {
    const result = parseCommand('/eval 1 + 2 = @#$%');
    expect(result).toEqual<ParsedCommand>({
      name: 'eval',
      target: undefined,
      body: '1 + 2 = @#$%',
    });
  });
});
