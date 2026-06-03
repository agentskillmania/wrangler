// packages/core/src/session/session-store.ts

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { serializeState, deserializeState } from '@agentskillmania/colts';
import type { AgentState } from '@agentskillmania/colts';

import { writeMeta, readMeta } from './meta.js';
import type { SessionMeta } from '../types.js';
import type { SessionEntry } from './types.js';

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
 *   ├── state.json      (snapshot format)
 *   └── session.jsonl
 */
export class SessionStore {
  private readonly workspaceHash: string;
  /** Per-session write queue to prevent concurrent file corruption */
  private readonly writeQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly baseDir: string,
    private readonly workspacePath: string
  ) {
    this.workspaceHash = hashWorkspacePath(workspacePath);
  }

  /**
   * Serialize all writes for a given session to prevent race conditions.
   * Concurrent writes to state.json / session.jsonl / meta.yaml
   * can corrupt files or lose updates.
   */
  private async serialize<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(sessionId) ?? Promise.resolve();
    const next = previous.then(() => operation());
    this.writeQueues.set(sessionId, next);
    try {
      return await next;
    } finally {
      if (this.writeQueues.get(sessionId) === next) {
        this.writeQueues.delete(sessionId);
      }
    }
  }

  /** Get workspace group directory */
  private getWorkspaceDir(): string {
    return join(this.baseDir, this.workspaceHash);
  }

  /** Get full path to session directory */
  getSessionDir(sessionId: string): string {
    return join(this.getWorkspaceDir(), sessionId);
  }

  /** Check if session exists (synchronous) */
  exists(sessionId: string): boolean {
    return existsSync(this.getSessionDir(sessionId));
  }

  /** Check if session directory exists (async) */
  async existsAsync(sessionId: string): Promise<boolean> {
    try {
      await stat(this.getSessionDir(sessionId));
      return true;
    } catch {
      return false;
    }
  }

  /** Create session with specified ID, model, and agent name */
  async createWithId(sessionId: string, model: string, agentName: string): Promise<string> {
    const dir = this.getSessionDir(sessionId);
    await mkdir(dir, { recursive: true });

    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id: sessionId,
      workspacePath: this.workspacePath,
      createdAt: now,
      updatedAt: now,
      model,
      agentName,
    };
    await writeMeta(dir, meta);

    return sessionId;
  }

  /** Save AgentState to state.json (snapshot format) */
  async saveState(sessionId: string, state: AgentState): Promise<void> {
    return this.serialize(sessionId, async () => {
      const dir = this.getSessionDir(sessionId);
      const json = serializeState(state);
      await writeFile(join(dir, 'state.json'), json, 'utf-8');
    });
  }

  /** Load AgentState from state.json */
  async loadState(sessionId: string): Promise<AgentState | null> {
    try {
      const dir = this.getSessionDir(sessionId);
      const raw = await readFile(join(dir, 'state.json'), 'utf-8');
      return deserializeState(raw);
    } catch {
      return null;
    }
  }

  /** Append a SessionEntry to session.jsonl */
  async appendEntry(sessionId: string, entry: SessionEntry): Promise<void> {
    return this.serialize(sessionId, async () => {
      const dir = this.getSessionDir(sessionId);
      const line = JSON.stringify(entry) + '\n';
      await writeFile(join(dir, 'session.jsonl'), line, { flag: 'a', encoding: 'utf-8' });
    });
  }

  /** Read all SessionEntries from session.jsonl */
  async readEntries(sessionId: string): Promise<SessionEntry[]> {
    try {
      const dir = this.getSessionDir(sessionId);
      const content = await readFile(join(dir, 'session.jsonl'), 'utf-8');
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as SessionEntry);
    } catch {
      return [];
    }
  }

  /** Update partial fields of session metadata */
  async updateMeta(sessionId: string, updates: Partial<SessionMeta>): Promise<void> {
    return this.serialize(sessionId, async () => {
      const dir = this.getSessionDir(sessionId);
      const existing = await readMeta(dir);
      if (!existing) return;
      const updated: SessionMeta = { ...existing, ...updates, id: existing.id };
      await writeMeta(dir, updated);
    });
  }

  /** Get session metadata */
  async getMeta(sessionId: string): Promise<SessionMeta | null> {
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
  async deleteSession(sessionId: string): Promise<void> {
    const dir = this.getSessionDir(sessionId);
    await rm(dir, { recursive: true, force: true });
  }

  /**
   * Resume an existing session by loading state, meta, and recent entries.
   * Returns null if the session does not exist or state.json is missing.
   */
  async resume(
    sessionId: string
  ): Promise<{ state: AgentState; meta: SessionMeta; recentEntries: SessionEntry[] } | null> {
    const meta = await this.getMeta(sessionId);
    if (!meta) return null;
    const state = await this.loadState(sessionId);
    if (!state) return null;
    const recentEntries = await this.readEntries(sessionId);
    return { state, meta, recentEntries };
  }
}
