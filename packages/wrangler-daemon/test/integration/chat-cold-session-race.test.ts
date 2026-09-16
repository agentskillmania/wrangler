import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SessionStore } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { SessionManager } from '../../src/core/session-manager.js';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { ConfigManager } from '../../src/core/config-manager.js';
import { chatRoutes } from '../../src/routes/chat.js';

/**
 * R2P-161 — cold-session create race (mirrors Rust 32e79ce/098adbd 地基C).
 *
 * POST /api/chat/:sessionId lazily resumes an AgentSession on the first
 * message after a daemon restart ("cold" session: on disk, not in the
 * active registry). The old path was check-then-build-then-register with
 * awaits in between, so two concurrent first messages (double-click send,
 * frontend retry) each built an AgentSession and the later registration
 * overwrote the earlier one — orphaning a live runner/LLM client and
 * risking double persistence to the same session dir.
 *
 * Contract after the fix (synchronous placeholder, aligned with Rust's
 * d92d8aa latch-prelock): the FIRST request wins the assembly slot; the
 * SECOND concurrent request gets 409 while assembly is in flight; exactly
 * one AgentSession ends up registered; a failed assembly clears the slot
 * so the next request can retry.
 *
 * AgentSession.resume is mocked with a deferred promise so the race
 * window is held open deterministically (no real LLM involved); the
 * Fastify app, SessionManager and chat routes under test are real.
 */

// ─── Mock setup ───

const { mockAgentSessionResume } = vi.hoisted(() => ({
  mockAgentSessionResume: vi.fn(),
}));

vi.mock('../../src/core/agent-session.js', () => ({
  AgentSession: {
    resume: mockAgentSessionResume,
  },
}));

/** A stand-in AgentSession whose handleMessage streams one done event. */
function makeFakeSession(sessionId: string, marker: string) {
  return {
    sessionId,
    busy: false,
    stop: vi.fn(),
    respondHumanInput: vi.fn(),
    emitCockpitEvent: vi.fn(),
    handleMessage: async function* () {
      yield { event: 'done', data: { marker } };
    },
  };
}

interface ParsedSSE {
  event: string;
  data: unknown;
}

function parseSSE(raw: string): ParsedSSE[] {
  const results: ParsedSSE[] = [];
  for (const chunk of raw.split('\n\n').filter((c) => c.trim())) {
    const lines = chunk.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (event) results.push({ event, data: data ? JSON.parse(data) : {} });
  }
  return results;
}

describe('R2P-161: cold-session create race (POST /api/chat/:sessionId)', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  const SESSION_ID = 'cold-race-session';

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-chat-cold-race-'));

    // Config with a fake provider (never called — AgentSession is mocked).
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      baseUrl: 'https://api.example.com'\n      models:\n        - modelId: test-model\n`
    );
    const configManager = new ConfigManager(configPath);
    await configManager.init();

    const resourceManager = new ResourceManager(
      join(tempDir, 'agents'),
      join(tempDir, 'skills'),
      join(tempDir, 'crews')
    );
    await resourceManager.init();
    await resourceManager.createAgent({
      name: 'test-agent',
      instructions: 'test instructions',
    });

    const sessionsDir = join(tempDir, 'sessions');
    const sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

    // Persist a cold session on disk (present in the tree, NOT in the
    // active registry — exactly the state after a daemon restart).
    const wsPath = join(tempDir, 'workspace');
    const store = new SessionStore(sessionsDir, wsPath, defaultNodeHostEnv);
    await store.createWithId(SESSION_ID, 'test-agent');
    await store.updateMeta(SESSION_ID, { runnerConfig: { model: 'test-model' } });
    sessionManager.registerSession(SESSION_ID, wsPath);

    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.register(chatRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });

    mockAgentSessionResume.mockReset();
  });

  afterEach(async () => {
    await Promise.race([fastify.close(), new Promise((r) => setTimeout(r, 1500))]);
    await rm(tempDir, { recursive: true, force: true });
  });

  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  function sessionManager(): SessionManager {
    return (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
  }

  function postMessage(): Promise<Response> {
    return fetch(`${getUrl()}/api/chat/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
  }

  it(
    'second concurrent POST while resume is in flight gets 409; exactly one AgentSession is built',
    { timeout: 15_000 },
    async () => {
      const firstSession = makeFakeSession(SESSION_ID, 'winner');

      // Deferred holding request A inside AgentSession.resume.
      let releaseA!: (session: unknown) => void;
      let resumeEntered!: () => void;
      const entered = new Promise<void>((resolve) => {
        resumeEntered = resolve;
      });
      mockAgentSessionResume.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseA = resolve;
            resumeEntered();
          })
      );

      // Request A: races through to the (parked) resume call.
      const promiseA = postMessage();
      await entered; // A is now awaiting assembly — the race window is open.

      // Request B: same cold session, double-click/retry.
      const resB = await postMessage();

      // B must be excluded while A owns the assembly slot.
      expect(resB.status).toBe(409);
      expect(await resB.json()).toEqual({ error: 'Session is busy' });

      // Let A finish: assembly resolves, registers, streams done.
      releaseA(firstSession);
      const resA = await promiseA;
      expect(resA.status).toBe(200);
      expect(resA.headers.get('content-type')).toBe('text/event-stream');
      const events = parseSSE(await resA.text());
      expect(events.map((e) => e.event)).toContain('done');

      // Exactly one AgentSession was ever built (no orphaned duplicate).
      expect(mockAgentSessionResume).toHaveBeenCalledTimes(1);
      // The registry holds exactly the winner — no overwrite, no orphan.
      expect(sessionManager().getAgentSession(SESSION_ID)).toBe(firstSession);
      expect(sessionManager().activeCount).toBe(1);
    }
  );

  it('failed resume clears the slot so the next request can retry', async () => {
    // First attempt: assembly fails after the slot was taken.
    mockAgentSessionResume.mockRejectedValueOnce(new Error('runner setup failed'));
    const resFail = await postMessage();
    expect(resFail.status).toBe(500);

    // The slot must not be stuck: a retry builds again and succeeds.
    const retrySession = makeFakeSession(SESSION_ID, 'retry');
    mockAgentSessionResume.mockResolvedValueOnce(retrySession);
    const resRetry = await postMessage();
    expect(resRetry.status).toBe(200);
    const events = parseSSE(await resRetry.text());
    expect(events.map((e) => e.event)).toContain('done');

    expect(mockAgentSessionResume).toHaveBeenCalledTimes(2);
    expect(sessionManager().getAgentSession(SESSION_ID)).toBe(retrySession);
  });
});
