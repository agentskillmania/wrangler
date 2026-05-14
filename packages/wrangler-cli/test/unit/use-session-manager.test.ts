import { describe, it, expect } from 'vitest';
import { SessionManager } from '../../src/hooks/use-session-manager.js';

describe('SessionManager', () => {
  it('starts with primary as current session', () => {
    const mgr = new SessionManager();
    expect(mgr.currentSession).toBe('primary');
    expect(mgr.sessions).toEqual([{ name: 'primary', status: 'idle', isCurrent: true }]);
  });

  it('adds a new session', () => {
    const mgr = new SessionManager();
    mgr.addSession('searcher', 'running');
    expect(mgr.sessions).toHaveLength(2);
    expect(mgr.sessions[1]).toEqual({
      name: 'searcher',
      status: 'running',
      isCurrent: false,
    });
  });

  it('switches to a different session', () => {
    const mgr = new SessionManager();
    mgr.addSession('searcher', 'running');
    const result = mgr.switchTo('searcher');
    expect(result).toBe(true);
    expect(mgr.currentSession).toBe('searcher');
    expect(mgr.sessions.find((s) => s.name === 'searcher')?.isCurrent).toBe(true);
    expect(mgr.sessions.find((s) => s.name === 'primary')?.isCurrent).toBe(false);
  });

  it('returns false when switching to unknown session', () => {
    const mgr = new SessionManager();
    const result = mgr.switchTo('unknown');
    expect(result).toBe(false);
    expect(mgr.currentSession).toBe('primary');
  });

  it('updates session status', () => {
    const mgr = new SessionManager();
    mgr.addSession('searcher', 'running');
    mgr.updateStatus('searcher', 'completed');
    expect(mgr.sessions.find((s) => s.name === 'searcher')?.status).toBe('completed');
  });

  it('isCrewMode returns false with only primary', () => {
    const mgr = new SessionManager();
    expect(mgr.isCrewMode).toBe(false);
  });

  it('isCrewMode returns true when sessions > 1', () => {
    const mgr = new SessionManager();
    mgr.addSession('searcher', 'running');
    expect(mgr.isCrewMode).toBe(true);
  });
});
