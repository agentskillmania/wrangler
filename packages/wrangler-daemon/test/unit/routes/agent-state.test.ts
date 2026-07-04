import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SessionManager } from '../../../src/core/session-manager.js';
import { agentStateRoutes } from '../../../src/routes/agent-state.js';

// ─── SSE parsing helper ───

interface ParsedSSE {
  event: string;
  data: unknown;
}

function parseSSE(raw: string): ParsedSSE[] {
  const results: ParsedSSE[] = [];
  const chunks = raw.split('\n\n').filter((c) => c.trim());
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (event) {
      results.push({ event, data: data ? JSON.parse(data) : {} });
    }
  }
  return results;
}

/**
 * Fetch an SSE endpoint and collect the first response chunk.
 * Uses AbortController to ensure the long-lived SSE stream does not
 * hang the test. Returns as soon as the first readable chunk arrives
 * or the timeout elapses.
 */
async function fetchSSE(
  url: string,
  readTimeoutMs = 500
): Promise<{ status: number; headers: Headers; body: string }> {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal });

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  try {
    // Read chunks until we get at least one complete SSE frame
    const readDeadline = Date.now() + readTimeoutMs;
    // eslint-disable-next-line no-constant-condition
    while (Date.now() < readDeadline) {
      const readPromise = reader.read();
      const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), readDeadline - Date.now())
      );

      const result = await Promise.race([readPromise, timeoutPromise]);
      if (result.done || !result.value) break;

      chunks.push(decoder.decode(result.value, { stream: true }));
    }
  } finally {
    reader.cancel().catch(() => {});
    controller.abort();
  }

  return {
    status: res.status,
    headers: res.headers,
    body: chunks.join(''),
  };
}

// ─── Mock AgentSession ───

const mockGetState = vi.fn().mockReturnValue({
  id: 'test-session',
  config: { name: 'test-agent', instructions: '', tools: [] },
  context: {
    messages: [],
    stepCount: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    totalTokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    estimatedContextSize: 2000,
  },
});
/** Tracks disposers returned by addCockpitSender so tests can assert cleanup. */
const mockDisposers: Array<() => void> = [];
const mockAddCockpitSender = vi.fn((sender: (event: { event: string; data: unknown }) => void) => {
  sender({
    event: 'agent-diagnostics',
    data: {
      runner: { model: 'test-model', sandbox: true },
      agent: mockGetState(),
      llm: null,
    },
  });
  const disposer = vi.fn(() => {
    /* removed */
  });
  mockDisposers.push(disposer);
  return disposer;
});
const mockAgentSession = {
  addCockpitSender: mockAddCockpitSender,
  getState: mockGetState,
};

// ─── Tests ───

