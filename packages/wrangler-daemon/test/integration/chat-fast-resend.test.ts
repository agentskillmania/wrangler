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
 * R2P-163 — immediate resend after the done frame (mirrors Rust 76197b9/91c8ae5).
 *
 * The done frame is enqueued synchronously by the 'complete' runner event
 * handler, but the busy latch is only released in the consumeStream `finally`
 * — AFTER `runner.run()` fully settles, and the real colts runner awaits its
 * afterRun persistence (final-state disk write) AFTER emitting 'complete'.
 * A client that resends the moment it receives the done frame (the normal
 * multi-turn pattern: E2E suites, quick follow-ups) therefore used to hit a
 * spurious 409 "Session is busy".
 *
 * The mock runner reproduces the real timing deterministically: run() emits
 * 'complete' and then parks on a gate (the afterRun window) before resolving.
 * The test reads the SSE stream, fires the second POST the instant the done
 * frame arrives, and releases the gate shortly after — the second send must
 * be accepted (200 + SSE), not 409.
 *
 * Real AgentSession + real SessionManager/routes; only the EnhancedRunner is
 * mocked (module-level vi.mock of '@agentskillmania/wrangler').
 */

// ─── Mock setup: EnhancedRunner only; everything else stays real ───

const { mockEnhancedRunnerCreate } = vi.hoisted(() => ({
  mockEnhancedRunnerCreate: vi.fn(),
}));

vi.mock('@agentskillmania/wrangler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/wrangler')>();
  return {
    ...actual,
    EnhancedRunner: { create: mockEnhancedRunnerCreate, resume: vi.fn() },
  };
});

/**
 * Mock runner whose run() mirrors the real colts terminal sequence:
 * emit('complete') THEN await the afterRun persistence before resolving.
 * Turn 1 parks on a caller-controlled gate; later turns resolve immediately.
 */
function createGatedRunner() {
  const eventHandlers: Record<string, (...args: unknown[]) => void> = {};
  const on = vi.fn((type: string, handler: (...args: unknown[]) => void) => {
    eventHandlers[type] = handler;
  });
  const off = vi.fn((type: string, _handler: (...args: unknown[]) => void) => {
    delete eventHandlers[type];
  });
  const emit = (type: string, ...args: unknown[]) => eventHandlers[type]?.(...args);

  let releaseAfterRun!: () => void;
  /** Resolves when the test lets turn 1's afterRun window finish. */
  const afterRunGate = new Promise<void>((resolve) => {
    releaseAfterRun = resolve;
  });

  let runCalls = 0;
  const state = {
    id: 'gated-runner-state',
    config: { name: 'test-agent', instructions: '', tools: [] },
    context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
  };
  const run = vi.fn().mockImplementation(async () => {
    runCalls++;
    const result = {
      type: 'success',
      answer: `turn-${runCalls}-answer`,
      totalSteps: 1,
      tokens: { input: 0, output: 0 },
    };
    // Real colts runner: 'complete' fires inside finalizeRun, then
    // runAfterRun (persistence) is awaited before the promise resolves.
    emit('complete', { result });
    if (runCalls === 1) {
      await afterRunGate;
    }
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
  return { runner, run, releaseAfterRun, runCount: () => runCalls };
}

// ─── SSE helpers ───

interface ParsedSSE {
  event: string;
  data: any;
}

function parseFrames(buffer: string): ParsedSSE[] {
  const results: ParsedSSE[] = [];
  for (const chunk of buffer.split('\n\n')) {
    if (!chunk.trim()) continue;
    let event = '';
    let data = '';
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (event) results.push({ event, data: data ? JSON.parse(data) : {} });
  }
  return results;
}

/** Read frames from a fetch SSE response until `predicate` matches one. */
async function readUntil(
  res: Response,
  predicate: (frame: ParsedSSE) => boolean
): Promise<ParsedSSE | undefined> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return undefined;
    buffer += decoder.decode(value, { stream: true });
    const frames = parseFrames(buffer);
    const hit = frames.find(predicate);
    if (hit) return hit;
  }
}

describe('R2P-163: immediate resend after the done frame (POST /api/chat/:sessionId)', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  const SESSION_ID = 'fast-resend-session';
  let runnerHandle: ReturnType<typeof createGatedRunner>;
  let session: AgentSession;
  const mockLLMClient = { call: vi.fn(), stream: vi.fn(), getModelMeta: vi.fn() };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-fast-resend-'));

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

    // Session on disk (so resolveSessionContext finds it) + warm registration
    // (so the route takes the warm path straight to the busy check).
    const wsPath = join(tempDir, 'workspace');
    const store = sessionManager.getSessionStore(wsPath);
    await store.createWithId(SESSION_ID, 'test-agent');
    await store.updateMeta(SESSION_ID, { runnerConfig: { model: 'test-model' } });
    sessionManager.registerSession(SESSION_ID, wsPath);

    // Real AgentSession over the gated mock runner.
    runnerHandle = createGatedRunner();
    mockEnhancedRunnerCreate.mockResolvedValue(runnerHandle.runner);
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
    mockEnhancedRunnerCreate.mockReset();
  });

  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  function postMessage(message: string): Promise<Response> {
    return fetch(`${getUrl()}/api/chat/${SESSION_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  }

  it(
    'a resend fired the instant the done frame arrives is accepted (busy clearance grace)',
    { timeout: 15_000 },
    async () => {
      // Turn 1: stream until the done frame reaches the client.
      const res1 = await postMessage('first');
      expect(res1.status).toBe(200);
      expect(res1.headers.get('content-type')).toBe('text/event-stream');

      const doneFrame = await readUntil(res1, (f) => f.event === 'done');
      expect(doneFrame).toBeDefined();
      expect(doneFrame!.data.answer).toBe('turn-1-answer');

      // The disease window: the done frame is on the wire while the busy
      // latch is still held — runner.run() is parked inside the afterRun
      // persistence that follows the 'complete' emission.
      expect(session.busy).toBe(true);
      expect(runnerHandle.runCount()).toBe(1);

      // Client pattern: resend immediately upon done.
      const promise2 = postMessage('second');

      // Still inside the grace window — release the afterRun gate so the
      // busy latch settles (a real disk write takes ~ms; 30ms is generous).
      await new Promise((r) => setTimeout(r, 30));
      runnerHandle.releaseAfterRun();

      const res2 = await promise2;
      // The pin: accepted and streamed — NOT the spurious 409.
      expect(res2.status).toBe(200);
      expect(res2.headers.get('content-type')).toBe('text/event-stream');
      const done2 = await readUntil(res2, (f) => f.event === 'done');
      expect(done2).toBeDefined();
      expect(done2!.data.answer).toBe('turn-2-answer');

      // Exactly two turns were driven; the latch settled after turn 2.
      expect(runnerHandle.runCount()).toBe(2);
      await new Promise((r) => setTimeout(r, 20));
      expect(session.busy).toBe(false);
    }
  );
});
