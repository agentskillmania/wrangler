/**
 * US-C10: 会话诊断快照 — integration tests（原 agent-state SSE 流退役，
 * 迁移到 GET /api/chat/:sessionId 一次性 JSON——对齐 Rust 65732f3 的
 * chat_diagnostics）。
 *
 * As a developer, I want to inspect a session's state snapshot
 * so that I can see status, model, tokens in real-time.
 *
 * Route: src/routes/chat.ts（GET /api/chat/:sessionId）
 * Decorations: sessionManager (SessionManager)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SessionStore } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { SessionManager } from '../../src/core/session-manager.js';
import { chatRoutes } from '../../src/routes/chat.js';

describe('US-C10: Agent State Monitoring（GET /api/chat/:id 诊断快照）', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let sessionsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-agent-state-monitor-'));
    sessionsDir = join(tempDir, 'sessions');

    const sessionManager = new SessionManager(sessionsDir);

    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
    fastify.register(chatRoutes);
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

  /** Create a session on disk via SessionStore and register it with the manager */
  async function createTestSession(
    workspacePath: string,
    sessionId: string,
    agentName: string,
    model?: string
  ): Promise<void> {
    const manager = (fastify as any).sessionManager as SessionManager;
    const store = new SessionStore(sessionsDir, workspacePath, defaultNodeHostEnv);
    await store.createWithId(sessionId, agentName);
    // createWithId doesn't accept model — persist it via updateMeta so the
    // degraded snapshot path can surface it in session.overview.model.
    if (model) {
      await store.updateMeta(sessionId, {
        runnerConfig: { model },
      });
    }
    manager.registerSession(sessionId, workspacePath);
  }

  async function getDiag(sessionId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${getUrl()}/api/chat/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    return (await res.json()) as Record<string, unknown>;
  }

  /**
   * AC1: 404 for a session that is neither warm nor on disk.
   */
  it('returns 404 for unknown session', async () => {
    const res = await fetch(`${getUrl()}/api/chat/nonexistent-session`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Session not found');
  });

  /**
   * AC3: Snapshot includes runner/agent/llm/session sections.
   */
  it('snapshot includes all required fields', async () => {
    await createTestSession(join(tempDir, 'ws'), 'fields-id', 'field-check-agent', 'gpt-4o');

    const payload = await getDiag('fields-id');

    expect(payload).toHaveProperty('runner');
    expect(payload).toHaveProperty('agent');
    expect(payload).toHaveProperty('llm');
    expect(payload).toHaveProperty('quiet');
    expect(payload).toHaveProperty('quietBlockers');

    const overview = (payload.session as Record<string, unknown>)?.overview as Record<
      string,
      unknown
    >;
    expect(overview).toBeDefined();
    expect(overview).toHaveProperty('agentName', 'field-check-agent');
    expect(overview).toHaveProperty('model', 'gpt-4o');
    expect(overview).toHaveProperty('stepCount');
    expect(overview).toHaveProperty('status');

    const runner = payload.runner as Record<string, unknown>;
    expect(runner).toHaveProperty('skills');
    expect(runner).toHaveProperty('tools');
  });

  /**
   * AC4: Status comes from runtime tracking (updateStatus).
   */
  it('status reflects runtime tracking via updateStatus', async () => {
    const manager = (fastify as any).sessionManager as SessionManager;
    await createTestSession(join(tempDir, 'ws'), 'status-id', 'status-agent');

    manager.updateStatus('status-id', 'running');

    const payload = await getDiag('status-id');
    const overview = (payload.session as Record<string, unknown>)?.overview as Record<
      string,
      unknown
    >;
    expect(overview.status).toBe('running');
  });

  /**
   * AC4: Default status is "idle".
   */
  it('status defaults to idle when updateStatus has not been called', async () => {
    await createTestSession(join(tempDir, 'ws'), 'default-status-id', 'default-agent');

    const payload = await getDiag('default-status-id');
    const overview = (payload.session as Record<string, unknown>)?.overview as Record<
      string,
      unknown
    >;
    expect(overview.status).toBe('idle');
  });

  /**
   * AC5: Model comes from session metadata.
   */
  it('model comes from session metadata', async () => {
    await createTestSession(
      join(tempDir, 'ws'),
      'model-id',
      'model-agent',
      'claude-sonnet-4-20250514'
    );

    const payload = await getDiag('model-id');
    const overview = (payload.session as Record<string, unknown>)?.overview as Record<
      string,
      unknown
    >;
    expect(overview.model).toBe('claude-sonnet-4-20250514');
  });

  /**
   * AC3: Token fields are undefined for a fresh session.
   */
  it('token counts are undefined in the initial snapshot', async () => {
    await createTestSession(join(tempDir, 'ws'), 'token-id', 'token-agent');

    const payload = await getDiag('token-id');
    const overview = (payload.session as Record<string, unknown>)?.overview as Record<
      string,
      unknown
    >;
    expect(overview.tokensIn).toBeUndefined();
    expect(overview.tokensOut).toBeUndefined();
    expect(overview.tokensTotal).toBeUndefined();
  });

  /**
   * AC3: Cold snapshot carries empty skills/tools + no LLM trace.
   */
  it('cold snapshot has empty skills/tools and null llm trace', async () => {
    await createTestSession(join(tempDir, 'ws'), 'empty-arr-id', 'empty-agent');

    const payload = await getDiag('empty-arr-id');
    const runner = payload.runner as Record<string, unknown>;
    expect(runner.skills).toEqual([]);
    expect(runner.tools).toEqual([]);
    expect(payload.llm).toBeNull();
    expect(payload.systemPrompt).toBeNull();
    expect(payload.quiet).toBe(true);
  });

  /**
   * AC2: Multiple concurrent snapshots for different sessions.
   */
  it('supports snapshots for multiple sessions simultaneously', async () => {
    await createTestSession(join(tempDir, 'ws1'), 'multi-a', 'agent-a');
    await createTestSession(join(tempDir, 'ws2'), 'multi-b', 'agent-b');

    const [payloadA, payloadB] = await Promise.all([getDiag('multi-a'), getDiag('multi-b')]);

    const overviewA = ((payloadA.session as Record<string, unknown>)?.overview ?? {}) as Record<
      string,
      unknown
    >;
    const overviewB = ((payloadB.session as Record<string, unknown>)?.overview ?? {}) as Record<
      string,
      unknown
    >;
    expect(overviewA.agentName).toBe('agent-a');
    expect(overviewB.agentName).toBe('agent-b');
  });
});
