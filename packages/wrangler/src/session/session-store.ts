// packages/core/src/session/session-store.ts

import { mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createSnapshot, restoreSnapshot } from '@agentskillmania/colts';
import type { AgentState, Snapshot } from '@agentskillmania/colts';
import { writeMeta, readMeta } from './meta.js';
import { formatTranscriptEntry } from './transcript.js';
import type { SessionMeta, TranscriptEntry } from '../types.js';
import type { ConversationMessage } from './types.js';

/**
 * 计算 workspace 路径的 MD5 哈希，用于 session 目录分组
 */
function hashWorkspacePath(workspacePath: string): string {
  return createHash('md5').update(workspacePath).digest('hex');
}

/**
 * Session 持久化管理器
 *
 * 按 workspace 路径 MD5 分组存储 session。
 * session ID 直接使用 colts state.id（{timestamp}-{random}，无前缀）。
 *
 * 目录结构：
 * {baseDir}/{md5(workspacePath)}/{sessionId}/
 *   ├── meta.yaml
 *   ├── state.json    (Snapshot 格式)
 *   └── transcript.jsonl
 */
export class SessionStore {
  private readonly workspaceHash: string;

  constructor(
    private readonly baseDir: string,
    private readonly workspacePath: string
  ) {
    this.workspaceHash = hashWorkspacePath(workspacePath);
  }

  /** 获取 workspace 分组目录 */
  private getWorkspaceDir(): string {
    return join(this.baseDir, this.workspaceHash);
  }

  /** 获取 session 目录的完整路径 */
  getSessionDir(sessionId: string): string {
    return join(this.getWorkspaceDir(), sessionId);
  }

  /** 检查 session 是否存在（同步） */
  exists(sessionId: string): boolean {
    return existsSync(this.getSessionDir(sessionId));
  }

  /** 检查 session 目录是否存在（异步版本） */
  async existsAsync(sessionId: string): Promise<boolean> {
    try {
      await stat(this.getSessionDir(sessionId));
      return true;
    } catch {
      return false;
    }
  }

  /** 使用指定 ID 创建 session */
  async createWithId(sessionId: string, model: string): Promise<string> {
    const dir = this.getSessionDir(sessionId);
    await mkdir(dir, { recursive: true });

    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id: sessionId,
      workspacePath: this.workspacePath,
      createdAt: now,
      updatedAt: now,
      model,
      messageCount: 0,
    };
    await writeMeta(dir, meta);

    return sessionId;
  }

  /** 保存 AgentState 到 state.json（Snapshot 格式） */
  async saveState(sessionId: string, state: AgentState): Promise<void> {
    const dir = this.getSessionDir(sessionId);
    const snapshot = createSnapshot(state);
    await writeFile(join(dir, 'state.json'), JSON.stringify(snapshot, null, 2), 'utf-8');
  }

  /** 从 state.json 加载 AgentState */
  async loadState(sessionId: string): Promise<AgentState | null> {
    try {
      const dir = this.getSessionDir(sessionId);
      const raw = await readFile(join(dir, 'state.json'), 'utf-8');
      const snapshot: Snapshot = JSON.parse(raw);
      return restoreSnapshot(snapshot);
    } catch {
      return null;
    }
  }

  /** 追加一条 transcript 记录 */
  async appendTranscript(sessionId: string, entry: TranscriptEntry): Promise<void> {
    const dir = this.getSessionDir(sessionId);
    const content = formatTranscriptEntry(entry);
    await writeFile(join(dir, 'transcript.jsonl'), content, { flag: 'a', encoding: 'utf-8' });
  }

  /** 更新 session 元数据的部分字段 */
  async updateMeta(sessionId: string, updates: Partial<SessionMeta>): Promise<void> {
    const dir = this.getSessionDir(sessionId);
    const existing = await readMeta(dir);
    if (!existing) return;
    const updated: SessionMeta = { ...existing, ...updates, id: existing.id };
    await writeMeta(dir, updated);
  }

  /** 获取 session 元数据 */
  async getMeta(sessionId: string): Promise<SessionMeta | null> {
    const dir = this.getSessionDir(sessionId);
    return readMeta(dir);
  }

  /** 列出当前 workspace 的所有 session */
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

  /** 删除 session */
  async deleteSession(sessionId: string): Promise<void> {
    const dir = this.getSessionDir(sessionId);
    await rm(dir, { recursive: true, force: true });
  }

  // ─── Conversation model (Layer 5+, replaces transcript) ───

  /** Append a ConversationMessage to user-chat.jsonl */
  async appendMessage(sessionId: string, message: ConversationMessage): Promise<void> {
    const dir = this.getSessionDir(sessionId);
    const line = JSON.stringify(message) + '\n';
    await writeFile(join(dir, 'user-chat.jsonl'), line, { flag: 'a', encoding: 'utf-8' });
  }

  /** Read all ConversationMessages from user-chat.jsonl */
  async readConversation(sessionId: string): Promise<ConversationMessage[]> {
    try {
      const dir = this.getSessionDir(sessionId);
      const content = await readFile(join(dir, 'user-chat.jsonl'), 'utf-8');
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ConversationMessage);
    } catch {
      return [];
    }
  }
}
