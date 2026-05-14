/**
 * US4 + US5: Command parsing and SessionManager
 *
 * US4: As a developer, I use parseCommand(input) to parse user input
 * into structured commands (message, sessions, switch-session, clear, help).
 *
 * US5: As a developer, I use SessionManager to track crew sessions,
 * add subagent sessions, switch between sessions, and update statuses.
 *
 * These are pure logic tests — no LLM calls needed, always run.
 */

import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../src/types.js';
import { SessionManager } from '../../src/hooks/use-session-manager.js';

// ---------------------------------------------------------------------------
// US4: Command parsing
// ---------------------------------------------------------------------------

describe('US4: Command parsing', () => {
  it('parses plain text as message', () => {
    const result = parseCommand('Hello, how are you?');
    expect(result).toEqual({ type: 'message', content: 'Hello, how are you?' });
  });

  it('parses /sessions command', () => {
    const result = parseCommand('/sessions');
    expect(result).toEqual({ type: 'sessions' });
  });

  it('parses /session <name> as switch-session', () => {
    const result = parseCommand('/session my-agent');
    expect(result).toEqual({ type: 'switch-session', name: 'my-agent' });
  });

  it('parses /session without name as switch-session with empty name', () => {
    const result = parseCommand('/session');
    expect(result).toEqual({ type: 'switch-session', name: '' });
  });

  it('parses /clear command', () => {
    const result = parseCommand('/clear');
    expect(result).toEqual({ type: 'clear' });
  });

  it('parses /help command', () => {
    const result = parseCommand('/help');
    expect(result).toEqual({ type: 'help' });
  });

  it('treats /unknown as plain message', () => {
    const result = parseCommand('/unknown-command arg1');
    expect(result).toEqual({ type: 'message', content: '/unknown-command arg1' });
  });

  it('handles /Sessions (case-insensitive)', () => {
    const result = parseCommand('/Sessions');
    expect(result).toEqual({ type: 'sessions' });
  });

  it('handles /HELP (case-insensitive)', () => {
    const result = parseCommand('/HELP');
    expect(result).toEqual({ type: 'help' });
  });

  it('handles /CLEAR (case-insensitive)', () => {
    const result = parseCommand('/CLEAR');
    expect(result).toEqual({ type: 'clear' });
  });

  it('handles empty string as message', () => {
    const result = parseCommand('');
    expect(result).toEqual({ type: 'message', content: '' });
  });

  it('preserves original input for unknown slash commands', () => {
    const result = parseCommand('/foo bar baz');
    expect(result.type).toBe('message');
    if (result.type === 'message') {
      expect(result.content).toBe('/foo bar baz');
    }
  });
});

// ---------------------------------------------------------------------------
// US5: SessionManager
// ---------------------------------------------------------------------------

describe('US5: SessionManager tracks sessions', () => {
  it('starts with a primary session', () => {
    const mgr = new SessionManager();
    expect(mgr.currentSession).toBe('primary');
    expect(mgr.sessions).toHaveLength(1);
    expect(mgr.sessions[0].isCurrent).toBe(true);
    expect(mgr.isCrewMode).toBe(false);
  });

  it('adds a subagent session', () => {
    const mgr = new SessionManager();
    mgr.addSession('subagent-1', 'running');

    expect(mgr.sessions).toHaveLength(2);
    expect(mgr.isCrewMode).toBe(true);

    const added = mgr.sessions.find((s) => s.name === 'subagent-1');
    expect(added).toBeDefined();
    expect(added!.status).toBe('running');
    expect(added!.isCurrent).toBe(false);
  });

  it('ignores duplicate session names', () => {
    const mgr = new SessionManager();
    mgr.addSession('agent-x', 'idle');
    mgr.addSession('agent-x', 'running');

    expect(mgr.sessions).toHaveLength(2);
    const agent = mgr.sessions.find((s) => s.name === 'agent-x');
    // The first add wins — status stays 'idle'
    expect(agent!.status).toBe('idle');
  });

  it('switches between sessions', () => {
    const mgr = new SessionManager();
    mgr.addSession('subagent-1', 'running');
    mgr.addSession('subagent-2', 'completed');

    expect(mgr.currentSession).toBe('primary');

    const switched = mgr.switchTo('subagent-1');
    expect(switched).toBe(true);
    expect(mgr.currentSession).toBe('subagent-1');
    expect(mgr.sessions.find((s) => s.name === 'subagent-1')!.isCurrent).toBe(true);
    expect(mgr.sessions.find((s) => s.name === 'primary')!.isCurrent).toBe(false);
  });

  it('returns false when switching to nonexistent session', () => {
    const mgr = new SessionManager();
    const result = mgr.switchTo('nonexistent');
    expect(result).toBe(false);
    expect(mgr.currentSession).toBe('primary');
  });

  it('updates session status', () => {
    const mgr = new SessionManager();
    mgr.addSession('agent-a', 'running');

    mgr.updateStatus('agent-a', 'completed');
    const session = mgr.sessions.find((s) => s.name === 'agent-a');
    expect(session!.status).toBe('completed');
  });

  it('does nothing when updating nonexistent session', () => {
    const mgr = new SessionManager();
    mgr.updateStatus('nonexistent', 'running');
    expect(mgr.sessions).toHaveLength(1);
  });

  it('sessionList returns a copy (immutable)', () => {
    const mgr = new SessionManager();
    const list1 = mgr.sessionList;
    const list2 = mgr.sessionList;
    expect(list1).not.toBe(list2);
    expect(list1).toEqual(list2);
  });

  it('full session lifecycle: add, switch, update, switch back', () => {
    const mgr = new SessionManager();

    // Add two subagents
    mgr.addSession('researcher', 'running');
    mgr.addSession('writer', 'idle');

    expect(mgr.sessions).toHaveLength(3);
    expect(mgr.isCrewMode).toBe(true);

    // Switch to researcher
    mgr.switchTo('researcher');
    expect(mgr.currentSession).toBe('researcher');

    // Complete researcher
    mgr.updateStatus('researcher', 'completed');

    // Switch to writer
    mgr.switchTo('writer');
    expect(mgr.currentSession).toBe('writer');

    // Start writer
    mgr.updateStatus('writer', 'running');

    // Switch back to primary
    mgr.switchTo('primary');
    expect(mgr.currentSession).toBe('primary');

    // Verify final state
    const researcher = mgr.sessions.find((s) => s.name === 'researcher')!;
    expect(researcher.status).toBe('completed');
    expect(researcher.isCurrent).toBe(false);

    const writer = mgr.sessions.find((s) => s.name === 'writer')!;
    expect(writer.status).toBe('running');
    expect(writer.isCurrent).toBe(false);

    const primary = mgr.sessions.find((s) => s.name === 'primary')!;
    expect(primary.isCurrent).toBe(true);
  });
});
