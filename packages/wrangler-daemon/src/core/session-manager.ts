import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { SessionStore, readMeta } from '@agentskillmania/wrangler';
import type { SessionMeta, HostEnv } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';

import type { AgentSession } from './agent-session.js';

/**
 * 温会话默认闲置 TTL（毫秒）。
 *
 * 对齐 Rust `SessionManager::DEFAULT_IDLE_TTL`（crates/wrangler/src/session/
 * manager.rs：`Duration::from_secs(30 * 60)`——30 分钟，具名 const，无 config
 * 配置位）。闲置超 TTL 且满足冷却资格的温会话被惰性驱逐（温→冷）。
 */
export const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;

/** SessionManager 构造选项（R2P-121，闲置 TTL 惰性驱逐）。 */
export interface SessionManagerOptions {
  /** 闲置 TTL（毫秒）；默认 DEFAULT_IDLE_TTL_MS（对齐 Rust，无 config 位）。 */
  idleTtlMs?: number;
  /** 时钟注入（测试假时钟，不真 sleep）；默认 () => Date.now()。 */
  now?: () => number;
}

/**
 * Manages session discovery, query, and deletion.
 *
 * Sessions are created automatically by wrangler session middleware during
 * runner.run(). This class only handles:
 * - Discovering existing sessions on disk
 * - Querying session metadata
 * - Deleting sessions
 * - Runtime status tracking (in-memory)
 * - Active AgentSession pool（温会话注册表——条目生命周期是"会话未冷却"，
 *   而非"轮在跑"；闲置超 TTL 惰性驱逐，见 evictIdleSessions）
 */
export class SessionManager {
  private readonly sessionStores = new Map<string, SessionStore>();
  private readonly sessionWorkspaces = new Map<string, string>();
  private readonly runtimeStatus = new Map<string, string>();
  private activeSessions = new Map<string, AgentSession>();
  /**
   * Cold-start assembly reservations (R2P-161, mirrors Rust 32e79ce /
   * 098adbd 地基C). Lazy AgentSession assembly is check → await → register;
   * the reservation synchronously occupies the registry slot between the
   * check and the register so two concurrent first messages on the same
   * cold session cannot each build an AgentSession and overwrite each
   * other (orphaned runner + double persistence).
   */
  private readonly reservedAgentSessions = new Set<string>();
  /**
   * 温会话的最后活动时刻（毫秒，this.now() 域）——闲置 TTL 驱逐判定用，
   * 对齐 Rust `Session::last_active`。触碰点（对齐 Rust Session::touch 只在
   * 轮驱动入口）：setAgentSession（发布即物化时刻）+ AgentSession.driveTurn
   * （handleMessage / continueRun 共用收口，经 touchAgentSession 回调）。
   * 观察（cockpit SSE / 诊断快照）不触碰。
   */
  private readonly lastActiveAt = new Map<string, number>();
  private readonly _baseDir: string;
  private readonly runtime: HostEnv;
  private readonly idleTtlMs: number;
  private readonly now: () => number;

