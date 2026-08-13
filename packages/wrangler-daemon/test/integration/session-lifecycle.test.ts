/**
 * @fileoverview User Story: Session Discovery and Management (Integration)
 *
 * As a developer
 * I want to discover, query, fork, and delete sessions
 * So that I can manage conversation history
 *
 * Acceptance Criteria:
 * 1. GET /api/sessions returns sessions sorted by updatedAt, optional workspacePath filter
 * 2. GET /api/sessions/:id returns session metadata
 * 3. POST /api/sessions/:id/fork creates a new session from existing one
 * 4. DELETE /api/sessions/:id removes the session
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SessionStore } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { SessionManager } from '../../src/core/session-manager.js';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { sessionRoutes } from '../../src/routes/sessions.js';

describe('Integration: Session Lifecycle', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let sessionsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-session-lc-'));
    sessionsDir = join(tempDir, 'sessions');
    const sessionManager = new SessionManager(sessionsDir);
    const resourceManager = new ResourceManager(
      join(tempDir, 'agents'),
      join(tempDir, 'skills'),
      join(tempDir, 'crews')
    );
    await resourceManager.init();

    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.register(sessionRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await fastify.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  function getManager(): SessionManager {
    return (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
  }

  async function createSessionOnDisk(
    workspacePath: string,
    sessionId: string,
    agentName: string
  ): Promise<void> {
    const store = new SessionStore(sessionsDir, workspacePath, defaultNodeHostEnv);
    await store.createWithId(sessionId, agentName);
    getManager().registerSession(sessionId, workspacePath);
  }

  // ─── AC 1: List and filter sessions ────────────────────────

  it('discovers sessions from disk and filters by workspace', async () => {
    const ws1 = join(tempDir, 'ws-1');
    const ws2 = join(tempDir, 'ws-2');
    await createSessionOnDisk(ws1, 's1', 'agent-a');
    await createSessionOnDisk(ws1, 's2', 'agent-b');
    await createSessionOnDisk(ws2, 's3', 'agent-c');

    // List all
    const allRes = await fetch(`${getUrl()}/api/sessions`);
    expect(allRes.ok).toBe(true);
    expect(await allRes.json()).toHaveLength(3);

    // Filter by ws1
    const ws1Res = await fetch(`${getUrl()}/api/sessions?workspacePath=${encodeURIComponent(ws1)}`);
    expect(ws1Res.ok).toBe(true);
    const ws1Body = await ws1Res.json();
    expect(ws1Body).toHaveLength(2);
    expect(ws1Body.every((s: { workspacePath: string }) => s.workspacePath === ws1)).toBe(true);
  });

  // ─── AC 2: Get session info ────────────────────────────────

  it('returns session metadata including agent name', async () => {
    await createSessionOnDisk(join(tempDir, 'ws'), 'meta-id', 'my-agent');

    const res = await fetch(`${getUrl()}/api/sessions/meta-id`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.agentName).toBe('my-agent');
    expect(body).toHaveProperty('workspacePath');
  });

  it('returns error for unknown session', async () => {
    const res = await fetch(`${getUrl()}/api/sessions/nonexistent`);
    expect(res.ok).toBe(true);
    expect((await res.json()).error).toBe('Session not found');
  });

  // ─── AC 3: Fork session ────────────────────────────────────

  it('forks a session preserving conversation history', async () => {
    const wsPath = join(tempDir, 'ws');
    await createSessionOnDisk(wsPath, 'fork-src', 'test-agent');

    const store = getManager().getSessionStore(wsPath);

    // Write state (simulating what wrangler does after a run)
    const { createAgentState, addUserMessage, addAssistantMessage } =
      await import('@agentskillmania/colts');
    let state = createAgentState({
      name: 'test-agent',
      tools: [],
      instructions: 'be helpful',
    });
    state = { ...state, id: 'fork-src' };
    state = addUserMessage(state, 'Hello from original');
    state = addAssistantMessage(state, 'Hi there');
    await store.saveState('fork-src', state);

    // Fork
    const res = await fetch(`${getUrl()}/api/sessions/fork-src/fork`, { method: 'POST' });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.id).not.toBe('fork-src');

    // Verify forked session copied the agent state (state.json),
    // including the conversation history.
    const forkState = await store.loadState(body.id);
    expect(forkState).not.toBeNull();
    expect(forkState!.context.messages).toHaveLength(2);
    expect(forkState!.context.messages[0].content).toBe('Hello from original');
    expect(forkState!.context.messages[1].content).toBe('Hi there');
  });

  it('returns error when forking session without state', async () => {
    const wsPath = join(tempDir, 'ws');
    const store = getManager().getSessionStore(wsPath);
    await store.createWithId('no-state', 'test');
    getManager().registerSession('no-state', wsPath);

    const res = await fetch(`${getUrl()}/api/sessions/no-state/fork`, { method: 'POST' });
    expect(res.ok).toBe(true);
    expect((await res.json()).error).toBe('Session state not found');
  });

  // ─── AC 4: Delete session ──────────────────────────────────

  it('deletes session and removes from listings', async () => {
    await createSessionOnDisk(join(tempDir, 'ws'), 'del-me', 'agent');

    const delRes = await fetch(`${getUrl()}/api/sessions/del-me`, { method: 'DELETE' });
    expect(delRes.ok).toBe(true);
    expect((await delRes.json()).ok).toBe(true);

    const listRes = await fetch(`${getUrl()}/api/sessions`);
    expect(await listRes.json()).toHaveLength(0);
  });

  // ─── Full lifecycle ────────────────────────────────────────

  it('full lifecycle: create → list → get → fork → delete', async () => {
    const url = getUrl();
    const wsPath = join(tempDir, 'ws-lifecycle');

    // 1. Create session on disk
    await createSessionOnDisk(wsPath, 'lc-1', 'lc-agent');

    // 2. List contains it
    const listRes = await fetch(`${url}/api/sessions`);
    const listBody = await listRes.json();
    expect(listBody).toHaveLength(1);

    // 3. Get info
    const infoRes = await fetch(`${url}/api/sessions/lc-1`);
    expect((await infoRes.json()).agentName).toBe('lc-agent');

    // 4. Write state and fork
    const store = getManager().getSessionStore(wsPath);
    const { createAgentState } = await import('@agentskillmania/colts');
    const state = createAgentState({ name: 'lc-agent', tools: [], instructions: 'test' });
    await store.saveState('lc-1', state);

    const forkRes = await fetch(`${url}/api/sessions/lc-1/fork`, { method: 'POST' });
    const forkBody = await forkRes.json();
    expect(forkBody.id).toBeTruthy();

    // 5. Now two sessions
    const list2Res = await fetch(`${url}/api/sessions`);
    expect(await list2Res.json()).toHaveLength(2);

    // 6. Delete original
    await fetch(`${url}/api/sessions/lc-1`, { method: 'DELETE' });
    const list3Res = await fetch(`${url}/api/sessions`);
    expect(await list3Res.json()).toHaveLength(1);
  });
});
