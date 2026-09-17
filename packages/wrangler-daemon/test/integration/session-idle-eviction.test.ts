import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SessionStore } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { SessionManager } from '../../src/core/session-manager.js';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { ConfigManager } from '../../src/core/config-manager.js';
import { chatRoutes } from '../../src/routes/chat.js';
import { sessionRoutes } from '../../src/routes/sessions.js';

/**
 * R2P-121 — idle-TTL lazy eviction, end-to-end warm→cold→warm loop.
 *
 * The active AgentSession pool is a WARM registry: entry lifetime is
 * "session not cooled down", not "turn in flight". A session idle past
 * the TTL is lazily evicted — memory goes offline, DISK STAYS (the disk
 * tree is the source of truth; disk deletion is the DELETE endpoint's
 * job). The next message on an evicted session must transparently
 * re-materialize it from disk (assembleResumeSession).
 *
 * Real Fastify app + real SessionManager (fake clock + tiny TTL injected
 * via constructor options) + real chat/sessions routes. Only
 * AgentSession.resume is mocked (no real LLM): each call stands for one
 * disk materialization, so the test can count warm rebuilds and assert
 * they target the SAME session directory.
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

function parseSSE(raw: string): string[] {
  const events: string[] = [];
  for (const chunk of raw.split('\n\n').filter((c) => c.trim())) {
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event: ')) events.push(line.slice(7));
    }
  }
  return events;
}

describe('R2P-121: idle-TTL lazy eviction — warm→cold→warm loop', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let sessionsDir: string;
  let store: SessionStore;
  const SESSION_ID = 'idle-evict-session';
  const TTL_MS = 60_000;
  /** Fake clock — time only moves when the test advances it. */
  let nowMs = 1_000_000;
  const advance = (ms: number) => {
    nowMs += ms;
  };

  beforeEach(async () => {
    nowMs = 1_000_000;
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-idle-evict-'));

    // Config with a fake provider (never called — AgentSession.resume is
    // mocked; the config only needs to resolve a default model).
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

    sessionsDir = join(tempDir, 'sessions');
    const sessionManager = new SessionManager(sessionsDir, undefined, {
      now: () => nowMs,
      idleTtlMs: TTL_MS,
    });
    await sessionManager.init();

    // Cold session on disk (registered for discovery, NOT in the warm
    // registry yet).
    const wsPath = join(tempDir, 'workspace');
    store = new SessionStore(sessionsDir, wsPath, defaultNodeHostEnv);
    await store.createWithId(SESSION_ID, 'test-agent');
    await store.updateMeta(SESSION_ID, { runnerConfig: { model: 'test-model' } });
    sessionManager.registerSession(SESSION_ID, wsPath);

    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.register(chatRoutes);
    fastify.register(sessionRoutes);
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
    'session idle past TTL is evicted by the health-snapshot sweep; the next message resumes from disk (same sessionDir)',
    { timeout: 15_000 },
    async () => {
      const sessionDir = store.getSessionDir(SESSION_ID);

      // ── 温：first message materializes the session from disk ──
      const warm1 = makeFakeSession(SESSION_ID, 'warm-1');
      mockAgentSessionResume.mockResolvedValueOnce(warm1);
      const res1 = await postMessage();
      expect(res1.status).toBe(200);
      expect(parseSSE(await res1.text())).toContain('done');

      expect(mockAgentSessionResume).toHaveBeenCalledTimes(1);
      expect(sessionManager().getAgentSession(SESSION_ID)).toBe(warm1);
      expect(sessionManager().activeCount).toBe(1);
      // The rebuild targeted the persisted directory.
      expect(mockAgentSessionResume.mock.calls[0][0]).toBe(sessionDir);

      // ── 冷：idle past TTL, then a snapshot read sweeps it ──
      advance(TTL_MS + 1);
      const listRes = await fetch(`${getUrl()}/api/sessions`);
      expect(listRes.ok).toBe(true);

      expect(sessionManager().getAgentSession(SESSION_ID)).toBeNull();
      expect(sessionManager().activeCount).toBe(0);
      // Eviction = memory offline, disk retained: the directory and the
      // meta (served from disk) both survive.
      expect(existsSync(sessionDir)).toBe(true);
      const metaRes = await fetch(`${getUrl()}/api/sessions/${SESSION_ID}`);
      const meta = (await metaRes.json()) as { agentName?: string };
      expect(meta.agentName).toBe('test-agent');

      // ── 温 again: the next message transparently re-materializes ──
      const warm2 = makeFakeSession(SESSION_ID, 'warm-2');
      mockAgentSessionResume.mockResolvedValueOnce(warm2);
      const res2 = await postMessage();
      expect(res2.status).toBe(200);
      expect(parseSSE(await res2.text())).toContain('done');

      expect(mockAgentSessionResume).toHaveBeenCalledTimes(2);
      // Re-materialized from the SAME on-disk directory.
      expect(mockAgentSessionResume.mock.calls[1][0]).toBe(sessionDir);
      expect(sessionManager().getAgentSession(SESSION_ID)).toBe(warm2);
      expect(sessionManager().activeCount).toBe(1);
    }
  );

  it('a busy session survives the sweep even when the clock is past the TTL', async () => {
    const busy = { ...makeFakeSession(SESSION_ID, 'busy'), busy: true };
    mockAgentSessionResume.mockResolvedValueOnce(busy);
    // Assembly registers the session, then the route rejects the message
    // with 409 (a run is in flight) — exactly the warm-and-busy state.
    const res1 = await postMessage();
    expect(res1.status).toBe(409);
    const body1 = (await res1.json()) as { reason?: string };
    expect(body1.reason).toBe('busy');
    expect(sessionManager().getAgentSession(SESSION_ID)).toBe(busy);

    advance(TTL_MS * 10);
    await fetch(`${getUrl()}/api/sessions`);

    // In-flight turn pins the warm session — not evictable.
    expect(sessionManager().getAgentSession(SESSION_ID)).toBe(busy);
    expect(sessionManager().activeCount).toBe(1);
  });

  it('recent turn activity refreshes the lease: idle-at-snapshot but touched since → not evicted', async () => {
    const warm = makeFakeSession(SESSION_ID, 'warm');
    mockAgentSessionResume.mockResolvedValueOnce(warm);
    await (await postMessage()).text();

    // Registration is now older than the TTL, but the session had a
    // turn-driven touch just now (registration touch aside, exercise the
    // public touch path as the driveTurn stand-in).
    advance(TTL_MS + 1);
    sessionManager().touchAgentSession(SESSION_ID);
    await fetch(`${getUrl()}/api/sessions`);

    expect(sessionManager().getAgentSession(SESSION_ID)).toBe(warm);
  });
});
