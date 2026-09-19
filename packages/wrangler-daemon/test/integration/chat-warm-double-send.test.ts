import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { SessionManager } from '../../src/core/session-manager.js';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { ConfigManager } from '../../src/core/config-manager.js';
import { AgentSession } from '../../src/core/agent-session.js';
import { chatRoutes } from '../../src/routes/chat.js';

/**
 * R2P-161b④ — warm-session double send must be mutually exclusive at the
 * HTTP layer (the TS counterpart check of Rust 098adbd's lock-then-recheck).
 *
 * Await-graph verdict (pinned here): the warm path from the route's busy
 * check to AgentSession's busy latch contains ZERO awaits — updateStatus is
 * sync, streamAgentSession's prologue (hijack/writeHead) is sync, and the
 * first `next()` on the handleMessage async generator runs its body
 * synchronously through `this._busy = true` in driveTurn (verified: async
 * generator bodies start synchronously inside next()). Single-threaded JS
 * therefore makes check-and-latch atomic: of two concurrent sends exactly
 * one wins the turn, and the loser is rejected at the ROUTE (HTTP 409 with
 * busy triage) — never as a 200 + in-stream SSE error frame.
 *
 * The mock runner parks run() on a gate so the winner's busy latch stays
 * observable for the loser's check, deterministically.
 */

const { mockAgentHarnessCreate } = vi.hoisted(() => ({
  mockAgentHarnessCreate: vi.fn(),
}));

vi.mock('@agentskillmania/wrangler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/wrangler')>();
  return {
    ...actual,
    AgentHarness: { create: mockAgentHarnessCreate, resume: vi.fn() },
  };
});

/** Mock runner whose run() parks on a gate before resolving (busy held). */
function createParkedRunner() {
  const eventHandlers: Record<string, (...args: unknown[]) => void> = {};
  const on = vi.fn((type: string, handler: (...args: unknown[]) => void) => {
    eventHandlers[type] = handler;
  });
  const off = vi.fn((type: string, _handler: (...args: unknown[]) => void) => {
    delete eventHandlers[type];
  });
  const emit = (type: string, ...args: unknown[]) => eventHandlers[type]?.(...args);

  let releaseRun!: () => void;
  const runGate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  const state = {
    id: 'parked-runner-state',
    config: { name: 'test-agent', instructions: '', tools: [] },
    context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
  };
  let runCalls = 0;
  const run = vi.fn().mockImplementation(async () => {
    runCalls++;
    const result = {
      type: 'success',
      answer: `turn-${runCalls}-answer`,
      totalSteps: 1,
      tokens: { input: 0, output: 0 },
    };
    emit('complete', { result });
    await runGate; // hold the busy latch for the whole assertion window
    return { state, result };
  });
  const runner = {
    run,
    on,
    off,
    setSessionTitleListener: vi.fn(),
    getToolInfo: vi.fn().mockReturnValue([]),
    getSkillInfo: vi.fn().mockReturnValue([]),
    getConfig: vi.fn().mockReturnValue({ model: 'test-model' }),
  };
  return { runner, run, releaseRun, runCount: () => runCalls };
}

describe('R2P-161b④: warm double send — HTTP-layer mutual exclusion (POST /api/chat/:sessionId)', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  const SESSION_ID = 'warm-double-send-session';
  let runnerHandle: ReturnType<typeof createParkedRunner>;
  let session: AgentSession;
  const mockLLMClient = { call: vi.fn(), stream: vi.fn(), getModelMeta: vi.fn() };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-warm-double-'));

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

    const sessionManager = new SessionManager(join(tempDir, 'sessions'));
    await sessionManager.init();

    const wsPath = join(tempDir, 'workspace');
    const store = sessionManager.getSessionStore(wsPath);
    await store.createWithId(SESSION_ID, 'test-agent');
    await store.updateMeta(SESSION_ID, { runnerConfig: { model: 'test-model' } });
    sessionManager.registerSession(SESSION_ID, wsPath);

    runnerHandle = createParkedRunner();
    mockAgentHarnessCreate.mockResolvedValue(runnerHandle.runner);
    session = await AgentSession.create(
      {
        sessionId: SESSION_ID,
        workspacePath: wsPath,
        agentName: 'test-agent',
        runtime: defaultNodeHostEnv,
        llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
      },
      configManager.get()
    );
    sessionManager.setAgentSession(SESSION_ID, session);

    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.register(chatRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await Promise.race([fastify.close(), new Promise((r) => setTimeout(r, 1500))]);
    await rm(tempDir, { recursive: true, force: true });
    mockAgentHarnessCreate.mockReset();
  });

  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  function postMessage(message: string): Promise<Response> {
    // R2P-153 双轨迁移：send 默认 ack 化——旧「send 即流」断言经 ?stream=1 过渡轨保持（断言零改动）。
    return fetch(`${getUrl()}/api/chat/${SESSION_ID}?stream=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  }

  it(
    'exactly one send drives the turn; the loser gets HTTP 409 busy (not a 200 + SSE error frame)',
    { timeout: 15_000 },
    async () => {
      // Double-click send: two concurrent POSTs on the warm session.
      const [resA, resB] = await Promise.all([postMessage('a'), postMessage('b')]);

      const responses = [resA, resB].sort((x, y) => x.status - y.status);
      const [winner, loser] = responses;

      // One accepted SSE stream…
      expect(winner.status).toBe(200);
      expect(winner.headers.get('content-type')).toBe('text/event-stream');

      // …and one HTTP-layer rejection: JSON 409 with busy triage — NOT
      // text/event-stream (a 200 + in-stream error frame would mean the
      // loser slipped past the route check into handleMessage's latch).
      expect(loser.status).toBe(409);
      expect(loser.headers.get('content-type')).not.toBe('text/event-stream');
      const body = await loser.json();
      expect(body.error).toBe('Session is busy');
      expect(body.reason).toBe('busy');
      expect(typeof body.detail).toBe('string');

      // The busy latch is held by the winner's parked run; exactly ONE turn
      // was ever driven (the loser never reached handleMessage).
      expect(session.busy).toBe(true);
      expect(runnerHandle.runCount()).toBe(1);

      // Release the winner's run and drain its stream to completion.
      runnerHandle.releaseRun();
      const raw = await winner.text();
      expect(raw).toContain('event: done');
      await new Promise((r) => setTimeout(r, 20));
      expect(session.busy).toBe(false);
      expect(runnerHandle.runCount()).toBe(1);
    }
  );
});
