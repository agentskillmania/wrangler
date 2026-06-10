/**
 * @fileoverview Unit tests for session query and deletion routes
 *
 * Tests the /api/sessions endpoints:
 * - GET /api/sessions — list sessions
 * - GET /api/sessions/:id — get session info
 * - POST /api/sessions/:id/fork — fork a session
 * - DELETE /api/sessions/:id — delete session
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SessionManager } from '../../../src/core/session-manager.js';
import { sessionRoutes } from '../../../src/routes/sessions.js';

describe('Unit: Session Routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-session-routes-'));

    const sessionsDir = join(tempDir, 'sessions');
    sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
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

  /**
   * Helper: create a real session with state and entries for fork testing.
   * Uses SessionStore directly to create a session on disk.
   */
  async function createSessionWithState(sessionId: string): Promise<string> {
    const wsPath = join(tempDir, 'workspace');
    sessionManager.registerSession(sessionId, wsPath);

    const store = sessionManager.getSessionStore(wsPath);
    await store.createWithId(sessionId, 'test-agent');

    // Save a minimal AgentState
    const state = {
      id: sessionId,
      config: {
        name: 'test-agent',
        instructions: 'You are a test agent.',
        tools: [],
      },
      context: {
        messages: [],
        stepCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };
    await store.saveState(sessionId, state);

    // Append a conversation entry
    const entry = {
      id: 'msg-001',
      role: 'user' as const,
      content: 'Hello, world!',
      timestamp: Date.now(),
    };
    await store.appendEntry(sessionId, entry);

    return wsPath;
  }

  // Test 1: GET /api/sessions returns empty list
  it('GET /api/sessions returns empty list', async () => {
    const res = await fetch(`${getUrl()}/api/sessions`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  // Test 2: GET /api/sessions returns created sessions
  it('GET /api/sessions returns created sessions', async () => {
    const wsPath = join(tempDir, 'workspace');
    sessionManager.registerSession('s1', wsPath);
    const store = sessionManager.getSessionStore(wsPath);
    await store.createWithId('s1', 'test-agent');

    const res = await fetch(`${getUrl()}/api/sessions`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('s1');
    expect(body[0].agentName).toBe('test-agent');
  });

  // Test 3: GET /api/sessions/:id returns session info
  it('GET /api/sessions/:id returns session info', async () => {
    const wsPath = join(tempDir, 'workspace');
    sessionManager.registerSession('detail-id', wsPath);
    const store = sessionManager.getSessionStore(wsPath);
    await store.createWithId('detail-id', 'my-agent');
    await store.updateMeta('detail-id', { runnerConfig: { model: 'gpt-4' } });

    const res = await fetch(`${getUrl()}/api/sessions/detail-id`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.id).toBe('detail-id');
    expect(body.runnerConfig?.model).toBe('gpt-4');
    expect(body.agentName).toBe('my-agent');
    expect(body.workspacePath).toBe(wsPath);
  });

  // Test 4: GET /api/sessions/:id returns error for non-existent session
  it('GET /api/sessions/:id returns error for non-existent session', async () => {
    const res = await fetch(`${getUrl()}/api/sessions/non-existent`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'Session not found' });
  });

  // Test 5: POST /api/sessions/:id/fork forks session with new ID
  it('POST /api/sessions/:id/fork forks session with new ID', async () => {
    const originalId = 'fork-source';
    await createSessionWithState(originalId);

    const res = await fetch(`${getUrl()}/api/sessions/${originalId}/fork`, {
      method: 'POST',
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.id).not.toBe(originalId);

    // Verify the forked session is discoverable
    const forkInfo = await sessionManager.getInfo(body.id);
    expect(forkInfo).not.toBeNull();
    expect(forkInfo!.agentName).toBe('test-agent');
  });

  // Test 6: POST /api/sessions/:id/fork returns error for non-existent session
  it('POST /api/sessions/:id/fork returns error for non-existent session', async () => {
    const res = await fetch(`${getUrl()}/api/sessions/non-existent/fork`, {
      method: 'POST',
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'Session not found' });
  });

  // Test 7: POST /api/sessions/:id/fork returns error when state missing
  it('POST /api/sessions/:id/fork returns error when state missing', async () => {
    // Create a session but do NOT save state
    const wsPath = join(tempDir, 'workspace2');
    sessionManager.registerSession('no-state-id', wsPath);
    const store = sessionManager.getSessionStore(wsPath);
    await store.createWithId('no-state-id', 'test-agent');

    const res = await fetch(`${getUrl()}/api/sessions/no-state-id/fork`, {
      method: 'POST',
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'Session state not found' });
  });

  // Test 8: DELETE /api/sessions/:id deletes session
  it('DELETE /api/sessions/:id deletes session', async () => {
    const wsPath = join(tempDir, 'workspace');
    sessionManager.registerSession('del-id', wsPath);
    const store = sessionManager.getSessionStore(wsPath);
    await store.createWithId('del-id', 'test-agent');

    const res = await fetch(`${getUrl()}/api/sessions/del-id`, { method: 'DELETE' });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    // Verify session is gone
    const info = await sessionManager.getInfo('del-id');
    expect(info).toBeNull();
  });

  // Test 9: GET /api/sessions filters by workspacePath
  it('GET /api/sessions filters by workspacePath', async () => {
    const ws1 = join(tempDir, 'ws-filter-1');
    const ws2 = join(tempDir, 'ws-filter-2');

    sessionManager.registerSession('ws1-s1', ws1);
    sessionManager.registerSession('ws1-s2', ws1);
    sessionManager.registerSession('ws2-s1', ws2);

    const store1 = sessionManager.getSessionStore(ws1);
    const store2 = sessionManager.getSessionStore(ws2);
    await store1.createWithId('ws1-s1', 'agent');
    await store1.createWithId('ws1-s2', 'agent');
    await store2.createWithId('ws2-s1', 'agent');

    // Filter by ws1
    const res1 = await fetch(`${getUrl()}/api/sessions?workspacePath=${encodeURIComponent(ws1)}`);
    expect(res1.ok).toBe(true);
    const body1 = await res1.json();
    expect(body1).toHaveLength(2);

    // Filter by ws2
    const res2 = await fetch(`${getUrl()}/api/sessions?workspacePath=${encodeURIComponent(ws2)}`);
    expect(res2.ok).toBe(true);
    const body2 = await res2.json();
    expect(body2).toHaveLength(1);
  });
});
