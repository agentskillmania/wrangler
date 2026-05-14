import type { SessionInfo } from '../types.js';

/**
 * Pure-logic session manager for crew mode.
 * Tested independently of React hooks.
 */
export class SessionManager {
  private _sessions: SessionInfo[] = [
    { name: 'primary', status: 'idle', isCurrent: true },
  ];

  get currentSession(): string {
    return this._sessions.find((s) => s.isCurrent)?.name ?? 'primary';
  }

  get sessionList(): SessionInfo[] {
    return [...this._sessions];
  }

  get isCrewMode(): boolean {
    return this._sessions.length > 1;
  }

  addSession(
    name: string,
    status: 'running' | 'completed' | 'idle',
  ): void {
    if (this._sessions.some((s) => s.name === name)) return;
    this._sessions.push({ name, status, isCurrent: false });
  }

  switchTo(name: string): boolean {
    const target = this._sessions.find((s) => s.name === name);
    if (!target) return false;
    this._sessions.forEach((s) => (s.isCurrent = s.name === name));
    return true;
  }

  updateStatus(
    name: string,
    status: 'running' | 'completed' | 'idle',
  ): void {
    const session = this._sessions.find((s) => s.name === name);
    if (session) session.status = status;
  }

  /** Alias for test compatibility */
  get sessions(): SessionInfo[] {
    return this.sessionList;
  }
}
