import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
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
 * R2P-161b① — DELETE vs cold-start assembly (mirrors Rust 098adbd).
 *
 * POST /api/chat/:sessionId holds the cold-start assembly reservation
 * (reservedAgentSessions) while AgentSession.resume is awaited. The old
 * DELETE endpoint cleared that placeholder and deleted the disk directory —
 * the in-flight assembly's `finally` then re-registered a zombie
 * AgentSession over the deleted disk (its next turn's afterRun persistence
 * would recreate the directory: session "resurrection").
 *
 * Contract after the fix (aligned with Rust 098adbd's registry-first
 * delete): DELETE during assembly → 409 {reason: 'starting'}; DELETE after
 * the assembly settles → normal delete. AgentSession.resume is parked on a
 * deferred so the race window is held open deterministically.
 */

const { mockAgentSessionResume } = vi.hoisted(() => ({
  mockAgentSessionResume: vi.fn(),
}));

vi.mock('../../src/core/agent-session.js', () => ({
  AgentSession: {
    resume: mockAgentSessionResume,
  },
}));

/** A stand-in AgentSession whose handleMessage streams one done event. */
function makeFakeSession(sessionId: string) {
  return {
    sessionId,
    busy: false,
    stop: vi.fn(),
    respondHumanInput: vi.fn(),
    emitCockpitEvent: vi.fn(),
    handleMessage: async function* () {
      yield { event: 'done', data: {} };
    },
  };
}

describe('R2P-161b①: DELETE vs cold-start assembly', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let store: SessionStore;
  const SESSION_ID = 'delete-assembly-race';
  const sessionsDir = () => join(tempDir, 'sessions');

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-del-assembly-'));

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

    const sessionManager = new SessionManager(sessionsDir());
    await sessionManager.init();

    // Cold session on disk (present in the tree, not in the active registry).
    const wsPath = join(tempDir, 'workspace');
    store = new SessionStore(sessionsDir(), wsPath, defaultNodeHostEnv);
    await store.createWithId(SESSION_ID, 'test-agent');
    await store.updateMeta(SESSION_ID, { runnerConfig: { model: 'test-model' } });
    sessionManager.registerSession(SESSION_ID, wsPath);

    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    await fastify.register(chatRoutes);
    await fastify.register(sessionRoutes);
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
    // R2P-153 双轨迁移：send 默认 ack 化——旧「send 即流」断言经 ?stream=1 过渡轨保持（断言零改动）。
    return fetch(`${getUrl()}/api/chat/${SESSION_ID}?stream=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
  }

  function deleteSession(): Promise<Response> {
    return fetch(`${getUrl()}/api/sessions/${SESSION_ID}`, { method: 'DELETE' });
  }

  it(
    'DELETE while assembly is parked → 409 starting; after assembly settles → normal delete, no zombie',
    { timeout: 15_000 },
    async () => {
      const fakeSession = makeFakeSession(SESSION_ID);

      // Park the first message inside AgentSession.resume — the assembly
      // reservation is held for the whole window.
      let releaseResume!: (session: unknown) => void;
      let resumeEntered!: () => void;
      const entered = new Promise<void>((resolve) => {
        resumeEntered = resolve;
      });
      mockAgentSessionResume.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseResume = resolve;
            resumeEntered();
          })
      );

      const promiseChat = postMessage();
      await entered; // assembly in flight, reservation held

      // DELETE mid-assembly: must be refused (409 starting), NOT a silent
      // ok that clears the placeholder and orphans the in-flight assembly.
      const resDel = await deleteSession();
      expect(resDel.status).toBe(409);
      const body = await resDel.json();
      expect(body.error).toBe('Session is busy');
      expect(body.reason).toBe('starting');
      expect(typeof body.detail).toBe('string');

      // The disk directory is intact (the delete was refused wholesale).
      await expect(stat(store.getSessionDir(SESSION_ID))).resolves.toBeInstanceOf(Object);

      // Let the assembly finish: the message streams done, the session is
      // registered (a REAL session now, not a zombie over deleted disk).
      releaseResume(fakeSession);
      const resChat = await promiseChat;
      expect(resChat.status).toBe(200);
      expect(sessionManager().getAgentSession(SESSION_ID)).toBe(fakeSession);

      // DELETE after assembly settles → normal delete.
      const resDel2 = await deleteSession();
      expect(resDel2.status).toBe(200);
      await expect(resDel2.json()).resolves.toEqual({ ok: true });
      expect(sessionManager().getAgentSession(SESSION_ID)).toBeNull();
      expect(await sessionManager().getInfo(SESSION_ID)).toBeNull();
      await expect(stat(store.getSessionDir(SESSION_ID))).rejects.toThrow();
    }
  );
});
