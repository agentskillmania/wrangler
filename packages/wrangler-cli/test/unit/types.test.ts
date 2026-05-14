import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../src/types.js';

describe('parseCommand', () => {
  it('parses plain text as message', () => {
    expect(parseCommand('Hello agent')).toEqual({ type: 'message', content: 'Hello agent' });
  });
  it('parses /sessions command', () => {
    expect(parseCommand('/sessions')).toEqual({ type: 'sessions' });
  });
  it('parses /session <name> command', () => {
    expect(parseCommand('/session searcher')).toEqual({ type: 'switch-session', name: 'searcher' });
  });
  it('parses /clear command', () => {
    expect(parseCommand('/clear')).toEqual({ type: 'clear' });
  });
  it('parses /help command', () => {
    expect(parseCommand('/help')).toEqual({ type: 'help' });
  });
  it('parses /session without name arg as empty name', () => {
    expect(parseCommand('/session')).toEqual({ type: 'switch-session', name: '' });
  });

  it('treats unknown /command as message', () => {
    expect(parseCommand('/unknown foo')).toEqual({ type: 'message', content: '/unknown foo' });
  });
});
