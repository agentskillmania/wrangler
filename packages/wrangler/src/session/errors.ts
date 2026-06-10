/**
 * SessionNotFoundError — thrown when a session directory is missing,
 * incomplete, or lacks required metadata (e.g. runnerConfig snapshot).
 */
export class SessionNotFoundError extends Error {
  constructor(public readonly sessionDir: string) {
    super(`Session not found or incomplete: ${sessionDir}`);
    this.name = 'SessionNotFoundError';
  }
}
