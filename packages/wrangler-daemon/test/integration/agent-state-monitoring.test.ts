/**
 * US-C10: Agent State Monitoring — integration tests.
 *
 * As a developer, I want to monitor an agent's runtime state via SSE
 * so that I can see status, model, tokens in real-time.
 *
 * Route: src/routes/agent-state.ts (agentStateRoutes)
 * Decorations: sessionManager (SessionManager)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SessionStore } from '@agentskillmania/wrangler';
import { SessionManager } from '../../src/core/session-manager.js';
import { agentStateRoutes } from '../../src/routes/agent-state.js';

describe('US-C10: Agent State Monitoring', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let sessionsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-agent-state-monitor-'));
    sessionsDir = join(tempDir, 'sessions');

    const sessionManager = new SessionManager(sessionsDir);

    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
    fastify.register(agentStateRoutes);
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
    const store = new SessionStore(sessionsDir, workspacePath);
    await store.createWithId(sessionId, agentName);
    // createWithId doesn't accept model — persist it via updateMeta so the
    // degraded SSE path can surface it in session.overview.model.
    if (model) {
      await store.updateMeta(sessionId, {
        runnerConfig: { model },
      });
    }
    manager.registerSession(sessionId, workspacePath);
  }

  /** Parse the first data payload from an SSE response */
  async function readFirstPayload(res: Response): Promise<Record<string, unknown>> {
    const text = await readFirstChunk(res);
    const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) throw new Error(`No data line in SSE: ${text}`);
    return JSON.parse(dataLine.slice(6));
  }

  /** Read first SSE chunk from a response stream */
  async function readFirstChunk(res: Response): Promise<string> {
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    return new TextDecoder().decode(value);
  }

  /**
   * AC1: GET /api/agent/:sessionId/state returns 404 for unknown session.
   */
  it('returns 404 for unknown session', async () => {
    const res = await fetch(`${getUrl()}/api/agent/nonexistent-session/state`);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Session not found');
  });

  /**
   * AC2: Returns SSE stream for valid session with agent-diagnostics events.
   */
  it('returns SSE stream for valid session with agent-diagnostics events', async () => {
    await createTestSession(join(tempDir, 'ws'), 'stream-id', 'stream-agent');

    const res = await fetch(`${getUrl()}/api/agent/stream-id/state`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await readFirstChunk(res);
    expect(text).toContain('event: agent-diagnostics');
  });

  /**
   * AC3: Initial state snapshot includes runner/agent/llm/session sections.
   *      session.overview carries agentName, model, tokens, stepCount.
   */
  it('initial state snapshot includes all required fields', async () => {
    await createTestSession(join(tempDir, 'ws'), 'fields-id', 'field-check-agent', 'gpt-4o');

    const res = await fetch(`${getUrl()}/api/agent/fields-id/state`);
    const payload = await readFirstPayload(res);

    // Three-segment structure (runner / agent / llm) + session metadata
    expect(payload).toHaveProperty('runner');
    expect(payload).toHaveProperty('agent');
    expect(payload).toHaveProperty('llm');

    const overview = (payload.session as Record<string, unknown>)?.overview as Record<string, unknown>;
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
   * AC4: Status comes from runtime tracking (updateStatus), surfaced in session.overview.status.
   */
  it('status reflects runtime tracking via updateStatus', async () => {
    const manager = (fastify as any).sessionManager as SessionManager;
    await createTestSession(join(tempDir, 'ws'), 'status-id', 'status-agent');

    manager.updateStatus('status-id', 'running');

    const res = await fetch(`${getUrl()}/api/agent/status-id/state`);
    const payload = await readFirstPayload(res);
    const overview = (payload.session as Record<string, unknown>)?.overview as Record<string, unknown>;

    expect(overview.status).toBe('running');
  });

  /**
   * AC4: Default status is "idle" when updateStatus has not been called.
   */
  it('status defaults to idle when updateStatus has not been called', async () => {
    await createTestSession(join(tempDir, 'ws'), 'default-status-id', 'default-agent');

    const res = await fetch(`${getUrl()}/api/agent/default-status-id/state`);
    const payload = await readFirstPayload(res);
    const overview = (payload.session as Record<string, unknown>)?.overview as Record<string, unknown>;

    expect(overview.status).toBe('idle');
  });

  /**
   * AC5: Model comes from session metadata (session.overview.model).
   */
  it('model comes from session metadata', async () => {
    await createTestSession(
      join(tempDir, 'ws'),
      'model-id',
      'model-agent',
      'claude-sonnet-4-20250514'
    );

    const res = await fetch(`${getUrl()}/api/agent/model-id/state`);
    const payload = await readFirstPayload(res);
    const overview = (payload.session as Record<string, unknown>)?.overview as Record<string, unknown>;

    expect(overview.model).toBe('claude-sonnet-4-20250514');
  });

  /**
   * AC3: Token fields are undefined for a fresh session with no LLM calls yet.
   */
  it('token counts are undefined in the initial snapshot', async () => {
    await createTestSession(join(tempDir, 'ws'), 'token-id', 'token-agent');

    const res = await fetch(`${getUrl()}/api/agent/token-id/state`);
    const payload = await readFirstPayload(res);
    const overview = (payload.session as Record<string, unknown>)?.overview as Record<string, unknown>;

    // Fresh session has no persisted context → tokens are undefined (not 0).
    expect(overview.tokensIn).toBeUndefined();
    expect(overview.tokensOut).toBeUndefined();
    expect(overview.tokensTotal).toBeUndefined();
  });

  /**
   * AC3: Skills and tools arrays are empty in the initial snapshot (runner section).
   */
  it('skills and tools arrays are empty in the initial snapshot', async () => {
    await createTestSession(join(tempDir, 'ws'), 'empty-arr-id', 'empty-agent');

    const res = await fetch(`${getUrl()}/api/agent/empty-arr-id/state`);
    const payload = await readFirstPayload(res);
    const runner = payload.runner as Record<string, unknown>;

    expect(runner.skills).toEqual([]);
    expect(runner.tools).toEqual([]);
  });

  /**
   * AC2: Multiple concurrent SSE connections for different sessions.
   */
  it('supports SSE streams for multiple sessions simultaneously', async () => {
    await createTestSession(join(tempDir, 'ws1'), 'multi-a', 'agent-a');
    await createTestSession(join(tempDir, 'ws2'), 'multi-b', 'agent-b');

    const [resA, resB] = await Promise.all([
      fetch(`${getUrl()}/api/agent/multi-a/state`),
      fetch(`${getUrl()}/api/agent/multi-b/state`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const payloadA = await readFirstPayload(resA);
    const payloadB = await readFirstPayload(resB);
    const overviewA = (payloadA.session as Record<string, unknown>)?.overview as Record<string, unknown>;
    const overviewB = (payloadB.session as Record<string, unknown>)?.overview as Record<string, unknown>;

    expect(overviewA.agentName).toBe('agent-a');
    expect(overviewB.agentName).toBe('agent-b');
  });

  /**
   * AC1: Returns 404 after a session has been deleted.
   */
  it('returns 404 after session is deleted', async () => {
    await createTestSession(join(tempDir, 'ws'), 'delete-id', 'delete-agent');

    // Verify session works first
    const before = await fetch(`${getUrl()}/api/agent/delete-id/state`);
    expect(before.status).toBe(200);
    const reader = before.body!.getReader();
    await reader.read();
    await reader.cancel();

    // Delete the session
    const manager = (fastify as any).sessionManager as SessionManager;
    await manager.delete('delete-id');

    // Now expect 404
    const after = await fetch(`${getUrl()}/api/agent/delete-id/state`);
    expect(after.status).toBe(404);
  });
});