  constructor(
    baseDir: string,
    runtime: HostEnv = defaultNodeHostEnv,
    options: SessionManagerOptions = {}
  ) {
    this._baseDir = resolve(baseDir);
    this.runtime = runtime;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.now = options.now ?? (() => Date.now());
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
          const meta = await readMeta(join(hashPath, sd.name), this.runtime);
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
      store = new SessionStore(this._baseDir, absolute, this.runtime);
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
    // Also drop a pending cold-start reservation — deleting mid-assembly
    // must not leave the slot stuck.
    this.reservedAgentSessions.delete(id);
    this.lastActiveAt.delete(id);
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

  /**
   * Synchronously reserve the cold-start assembly slot for a session id.
   *
   * MUST be called with zero awaits after the getAgentSession() miss —
   * callers win or lose atomically (single-threaded JS: no interleaving
   * between the checks and the add below). Returns false when a real
   * AgentSession is already registered or another caller holds the slot.
   *
   * Pair with setAgentSession() on success (settles the reservation) or
   * cancelAgentSessionReservation() on failure (frees the slot for a
   * retry — a leaked reservation would 409 the session forever).
   */
  tryReserveAgentSession(id: string): boolean {
    if (this.activeSessions.has(id)) return false;
    if (this.reservedAgentSessions.has(id)) return false;
    this.reservedAgentSessions.add(id);
    return true;
  }

  /** Release a cold-start reservation whose assembly failed. */
  cancelAgentSessionReservation(id: string): void {
    this.reservedAgentSessions.delete(id);
    this.lastActiveAt.delete(id);
  }

  /**
   * Read-only query: is a cold-start assembly currently holding the slot
   * for this id (R2P-161b①, aligns Rust 098adbd's registry-first delete)?
   * DELETE uses this to refuse deleting mid-assembly — clearing the
   * placeholder under an in-flight assembly lets its `finally` re-register
   * a zombie AgentSession over the deleted disk (afterRun persistence then
   * resurrects the directory).
   */
  isReservedAgentSession(id: string): boolean {
    return this.reservedAgentSessions.has(id);
  }

  /**
   * Store an active AgentSession. Also settles any pending cold-start
   * reservation for the id (assembly completed — publish over the slot).
   *
   * R2P-121（对齐 Rust `SessionManager::insert/try_insert` 顺手做一次 TTL
   * 驱逐）：注册前先清扫安静且闲置超龄的温会话——注册表只增不驱会让每个
   * 聊天会话的 AgentSession（runner/LLM client）常驻至进程重启，daemon
   * 长跑内存单调增长。发布即触碰活动时刻（对齐 Rust Session 构造时
   * `last_active: Instant::now()`——物化即温）。
   */
  setAgentSession(id: string, session: AgentSession): void {
    this.sweepIdleAgentSessions();
    this.reservedAgentSessions.delete(id);
    this.activeSessions.set(id, session);
    this.lastActiveAt.set(id, this.now());
  }

  /**
   * Touch the session's activity timestamp（R2P-121 闲置 TTL 的活动侧）。
   *
   * 对齐 Rust `Session::touch`——只在轮驱动入口调用：AgentSession.driveTurn
   * （handleMessage 与 continueRun 的共用收口）在置 busy 时回调这里。近期
   * 有活动的会话即使注册时间超龄也不可驱逐。只记录在册（active）会话：
   * 已驱逐/已删除 id 的迟到触碰不复活条目（否则 lastActiveAt 缓慢漏水）。
   */
  touchAgentSession(id: string): void {
    if (this.activeSessions.has(id)) {
      this.lastActiveAt.set(id, this.now());
    }
  }

  /**
   * 公开惰性驱逐入口（R2P-121，对齐 Rust `SessionManager::evict_idle` 的
   * 公开形态——daemon 在健康快照等时机顺带触发，不让回收只依赖"有新会话
   * 插入"）。驱逐=内存下线、盘保留（温→冷；盘是事实源，写穿保证任意时刻
   * 下线不丢一致性；删盘是 DELETE 端点的职责）。幂等：已驱逐的不再处理。
   *
   * @returns 本次下线的温会话数（重复触发为 0）
   */
  evictIdleSessions(): number {
    return this.sweepIdleAgentSessions();
  }

  /**
   * 惰性清扫：冷却资格 + 闲置判定，缺一不可（对齐 Rust
   * `evict_idle_locked` 的 `!(is_quiet() && idle_for() > ttl)` 谓词）。
   *
   * 冷却资格（本批 R2P-121 的 TS 裁剪）：
   * 1. 非 busy——轮在飞不可下线（对齐 Rust turn_gate 臂）；
   * 2. 非占位——reservedAgentSessions（R2P-161）是冷装配闭锁不是闲置
   *    资源，清扫永不摘除。现行不变量下 active 与 reserved 互斥
   *    （tryReserveAgentSession 见 active 即拒），此处显式判定防不变量漂移。
   *
   * TS 裁剪说明：Rust `Session::is_quiet` 还有两臂——子女清零（Supervisor
   * 登记簿）与邮箱空（未消化投递）——属 P2-c 异步委派批；P2-c 回归点：
   * 在此扩臂（children / pendingDeliveries），谓词仍取"缺一不可"。
   *
   * 下线动作 = 纯注册表摘除（对齐 Rust `reg.retain` 直接 drop Arc，不调
   * stop——非 busy 会话无在飞轮可停）；runtimeStatus / sessionWorkspaces /
   * 盘目录全部原样保留，下一条消息经 assembleResumeSession 从盘重新物化。
   */
  private sweepIdleAgentSessions(): number {
    let evicted = 0;
    for (const [id, session] of this.activeSessions) {
      if (session.busy || this.reservedAgentSessions.has(id)) continue;
      const last = this.lastActiveAt.get(id);
      if (last === undefined) continue; // 无活动记录不驱（保守；注册即 touch，理论不可达）
      if (this.now() - last <= this.idleTtlMs) continue; // 严格大于，对齐 idle_for() > ttl
      this.activeSessions.delete(id);
      this.lastActiveAt.delete(id);
      evicted++;
    }
    return evicted;
  }

  /**
   * Get active AgentSession by id. A pending cold-start reservation is
   * invisible here (returns null): while assembly is in flight there is
   * no real session to stop or respond to yet.
   */
  getAgentSession(id: string): AgentSession | null {
    return this.activeSessions.get(id) ?? null;
  }

  /** Iterate over all active AgentSession entries */
  getAllAgentSessions(): IterableIterator<[string, AgentSession]> {
    return this.activeSessions.entries();
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
    this.reservedAgentSessions.clear();
    this.lastActiveAt.clear();
  }
}
