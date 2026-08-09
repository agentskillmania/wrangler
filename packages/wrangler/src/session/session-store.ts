// packages/core/src/session/session-store.ts

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { serializeState, deserializeState } from '@agentskillmania/colts';
import type { AgentState } from '@agentskillmania/colts';

import { writeMeta, readMeta } from './meta.js';
import type { SessionMeta } from '../types.js';

/**
 * Compute MD5 hash of workspace path for session directory grouping.
 */
function hashWorkspacePath(workspacePath: string): string {
  const absolute = resolve(workspacePath);
  return createHash('md5').update(absolute).digest('hex');
}

/**
 * Session persistence manager.
 *
 * Sessions are stored grouped by workspace path MD5 hash.
 * Session ID uses colts state.id directly ({timestamp}-{random}, no prefix).
 *
 * Directory structure:
 * {baseDir}/{md5(workspacePath)}/{sessionId}/
 *   ├── meta.yaml
 *   └── state.json
 */
export class SessionStore {
  private readonly workspaceHash: string;
  /** Per-session write queue to prevent concurrent file corruption */
  private readonly writeQueues = new Map<string, Promise<unknown>>();
  private _sessionDir?: string;

  /** Whether this store is bound directly to a session directory. */
  get isDirBound(): boolean {
    return this._sessionDir !== undefined;
  }

  constructor(
    private readonly baseDir: string,
    private readonly workspacePath: string
  ) {
    this.workspaceHash = hashWorkspacePath(workspacePath);
  }

  /**
   * Create a SessionStore directly bound to a session directory.
   * All operations target this directory without requiring sessionId.
   */
  static fromDir(sessionDir: string): SessionStore {
    const store = new SessionStore('', '');
    store._sessionDir = sessionDir;
    return store;
  }

  /**
   * Serialize all writes for a given session to prevent race conditions.
   * Concurrent writes to state.json / meta.yaml
   * can corrupt files or lose updates.
   */
  private async serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(key) ?? Promise.resolve();
    const next = previous.then(() => operation());
    this.writeQueues.set(key, next);
    try {
      return await next;
    } finally {
      if (this.writeQueues.get(key) === next) {
        this.writeQueues.delete(key);
      }
    }
  }

  /** Get workspace group directory */
  private getWorkspaceDir(): string {
    return join(this.baseDir, this.workspaceHash);
  }

  /** Get full path to session directory */
  getSessionDir(sessionId?: string): string {
    if (this._sessionDir) {
      if (sessionId) {
        throw new Error('Directory-bound SessionStore does not accept sessionId');
      }
      return this._sessionDir;
    }
    if (sessionId === undefined) {
      throw new Error('sessionId is required for workspace-based SessionStore');
    }
    return join(this.getWorkspaceDir(), sessionId);
  }

  /** Check if session exists (synchronous) */
  exists(sessionId?: string): boolean {
    return existsSync(this.getSessionDir(sessionId));
  }

  /** Check if session directory exists (async) */
  async existsAsync(sessionId?: string): Promise<boolean> {
    try {
      await stat(this.getSessionDir(sessionId));
      return true;
    } catch {
      return false;
    }
  }

  private getQueueKey(sessionId?: string): string {
    return this._sessionDir ?? sessionId ?? '_unknown_';
  }

  /** Create session with specified ID and agent name.
   *  Pass undefined for sessionId in dir-bound mode. */
  async createWithId(
    sessionId: string | undefined,
    agentName: string
  ): Promise<string | undefined> {
    const dir = this.getSessionDir(sessionId);
    await mkdir(dir, { recursive: true });

    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id: sessionId,
      workspacePath: this.workspacePath,
      createdAt: now,
      updatedAt: now,
      agentName,
      runnerConfig: { model: '' },
    };
    await writeMeta(dir, meta);

    return sessionId;
  }

  /** Save AgentState to state.json (snapshot format) */
  async saveState(sessionId: string | undefined, state: AgentState): Promise<void> {
    return this.serialize(this.getQueueKey(sessionId), async () => {
      const dir = this.getSessionDir(sessionId);
      const json = serializeState(state);
      await writeFile(join(dir, 'state.json'), json, 'utf-8');
    });
  }

  /** Load AgentState from state.json */
  async loadState(sessionId?: string): Promise<AgentState | null> {
    try {
      const dir = this.getSessionDir(sessionId);
      const raw = await readFile(join(dir, 'state.json'), 'utf-8');
      return deserializeState(raw);
    } catch {
      return null;
    }
  }

  /** Update partial fields of session metadata */
  async updateMeta(sessionId: string | undefined, updates: Partial<SessionMeta>): Promise<void> {
    return this.serialize(this.getQueueKey(sessionId), async () => {
      const dir = this.getSessionDir(sessionId);
      const existing = await readMeta(dir);
      if (!existing) return;
      const updated: SessionMeta = { ...existing, ...updates, id: existing.id };
      await writeMeta(dir, updated);
    });
  }

  /** Get session metadata */
  async getMeta(sessionId?: string): Promise<SessionMeta | null> {
    const dir = this.getSessionDir(sessionId);
    return readMeta(dir);
  }

  /** List all sessions for current workspace */
  async listSessions(): Promise<SessionMeta[]> {
    try {
      const wsDir = this.getWorkspaceDir();
      const entries = await readdir(wsDir, { withFileTypes: true });
      const metas: SessionMeta[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = await readMeta(join(wsDir, entry.name));
        if (meta) {
          metas.push(meta);
        }
      }

      return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  /** Delete session */
  async deleteSession(sessionId?: string): Promise<void> {
    const dir = this.getSessionDir(sessionId);
    await rm(dir, { recursive: true, force: true });
  }

  /**
   * Resume an existing session by loading state and meta.
   * Returns null if the session does not exist or state.json is missing.
   */
  async resume(sessionId: string): Promise<{ state: AgentState; meta: SessionMeta } | null> {
    const meta = await this.getMeta(sessionId);
    if (!meta) return null;
    const state = await this.loadState(sessionId);
    if (!state) return null;
    return { state, meta };
  }
}
