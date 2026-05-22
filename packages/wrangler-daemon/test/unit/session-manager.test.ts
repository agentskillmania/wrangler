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
    await store.createWithId('del-id', 'deepseek-chat', 'test-agent');

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
    await store.createWithId('del-id', 'deepseek-chat', 'test');

    const mockSession = { stop: vi.fn() } as any;
    manager.setAgentSession('del-id', mockSession);
    await manager.delete('del-id');

    expect(manager.getAgentSession('del-id')).toBeNull();
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
    const wsPath = join(tempDir, 'workspace');

    const store = new SessionStore(sessionsDir, wsPath);
    await store.createWithId('discover-1', 'deepseek-chat', 'existing-agent');

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
    const ws1 = join(tempDir, 'ws-filter-1');
    const ws2 = join(tempDir, 'ws-filter-2');

    const store1 = new SessionStore(sessionsDir, ws1);
    const store2 = new SessionStore(sessionsDir, ws2);
    await store1.createWithId('ws1-s1', 'deepseek-chat', 'a1');
    await store1.createWithId('ws1-s2', 'deepseek-chat', 'a2');
    await store2.createWithId('ws2-s1', 'deepseek-chat', 'b1');

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
});