describe('Agent State SSE route', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let sessionManager: SessionManager;
  let workspacePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-agent-state-'));
    workspacePath = join(tempDir, 'workspace');

    const sessionsDir = join(tempDir, 'sessions');
    sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
    await fastify.register(agentStateRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });

    mockAddCockpitSender.mockClear();
    mockDisposers.length = 0;
  });

  afterEach(async () => {
    await fastify.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Resolve the random port assigned by Fastify. */
  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  /** Create a session on disk and register it with the session manager. */
  async function createSession(sessionId: string): Promise<void> {
    const store = sessionManager.getSessionStore(workspacePath);
    await store.createWithId(sessionId, 'test-agent');
    sessionManager.registerSession(sessionId, workspacePath);
  }

  // ─── GET /api/agent/:sessionId/state ───

  describe('GET /api/agent/:sessionId/state', () => {
    it('returns 404 for non-existent session', async () => {
      const res = await fetch(`${getUrl()}/api/agent/nonexistent/state`);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Session not found');
    });

    it('sends SSE headers for existing session', async () => {
      await createSession('test-session');

      const { status, headers, body } = await fetchSSE(`${getUrl()}/api/agent/test-session/state`);

      expect(status).toBe(200);
      expect(headers.get('content-type')).toBe('text/event-stream');
      expect(headers.get('cache-control')).toBe('no-cache');

      // Verify we got at least one agent-diagnostics SSE frame
      const events = parseSSE(body);
      expect(events.some((e) => e.event === 'agent-diagnostics')).toBe(true);
    });

    it('sends real AgentState for active session', async () => {
      await createSession('snapshot-session');
      sessionManager.setAgentSession('snapshot-session', mockAgentSession as never);

      const { body } = await fetchSSE(`${getUrl()}/api/agent/snapshot-session/state`);

      const events = parseSSE(body);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const diagEvent = events.find((e) => e.event === 'agent-diagnostics');
      expect(diagEvent).toBeDefined();

      const data = diagEvent!.data as Record<string, unknown>;
      const agent = data.agent as Record<string, unknown>;
      // Should be real AgentState, not hardcoded snapshot
      expect(agent.id).toBe('test-session');
      expect(agent.config).toBeDefined();
      expect((agent.context as Record<string, unknown>).stepCount).toBe(3);
      expect((agent.context as Record<string, unknown>).estimatedContextSize).toBe(2000);
    });

    it('loads persisted state from disk when no active AgentSession', async () => {
      await createSession('persisted-session');

      // Write a real state.json to disk
      const store = sessionManager.getSessionStore(workspacePath);
      const fakeState = {
        id: 'persisted-session',
        config: { name: 'test-agent', instructions: 'be helpful', tools: [] },
        context: {
          messages: [{ role: 'user', content: 'hello', id: 'm1', timestamp: 0 }],
          stepCount: 7,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          totalTokens: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
        },
      };
      await store.saveState('persisted-session', fakeState);

      const { body } = await fetchSSE(`${getUrl()}/api/agent/persisted-session/state`);

      const events = parseSSE(body);
      const diagEvent = events.find((e) => e.event === 'agent-diagnostics');
      expect(diagEvent).toBeDefined();

      const data = diagEvent!.data as Record<string, unknown>;
      const agent = data.agent as Record<string, unknown>;
      expect(agent.id).toBe('persisted-session');
      expect((agent.context as Record<string, unknown>).stepCount).toBe(7);
    });

    it('sends no-state when disk has no state file', async () => {
      await createSession('empty-session');
      // Don't write state.json — simulates a brand new session

      const { body } = await fetchSSE(`${getUrl()}/api/agent/empty-session/state`);

      const events = parseSSE(body);
      const diagEvent = events.find((e) => e.event === 'agent-diagnostics');
      expect(diagEvent).toBeDefined();
      const agent = (diagEvent!.data as Record<string, unknown>).agent as Record<string, unknown>;
      expect(agent.status).toBe('no-state');
    });

    it('wires cockpit forwarding for active AgentSession', async () => {
      await createSession('active-session');
      sessionManager.setAgentSession('active-session', mockAgentSession as never);

      const { status, body } = await fetchSSE(`${getUrl()}/api/agent/active-session/state`);

      expect(status).toBe(200);
      // Ensure the handler ran and emitted at least one diagnostics frame
      const events = parseSSE(body);
      expect(events.some((e) => e.event === 'agent-diagnostics')).toBe(true);

      // addCockpitSender should have been called with a function
      expect(mockAddCockpitSender).toHaveBeenCalled();
      const functionCall = mockAddCockpitSender.mock.calls.find(
        (call: [unknown]) => typeof call[0] === 'function'
      );
      expect(functionCall).toBeDefined();
    });

    it('disposes cockpit sender on request close', { timeout: 10000 }, async () => {
      await createSession('close-session');
      sessionManager.setAgentSession('close-session', mockAgentSession as never);

      const { status, body } = await fetchSSE(`${getUrl()}/api/agent/close-session/state`);

      expect(status).toBe(200);
      expect(body).toContain('event: agent-diagnostics');

      // fetchSSE aborts the request after reading, which triggers 'close'
      // Allow the close event handler to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      // On close, the route must invoke the disposer returned by addCockpitSender
      expect(mockDisposers.length).toBeGreaterThanOrEqual(1);
      expect(mockDisposers[mockDisposers.length - 1]).toHaveBeenCalled();
    });
  });
});
