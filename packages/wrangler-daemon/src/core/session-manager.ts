import { mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SessionStore, readMeta } from '@agentskillmania/wrangler';
import type { SessionMeta } from '@agentskillmania/wrangler';
import type { AgentSession } from './agent-session.js';

/**
 * Manages session discovery, query, and deletion.
 *
 * Sessions are created automatically by wrangler session middleware during
 * runner.run(). This class only handles:
 * - Discovering existing sessions on disk
 * - Querying session metadata
 * - Deleting sessions
 * - Runtime status tracking (in-memory)
 * - Active AgentSession pool
 */
export class SessionManager {
  private readonly sessionStores = new Map<string, SessionStore>();
  private readonly sessionWorkspaces = new Map<string, string>();
  private readonly runtimeStatus = new Map<string, string>();
  private activeSessions = new Map<string, AgentSession>();
  private readonly _baseDir: string;

  constructor(baseDir: string) {
    this._baseDir = resolve(baseDir);
  }

  /** Create base directory and discover existing sessions */
  async init(): Promise<void> {
    await mkdir(this._baseDir, { recursive: true });
    await this.discoverExistingSessions();
  }

  /** Get the session base directory path */
  get baseDir(): string {
    return this._baseDir;
  }

  /** Scan base directory to discover sessions from previous runs */
  private async discoverExistingSessions(): Promise<void> {
    if (!existsSync(this._baseDir)) return;
    try {
      const hashDirs = await readdir(this._baseDir, { withFileTypes: true });
      for (const hashDir of hashDirs) {
        if (!hashDir.isDirectory()) continue;
        const hashPath = join(this._baseDir, hashDir.name);
        const sessionDirs = await readdir(hashPath, { withFileTypes: true });
        for (const sd of sessionDirs) {
          if (!sd.isDirectory()) continue;
          const meta = await readMeta(join(hashPath, sd.name));
          if (meta) {
            this.sessionWorkspaces.set(sd.name, meta.workspacePath);
            this.getOrCreateStore(meta.workspacePath);
          }
        }
      }
    } catch {
      /* empty or unreadable base dir */
    }
  }

  /** Get or create a SessionStore for a workspace path */
  private getOrCreateStore(workspacePath: string): SessionStore {
    const absolute = resolve(workspacePath);
    let store = this.sessionStores.get(absolute);
    if (!store) {
      store = new SessionStore(this._baseDir, absolute);
      this.sessionStores.set(absolute, store);
    }
    return store;
  }

  /** Get SessionStore for a session id (returns null if session unknown) */
  private getStoreForSession(sessionId: string): SessionStore | null {
    const wsPath = this.sessionWorkspaces.get(sessionId);
    if (!wsPath) return null;
    return this.getOrCreateStore(wsPath);
  }

  /**
   * Register a session created by wrangler middleware.
   *
   * Called after wrangler auto-creates a session during runner.run(),
   * to update the in-memory workspace mapping.
   */
  registerSession(sessionId: string, workspacePath: string): void {
    const absolute = resolve(workspacePath);
    this.sessionWorkspaces.set(sessionId, absolute);
    this.getOrCreateStore(absolute);
    this.runtimeStatus.set(sessionId, 'idle');
  }

  /** Get session metadata from disk */
  async getInfo(id: string): Promise<SessionMeta | null> {
    const store = this.getStoreForSession(id);
    if (!store) return null;
    return store.getMeta(id);
  }

  /** List sessions, optionally filtered by workspace, sorted by most recently updated */
  async list(workspacePath?: string): Promise<SessionMeta[]> {
    const all: SessionMeta[] = [];
    if (workspacePath) {
      const absolute = resolve(workspacePath);
      const store = this.sessionStores.get(absolute);
      if (store) {
        const sessions = await store.listSessions();
        all.push(...sessions);
      }
    } else {
      for (const store of this.sessionStores.values()) {
        const sessions = await store.listSessions();
        all.push(...sessions);
      }
    }
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Delete session from disk and clear runtime state */
  async delete(id: string): Promise<void> {
    const session = this.activeSessions.get(id);
    if (session) {
      session.stop();
      this.activeSessions.delete(id);
    }
    const store = this.getStoreForSession(id);
    if (store) {
      await store.deleteSession(id);
    }
    this.sessionWorkspaces.delete(id);
    this.runtimeStatus.delete(id);
  }

  /** Get runtime status (in-memory, defaults to 'idle') */
  getStatus(id: string): string {
    return this.runtimeStatus.get(id) ?? 'idle';
  }

  /** Update runtime status (in-memory only, not persisted) */
  updateStatus(id: string, status: string): void {
    this.runtimeStatus.set(id, status);
  }

  /** Get SessionStore for a workspace (for AgentSession to use) */
  getSessionStore(workspacePath: string): SessionStore {
    return this.getOrCreateStore(workspacePath);
  }

  /** Store an active AgentSession */
  setAgentSession(id: string, session: AgentSession): void {
    this.activeSessions.set(id, session);
  }

  /** Get active AgentSession by id */
  getAgentSession(id: string): AgentSession | null {
    return this.activeSessions.get(id) ?? null;
  }

  /** Number of sessions with active AgentSession instances */
  get activeCount(): number {
    return this.activeSessions.size;
  }

  /** Stop all active sessions (used during shutdown) */
  stopAll(): void {
    for (const session of this.activeSessions.values()) {
      session.stop();
    }
    this.activeSessions.clear();
  }
}
