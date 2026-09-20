import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { SessionManager } from '../../src/core/session-manager.js';

describe('SessionManager', () => {
  let tempDir: string;
  let sessionsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-session-test-'));
    sessionsDir = join(tempDir, 'sessions');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('init creates base directory', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    expect(existsSync(sessionsDir)).toBe(true);
  });

  it('registerSession makes session discoverable', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();

    const wsPath = join(tempDir, 'workspace');
    manager.registerSession('test-id-1', wsPath);

    expect(manager.getStatus('test-id-1')).toBe('idle');
    const store = manager.getSessionStore(wsPath);
    expect(store).toBeTruthy();
  });

  it('registerSession returns same store for same workspace', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();

    const wsPath = join(tempDir, 'workspace');
    manager.registerSession('id-1', wsPath);
    manager.registerSession('id-2', wsPath);

    const store1 = manager.getSessionStore(wsPath);
    const store2 = manager.getSessionStore(wsPath);
    expect(store1).toBe(store2);
  });

  it('getInfo returns null for unknown session', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    expect(await manager.getInfo('nonexistent')).toBeNull();
  });

  it('list returns empty when no sessions', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    const sessions = await manager.list();
    expect(sessions).toHaveLength(0);
  });

  it('delete clears runtime state', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    const wsPath = join(tempDir, 'workspace');

    manager.registerSession('del-id', wsPath);
    // Write session meta so getInfo and delete can find it
    const store = manager.getSessionStore(wsPath);
    await store.createWithId('del-id', 'test-agent');

    await manager.delete('del-id');

    expect(await manager.getInfo('del-id')).toBeNull();
    expect(manager.getStatus('del-id')).toBe('idle');
  });

  it('delete also clears active AgentSession', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    const wsPath = join(tempDir, 'workspace');

    manager.registerSession('del-id', wsPath);
    const store = manager.getSessionStore(wsPath);
    await store.createWithId('del-id', 'test');

    const mockSession = { stop: vi.fn() } as any;
    manager.setAgentSession('del-id', mockSession);
    await manager.delete('del-id');

    expect(mockSession.stop).toHaveBeenCalled();
    expect(manager.getAgentSession('del-id')).toBeNull();
  });

  it('delete() tombstone blocks re-reserve and late publish during the disk await (R2P-163b①)', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    const wsPath = join(tempDir, 'workspace');
    manager.registerSession('tomb-id', wsPath);
    const store = manager.getSessionStore(wsPath);
    await store.createWithId('tomb-id', 'test');

    // Stretch the disk-delete await so the interleaving is deterministic:
    // wrap the session store's deleteSession with a controlled gate.
    const gated = new Promise<void>((resolve) => setTimeout(resolve, 25));
    const original = store.deleteSession.bind(store);
    const spy = vi.spyOn(store, 'deleteSession').mockImplementation(async (id: string) => {
      await gated;
      return original(id);
    });

    const deleting = manager.delete('tomb-id');

    // During the disk await: a new cold first-message cannot re-reserve…
    expect(manager.tryReserveAgentSession('tomb-id')).toBe(false);
    // …and an in-flight assembly's late publish is stopped and dropped.
    const lateSession = { stop: vi.fn() } as any;
    manager.setAgentSession('tomb-id', lateSession);
    expect(lateSession.stop).toHaveBeenCalled();

    await deleting;
    spy.mockRestore();
    expect(manager.getAgentSession('tomb-id')).toBeNull();
    expect(await manager.getInfo('tomb-id')).toBeNull();
    // Tombstone removed after completion: normal reservation works again.
    expect(manager.tryReserveAgentSession('tomb-id')).toBe(true);
  });

  it('delete() is idempotent for concurrent calls (tombstone second entry returns)', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    const wsPath = join(tempDir, 'workspace');
    manager.registerSession('idem-id', wsPath);
    const store = manager.getSessionStore(wsPath);
    await store.createWithId('idem-id', 'test');

    await Promise.all([manager.delete('idem-id'), manager.delete('idem-id')]);
    expect(manager.getAgentSession('idem-id')).toBeNull();
  });

  it('runtime status is in-memory', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    const wsPath = join(tempDir, 'workspace');
    manager.registerSession('status-id', wsPath);

    expect(manager.getStatus('status-id')).toBe('idle');
    manager.updateStatus('status-id', 'running');
    expect(manager.getStatus('status-id')).toBe('running');
  });

  it('getStatus returns idle for unknown session', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    expect(manager.getStatus('unknown')).toBe('idle');
  });

  it('init discovers existing sessions', async () => {
    // Use SessionStore to create a real session on disk
    const { SessionStore } = await import('@agentskillmania/wrangler');
    const { defaultNodeHostEnv } = await import('@agentskillmania/wrangler/host-env/node-host-env');
    const wsPath = join(tempDir, 'workspace');

    const store = new SessionStore(sessionsDir, wsPath, defaultNodeHostEnv);
    await store.createWithId('discover-1', 'existing-agent');

    // New manager should discover it
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    const info = await manager.getInfo('discover-1');
    expect(info).not.toBeNull();
    expect(info!.agentName).toBe('existing-agent');
  });

  it('getSessionStore returns SessionStore for workspace', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    const wsPath = join(tempDir, 'workspace');
    const store = manager.getSessionStore(wsPath);
    expect(store).toBeTruthy();
    // Same workspace returns same instance
    expect(manager.getSessionStore(wsPath)).toBe(store);
  });

  it('activeCount tracks active sessions', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    expect(manager.activeCount).toBe(0);

    const wsPath = join(tempDir, 'workspace');
    manager.registerSession('active-1', wsPath);
    manager.setAgentSession('active-1', {} as any);
    expect(manager.activeCount).toBe(1);
  });

  it('stopAll stops all active sessions', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();

    manager.registerSession('stop-1', join(tempDir, 'ws1'));
    manager.registerSession('stop-2', join(tempDir, 'ws2'));

    let stopped1 = false;
    let stopped2 = false;
    manager.setAgentSession('stop-1', {
      stop: () => {
        stopped1 = true;
      },
    } as any);
    manager.setAgentSession('stop-2', {
      stop: () => {
        stopped2 = true;
      },
    } as any);

    manager.stopAll();
    expect(stopped1).toBe(true);
    expect(stopped2).toBe(true);
    expect(manager.activeCount).toBe(0);
  });

  it('list with workspacePath filters to that workspace', async () => {
    const { SessionStore } = await import('@agentskillmania/wrangler');
    const { defaultNodeHostEnv } = await import('@agentskillmania/wrangler/host-env/node-host-env');
    const ws1 = join(tempDir, 'ws-filter-1');
    const ws2 = join(tempDir, 'ws-filter-2');

    const store1 = new SessionStore(sessionsDir, ws1, defaultNodeHostEnv);
    const store2 = new SessionStore(sessionsDir, ws2, defaultNodeHostEnv);
    await store1.createWithId('ws1-s1', 'a1');
    await store1.createWithId('ws1-s2', 'a2');
    await store2.createWithId('ws2-s1', 'b1');

    const manager = new SessionManager(sessionsDir);
    await manager.init();

    const all = await manager.list();
    expect(all).toHaveLength(3);

    const ws1Sessions = await manager.list(ws1);
    expect(ws1Sessions).toHaveLength(2);
    expect(ws1Sessions.every((s) => s.workspacePath === ws1)).toBe(true);

    const ws2Sessions = await manager.list(ws2);
    expect(ws2Sessions).toHaveLength(1);
    expect(ws2Sessions[0].workspacePath).toBe(ws2);
  });

  it('list with unknown workspacePath returns empty', async () => {
    const manager = new SessionManager(sessionsDir);
    await manager.init();
    const result = await manager.list(join(tempDir, 'nonexistent'));
    expect(result).toHaveLength(0);
  });

  describe('concurrent access', () => {
    it('concurrent registerSession calls for same workspace return same store', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();
      const wsPath = join(tempDir, 'shared-workspace');

      // Fire 10 concurrent registerSession calls with different IDs but same workspace
      const ids = Array.from({ length: 10 }, (_, i) => `concurrent-same-${i}`);
      for (const id of ids) {
        manager.registerSession(id, wsPath);
      }

      // All registrations must map to the same SessionStore instance
      const store = manager.getSessionStore(wsPath);
      for (const id of ids) {
        expect(manager.getStatus(id)).toBe('idle');
      }

      // Verify no duplicate store was created by checking Map consistency
      const storeAgain = manager.getSessionStore(wsPath);
      expect(storeAgain).toBe(store);
    });

    it('concurrent registerSession with different workspaces creates distinct stores', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();

      const workspacePaths = Array.from({ length: 10 }, (_, i) => join(tempDir, `workspace-${i}`));

      // Register sessions across 10 different workspaces
      workspacePaths.forEach((wsPath, i) => {
        manager.registerSession(`diff-ws-${i}`, wsPath);
      });

      // Each workspace must get its own distinct SessionStore
      const stores = workspacePaths.map((wsPath) => manager.getSessionStore(wsPath));
      const uniqueStores = new Set(stores);
      expect(uniqueStores.size).toBe(10);

      // Verify each session is properly tracked
      workspacePaths.forEach((_wsPath, i) => {
        expect(manager.getStatus(`diff-ws-${i}`)).toBe('idle');
      });
    });

    it('concurrent delete of same session does not throw and clears state', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();
      const wsPath = join(tempDir, 'workspace');

      manager.registerSession('concurrent-del', wsPath);
      const store = manager.getSessionStore(wsPath);
      await store.createWithId('concurrent-del', 'test-agent');

      // Fire 5 concurrent deletes on the same session
      const deletePromises = Array.from({ length: 5 }, () => manager.delete('concurrent-del'));
      await Promise.all(deletePromises);

      // Session should be fully removed from both disk and memory
      expect(await manager.getInfo('concurrent-del')).toBeNull();
      expect(manager.getStatus('concurrent-del')).toBe('idle');
    });

    it('concurrent delete of different sessions removes all', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();
      const wsPath = join(tempDir, 'workspace');

      // Register 5 sessions and write meta for each
      const ids = Array.from({ length: 5 }, (_, i) => `multi-del-${i}`);
      const store = manager.getSessionStore(wsPath);
      for (const id of ids) {
        manager.registerSession(id, wsPath);
        await store.createWithId(id, 'test-agent');
      }

      // Delete all 5 concurrently
      await Promise.all(ids.map((id) => manager.delete(id)));

      // All sessions should be gone
      for (const id of ids) {
        expect(await manager.getInfo(id)).toBeNull();
      }
      const remaining = await manager.list();
      expect(remaining).toHaveLength(0);
    });

    it('concurrent updateStatus on same session leaves a valid final status', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('status-race', wsPath);

      const validStatuses = ['idle', 'running', 'paused', 'stopping', 'completed', 'error'];

      // Fire 20 concurrent status updates
      const promises = Array.from({ length: 20 }, (_, i) =>
        Promise.resolve(
          manager.updateStatus('status-race', validStatuses[i % validStatuses.length])
        )
      );
      await Promise.all(promises);

      // Final status must be one of the valid values (not corrupted)
      const finalStatus = manager.getStatus('status-race');
      expect(validStatuses).toContain(finalStatus);
    });

    it('concurrent list during mutations stays consistent', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();

      // Start registering 20 sessions while simultaneously calling list()
      const registerPromises = Array.from({ length: 20 }, (_, i) => {
        const wsPath = join(tempDir, `ws-list-${i}`);
        manager.registerSession(`list-race-${i}`, wsPath);
        return manager.getSessionStore(wsPath).createWithId(`list-race-${i}`, 'agent');
      });

      // Interleave list calls with registration
      const listPromises = Array.from({ length: 10 }, () => manager.list());

      // All operations must complete without error
      const [listResults] = await Promise.all([
        Promise.all(listPromises),
        Promise.all(registerPromises),
      ]);

      // Every list call should return a valid array (no errors)
      for (const result of listResults) {
        expect(Array.isArray(result)).toBe(true);
      }

      // After all registrations, a final list should reflect all sessions
      const finalList = await manager.list();
      expect(finalList).toHaveLength(20);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Cold-start reservation (R2P-161, mirrors Rust 32e79ce/098adbd):
  // lazy AgentSession assembly must reserve the registry slot
  // SYNCHRONOUSLY (before any await) so concurrent first messages on the
  // same cold session cannot each build an AgentSession and overwrite
  // each other's registration (orphaned runner + double persistence).
  // ────────────────────────────────────────────────────────────────────
  describe('cold-start reservation', () => {
    it('tryReserveAgentSession grants the first caller and rejects the second', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('race-1', wsPath);

      // First caller wins the assembly slot...
      expect(manager.tryReserveAgentSession('race-1')).toBe(true);
      // ...every later caller loses (no await between check and reserve)
      expect(manager.tryReserveAgentSession('race-1')).toBe(false);
      expect(manager.tryReserveAgentSession('race-1')).toBe(false);
    });

    it('a pending reservation is invisible to getAgentSession', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('race-2', wsPath);

      expect(manager.tryReserveAgentSession('race-2')).toBe(true);
      // While assembly is in flight there is no real AgentSession yet —
      // /stop and /respond must see "not active", not a sentinel object.
      expect(manager.getAgentSession('race-2')).toBeNull();
    });

    it('setAgentSession settles the reservation and publishes the real session', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('race-3', wsPath);

      expect(manager.tryReserveAgentSession('race-3')).toBe(true);
      const realSession = { stop: vi.fn() } as any;
      manager.setAgentSession('race-3', realSession);

      expect(manager.getAgentSession('race-3')).toBe(realSession);
      // Reservation is settled: the entry now blocks because a REAL
      // session exists (not because a stale reservation lingers).
      expect(manager.tryReserveAgentSession('race-3')).toBe(false);
    });

    it('cancelAgentSessionReservation clears the slot so a retry can win (failure path)', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('race-4', wsPath);

      expect(manager.tryReserveAgentSession('race-4')).toBe(true);
      manager.cancelAgentSessionReservation('race-4');
      // Cleared — a later request must be able to retry the assembly.
      expect(manager.tryReserveAgentSession('race-4')).toBe(true);
      expect(manager.getAgentSession('race-4')).toBeNull();
    });

    it('cancelAgentSessionReservation does not remove an already-registered AgentSession', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('race-5', wsPath);

      manager.tryReserveAgentSession('race-5');
      const realSession = { stop: vi.fn() } as any;
      manager.setAgentSession('race-5', realSession);
      // Late/duplicate cancel after a successful settle must not evict
      // the published session (settle wins over cancel).
      manager.cancelAgentSessionReservation('race-5');
      expect(manager.getAgentSession('race-5')).toBe(realSession);
    });

    it('a pending reservation is not counted as an active AgentSession', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('race-6', wsPath);

      expect(manager.tryReserveAgentSession('race-6')).toBe(true);
      expect(manager.activeCount).toBe(0);
      expect(Array.from(manager.getAllAgentSessions())).toHaveLength(0);
      // stopAll over a pending reservation must be a safe no-op
      expect(() => manager.stopAll()).not.toThrow();
    });

    it('delete clears a pending reservation', async () => {
      const manager = new SessionManager(sessionsDir);
      await manager.init();
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('race-7', wsPath);
      const store = manager.getSessionStore(wsPath);
      await store.createWithId('race-7', 'test-agent');

      expect(manager.tryReserveAgentSession('race-7')).toBe(true);
      await manager.delete('race-7');
      // Deleted while resuming → the reservation must not survive the delete
      // (the id is not stuck: activeSessions and reservation are both empty).
      expect(manager.tryReserveAgentSession('race-7')).toBe(true);
      expect(manager.getAgentSession('race-7')).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Idle-TTL lazy eviction (R2P-121, mirrors Rust SessionManager::
  // evict_idle_locked + Session::is_quiet/idle_for): the active
  // AgentSession pool is a WARM registry whose entry lifetime is "session
  // not cooled down", not "turn in flight". Sessions idle past the TTL
  // are lazily evicted (warm→cold) on the next registry insert or via the
  // public evictIdleSessions(); eviction takes memory offline but never
  // touches disk (disk is the source of truth; disk deletion is the
  // DELETE endpoint's job).
  //
  // Fake clock throughout — no real sleeping: time only moves when the
  // test says so.
  // ────────────────────────────────────────────────────────────────────
  describe('idle TTL lazy eviction (R2P-121)', () => {
    const TTL = 1_000;
    let nowMs: number;
    let manager: SessionManager;

    beforeEach(async () => {
      nowMs = 1_000_000;
      manager = new SessionManager(sessionsDir, undefined, {
        now: () => nowMs,
        idleTtlMs: TTL,
      });
      await manager.init();
    });

    const advance = (ms: number) => {
      nowMs += ms;
    };
    const mkSession = (busy = false) => ({ busy, stop: vi.fn() }) as any;

    it('idle past TTL: next registry insert sweeps it — memory gone, disk dir kept, getInfo still serves from disk', async () => {
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('idle-1', wsPath);
      const store = manager.getSessionStore(wsPath);
      await store.createWithId('idle-1', 'test-agent');
      manager.setAgentSession('idle-1', mkSession());
      expect(manager.getAgentSession('idle-1')).not.toBeNull();

      advance(TTL + 1);
      // 下一次注册表操作 = 另一会话的 insert 顺手清扫（对齐 Rust insert
      // 时顺手回收，不让回收只依赖公开入口）。
      manager.registerSession('idle-2', wsPath);
      manager.setAgentSession('idle-2', mkSession());

      expect(manager.getAgentSession('idle-1')).toBeNull();
      expect(manager.getAgentSession('idle-2')).not.toBeNull();
      // 驱逐 = 内存下线，盘保留（温→冷；盘是事实源）。
      expect(existsSync(store.getSessionDir('idle-1'))).toBe(true);
      const info = await manager.getInfo('idle-1');
      expect(info).not.toBeNull();
      expect(info!.agentName).toBe('test-agent');
    });

    it('busy session is not evictable (survives clock advancing past TTL)', async () => {
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('busy-1', wsPath);
      manager.setAgentSession('busy-1', mkSession(true));

      advance(TTL * 10);
      manager.evictIdleSessions();

      expect(manager.getAgentSession('busy-1')).not.toBeNull();
    });

    it('pending cold-start reservation pins the id: sweep evicts others but never touches the assembly latch', async () => {
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('hold-1', wsPath);
      manager.registerSession('old-1', wsPath);
      manager.setAgentSession('old-1', mkSession());
      expect(manager.tryReserveAgentSession('hold-1')).toBe(true);

      advance(TTL + 1);
      expect(manager.evictIdleSessions()).toBe(1); // old-1 goes cold
      expect(manager.getAgentSession('old-1')).toBeNull();
      // The reservation SURVIVES the sweep — it is an assembly latch
      // (R2P-161), not an idle resource; a mid-assembly sweep must not
      // free the slot underneath the assembling caller.
      expect(manager.tryReserveAgentSession('hold-1')).toBe(false);
      // And settlement still works after the sweep.
      const real = mkSession();
      manager.setAgentSession('hold-1', real);
      expect(manager.getAgentSession('hold-1')).toBe(real);
    });

    it('within TTL not evicted; exactly at TTL not evicted either (strict >, aligned with idle_for() > ttl)', async () => {
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('young-1', wsPath);
      manager.setAgentSession('young-1', mkSession());

      advance(TTL - 1);
      manager.evictIdleSessions();
      expect(manager.getAgentSession('young-1')).not.toBeNull();

      advance(1); // exactly at TTL → not yet
      manager.evictIdleSessions();
      expect(manager.getAgentSession('young-1')).not.toBeNull();

      advance(1); // past TTL → evicted
      expect(manager.evictIdleSessions()).toBe(1);
      expect(manager.getAgentSession('young-1')).toBeNull();
    });

    it('eviction is idempotent: already-evicted entries are not re-processed, and eviction is a map removal (no stop call)', async () => {
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('dup-1', wsPath);
      const session = mkSession();
      manager.setAgentSession('dup-1', session);

      advance(TTL + 1);
      expect(manager.evictIdleSessions()).toBe(1);
      expect(manager.evictIdleSessions()).toBe(0);
      expect(manager.evictIdleSessions()).toBe(0);
      expect(manager.getAgentSession('dup-1')).toBeNull();
      // Pure registry removal (aligned with Rust reg.retain dropping the
      // Arc): a non-busy session has no in-flight turn to stop.
      expect(session.stop).not.toHaveBeenCalled();
    });

    it('lastActiveAt touch semantics: registration older than TTL but recent activity → not evicted; stale again → evicted', async () => {
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('touch-1', wsPath);
      manager.setAgentSession('touch-1', mkSession());

      advance(TTL + 1); // registration timestamp is now stale...
      manager.touchAgentSession('touch-1'); // ...but a turn just started (driveTurn touch)
      manager.evictIdleSessions();
      expect(manager.getAgentSession('touch-1')).not.toBeNull();

      advance(TTL + 1); // idle again past TTL with no activity
      manager.evictIdleSessions();
      expect(manager.getAgentSession('touch-1')).toBeNull();
    });

    it('re-publishing via setAgentSession refreshes the activity timestamp', async () => {
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('refresh-1', wsPath);
      manager.setAgentSession('refresh-1', mkSession());

      advance(TTL + 1);
      manager.setAgentSession('refresh-1', mkSession()); // rebuild/换模型 republish = warm again
      manager.evictIdleSessions();
      expect(manager.getAgentSession('refresh-1')).not.toBeNull();
    });

    it('a late touch for an evicted/unknown id is a no-op (no resurrected bookkeeping)', async () => {
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('ghost-1', wsPath);
      manager.setAgentSession('ghost-1', mkSession());
      advance(TTL + 1);
      manager.evictIdleSessions();
      expect(manager.getAgentSession('ghost-1')).toBeNull();

      expect(() => manager.touchAgentSession('ghost-1')).not.toThrow();
      expect(() => manager.touchAgentSession('never-registered')).not.toThrow();
      expect(manager.activeCount).toBe(0);
      expect(manager.evictIdleSessions()).toBe(0);
    });

    // ─── 冷却补臂回归点（R2P-141a，对齐 Rust is_quiet 三条件全集）───
    // P2-a 裁剪掉的两臂在此补齐：子女在飞（Supervisor 登记簿）与邮箱
    // 非空（未消化投递）都把会话钉在「活」——下线即丢后台子任务/投递。
    it('session with in-flight sub-task children is not evicted (hasActiveChildren arm)', async () => {
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('child-1', wsPath);
      manager.setAgentSession('child-1', {
        busy: false,
        stop: vi.fn(),
        hasActiveChildren: () => true,
      } as any);

      advance(TTL * 10);
      manager.evictIdleSessions();
      expect(manager.getAgentSession('child-1')).not.toBeNull();

      // 子女清零（看门狗超时后）→ 恢复可驱逐。
      manager.setAgentSession('child-1', {
        busy: false,
        stop: vi.fn(),
        hasActiveChildren: () => false,
      } as any);
      advance(TTL + 1);
      expect(manager.evictIdleSessions()).toBe(1);
      expect(manager.getAgentSession('child-1')).toBeNull();
    });

    it('session with pending (unconsumed) deliveries is not evicted (hasPendingDeliveries arm)', async () => {
      const wsPath = join(tempDir, 'workspace');
      manager.registerSession('mail-1', wsPath);
      manager.setAgentSession('mail-1', {
        busy: false,
        stop: vi.fn(),
        hasPendingDeliveries: () => true,
      } as any);

      advance(TTL * 10);
      manager.evictIdleSessions();
      expect(manager.getAgentSession('mail-1')).not.toBeNull();

      // 邮箱排空（消费轮消化）→ 恢复可驱逐。
      manager.setAgentSession('mail-1', {
        busy: false,
        stop: vi.fn(),
        hasPendingDeliveries: () => false,
      } as any);
      advance(TTL + 1);
      expect(manager.evictIdleSessions()).toBe(1);
      expect(manager.getAgentSession('mail-1')).toBeNull();
    });
  });
});
