import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../../src/core/config-manager.js';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { SessionNotFoundError, writeMeta } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { SessionManager } from '../../../src/core/session-manager.js';
import { chatRoutes } from '../../../src/routes/chat.js';

// ─── Mock setup ───

const { mockAgentSessionCreate, mockAgentSessionResume, mockHandleMessage } = vi.hoisted(() => ({
  mockAgentSessionCreate: vi.fn(),
  mockAgentSessionResume: vi.fn(),
  mockHandleMessage: vi.fn(),
}));

vi.mock('../../../src/core/agent-session.js', () => ({
  AgentSession: {
    create: mockAgentSessionCreate,
    resume: mockAgentSessionResume,
  },
}));

/** Shared mock session instance reused across SSE streaming tests. */
const mockRunnerConfig = {
  model: 'test-model',
  contextWindow: 128000,
  thinkingEnabled: false,
  enablePromptThinking: false,
  sandbox: false,
  compressorEnabled: false,
  enableSession: false,
  enableTodolist: false,
  enableSpecPlan: false,
  enableCommands: false,
  a2ui: { enabled: false },
  skillDirs: [],
  mcpConfigPaths: [],
};

const mockSession = {
  sessionId: 'mock-session-123',
  busy: false,
  handleMessage: mockHandleMessage,
  stop: vi.fn(),
  respondHumanInput: vi.fn(),
  emitCockpitEvent: vi.fn(),
  // The chat route reads `agentSession.getRunnerConfig()` (new accessor) to
  // build the `session-start` SSE payload (chat.ts streamAgentSession).
  // Without this the route throws synchronously after hijacking the reply,
  // leaving the SSE connection open and the test to deadlock on `await fetch(...)`.
  getRunnerConfig: () => mockRunnerConfig,
  runner: {
    getConfig: () => mockRunnerConfig,
  },
};

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

// ─── Tests ───

describe('Chat API', () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-chat-'));

    // ConfigManager
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      baseUrl: 'https://api.example.com'\n      models:\n        - modelId: test-model\nserver:\n  port: 3100\n  host: localhost\n`
    );
    const configManager = new ConfigManager(configPath);
    await configManager.init();

    // ResourceManager with a test agent
    const agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    const resourceManager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await resourceManager.init();
    await resourceManager.createAgent({ name: 'test-agent', instructions: 'test instructions' });

    // SessionManager
    const sessionsDir = join(tempDir, 'sessions');
    const sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

    // Create a session on disk for resume / history tests
    const store = sessionManager.getSessionStore(join(tempDir, 'workspace'));
    await store.createWithId('existing-session', 'test-agent');
    await store.updateMeta('existing-session', { runnerConfig: { model: 'test-model' } });
    sessionManager.registerSession('existing-session', join(tempDir, 'workspace'));

    // Fastify with decorators
    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.decorate('sessionManager', sessionManager);
    await fastify.register(chatRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });

    mockAgentSessionCreate.mockClear();
    mockAgentSessionResume.mockClear();
    mockHandleMessage.mockClear();
    mockSession.stop.mockClear();
    mockSession.respondHumanInput.mockClear();
    mockSession.emitCockpitEvent.mockClear();
  });

  afterEach(async () => {
    // Bound the close so an SSE response whose body a test forgot to drain
    // (or an aborted client the server hasn't reaped) can't deadlock teardown.
    // Tests SHOULD drain their SSE bodies; this guard just keeps a miss from
    // hanging the whole suite for the 30s default close timeout.
    await Promise.race([
      fastify.close(),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Resolve the random port assigned by Fastify. */
  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  // ─── GET /api/chat/commands ───

  describe('GET /api/chat/commands', () => {
    it('returns predefined commands array', async () => {
      const res = await fetch(`${getUrl()}/api/chat/commands`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      // Verify expected command IDs are present
      const ids = body.map((c: { id: string }) => c.id);
      expect(ids).toContain('search');
      expect(ids).toContain('file');
      expect(ids).toContain('shell');
      expect(ids).toContain('todo');
      expect(ids).toContain('ask');
      expect(ids).toContain('think');

      // Verify each command has required fields
      for (const cmd of body as Array<Record<string, string>>) {
        expect(cmd).toHaveProperty('id');
        expect(cmd).toHaveProperty('label');
        expect(cmd).toHaveProperty('command');
        expect(cmd).toHaveProperty('group');
        expect(cmd).toHaveProperty('description');
      }
    });
  });

  // ─── GET /api/chat/:sessionId/messages ───

  describe('GET /api/chat/:sessionId/messages', () => {
    it('returns message history for existing session', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session/messages`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body).toHaveProperty('messages');
      expect(Array.isArray(body.messages)).toBe(true);
    });

    it('returns empty messages for non-existent session (standard tree, 200)', async () => {
      const res = await fetch(`${getUrl()}/api/chat/nonexistent-session/messages`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.messages).toEqual([]);
    });
  });

  // ─── POST /api/chat/:sessionId/stop ───

  describe('POST /api/chat/:sessionId/stop', () => {
    it('stops active agent session', async () => {
      // Register an active agent session so stop() is called
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);

      const res = await fetch(`${getUrl()}/api/chat/existing-session/stop`, { method: 'POST' });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(mockSession.stop).toHaveBeenCalledTimes(1);
    });

    it('returns ok when no active session', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session/stop`, { method: 'POST' });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      // stop should NOT have been called since there was no active session
      expect(mockSession.stop).not.toHaveBeenCalled();
    });
  });

  // ─── POST /api/chat/:sessionId/respond ───

  describe('POST /api/chat/:sessionId/respond', () => {
    it('returns error when requestId missing', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: 'yes' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('requestId is required');
    });

    it('returns error when no active agent session', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'req-1', response: 'yes' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Session not found or not yet active');
    });

    it('returns error when request not found', async () => {
      // Register active session but respondHumanInput returns false
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockSession.respondHumanInput.mockReturnValue(false);

      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'unknown-req', response: 'yes' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Request not found or already answered');
    });

    it('responds successfully to valid request', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockSession.respondHumanInput.mockReturnValue(true);

      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'req-1', response: 'my answer' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(mockSession.respondHumanInput).toHaveBeenCalledWith('req-1', 'my answer');
    });
  });

  // ─── POST /api/agents/:name/chat (NEW conversation) ───

  describe('POST /api/agents/:name/chat', () => {
    it('returns 400 when message missing', async () => {
      const res = await fetch(`${getUrl()}/api/agents/test-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath: '/tmp' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('returns 400 when workspacePath missing', async () => {
      const res = await fetch(`${getUrl()}/api/agents/test-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('workspacePath is required');
    });

    it('returns 404 when agent not found', async () => {
      const res = await fetch(`${getUrl()}/api/agents/nonexistent-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Agent not found');
    });

    it('streams SSE events for valid new chat', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'hello' } };
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/agents/test-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp/test-ws' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');

      const raw = await res.text();
      const events = parseSSE(raw);
      const eventTypes = events.map((e) => e.event);

      // First event should be session-start with sessionId
      expect(eventTypes).toContain('session-start');
      const startEvent = events.find((e) => e.event === 'session-start');
      expect((startEvent!.data as { sessionId: string }).sessionId).toBe('mock-session-123');

      // Followed by token and done from handleMessage
      expect(eventTypes).toContain('token');
      expect(eventTypes).toContain('done');

      // AgentSession.create should have been called
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);
    });

    it('passes all config fields through to AgentSession.create', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/agents/test-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          model: 'gpt-4o',
          thinkingEnabled: true,
          config: {
            skills: { dirs: ['./skills'] },
            tools: { mcpConfigPaths: ['./mcp.json'], builtinFilter: { shell: false, fileRead: true } },
            session: { enabled: false },
            todolist: { enabled: false },
            commands: { enabled: false },
            sandbox: false,
            a2ui: { enabled: true },
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);

      const callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
      // Session-init: model comes from agent default, not per-request model
      expect(callArg.skills).toEqual({ dirs: ['./skills', expect.any(String)] });
      expect(callArg.tools).toEqual({ mcpConfigPaths: ['./mcp.json'], builtinFilter: { shell: false, fileRead: true } });
      expect(callArg.session).toEqual({ enabled: false });
      expect(callArg.todolist).toEqual({ enabled: false });
      expect(callArg.commands).toEqual({ enabled: false });
      expect(callArg.sandbox).toBe(false);
      expect(callArg.a2ui).toEqual({ enabled: true });

      // Per-request: model and thinkingEnabled passed to handleMessage
      expect(mockHandleMessage).toHaveBeenCalledTimes(1);
      const msgOpts = mockHandleMessage.mock.calls[0][1] as Record<string, unknown>;
      expect(msgOpts.model).toBe('gpt-4o');
      expect(msgOpts.thinkingEnabled).toBe(true);
    });

    it('uses agent defaults when config fields omitted', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/agents/test-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          config: {
            sandbox: false,
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);

      const callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
      // test agent has no explicit model/skills/mcpPaths, so defaults apply
      expect(callArg.model).toBeUndefined();
      expect(callArg.skills).toEqual({ dirs: [expect.any(String)] });
      expect(callArg.tools).toEqual({ mcpConfigPaths: [] });
      expect(callArg.sandbox).toBe(false);

      // Per-request params not provided, so handleMessage gets undefined
      const msgOpts = mockHandleMessage.mock.calls[0][1] as Record<string, unknown>;
      expect(msgOpts.model).toBeUndefined();
      expect(msgOpts.thinkingEnabled).toBeUndefined();
    });

    it('calls agentSession.stop() when client disconnects mid-stream', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);

      // handleMessage yields one event then blocks until stop() is called —
      // simulating a long-running agent stream that the client abandons.
      let unblock: () => void = () => {};
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'partial' } };
        await new Promise<void>((resolve) => {
          unblock = resolve;
        });
        yield { event: 'done', data: {} };
      });

      const controller = new AbortController();
      const res = await fetch(`${getUrl()}/api/agents/test-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp/test-ws' }),
        signal: controller.signal,
      });

      // Read the first chunk to ensure the stream has started, then abort —
      // this is the client-disconnect scenario CONC5 addresses.
      const reader = res.body!.getReader();
      await reader.read();
      controller.abort();
      try {
        await reader.read();
      } catch {
        // expected: aborted
      }

      // Allow the 'close' handler on the request to fire.
      await new Promise((r) => setTimeout(r, 100));

      // stop() must have been called exactly once (idempotent disconnect guard)
      // so the agent does not keep running after the client is gone.
      expect(mockSession.stop).toHaveBeenCalledTimes(1);

      // Unblock the mock generator so test teardown doesn't hang.
      unblock();
    });

    it('does not call stop() on normal stream completion', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'hi' } };
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/agents/test-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp/test-ws' }),
      });
      await res.text();

      // On a clean completion the route must not invoke stop().
      expect(mockSession.stop).not.toHaveBeenCalled();
    });
  });

  // ─── POST /api/chat/:sessionId (RESUME conversation) ───

  describe('POST /api/chat/:sessionId', () => {
    it('returns 400 when message missing', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('returns 404 when session not found', async () => {
      const res = await fetch(`${getUrl()}/api/chat/nonexistent-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Session not found');
    });

    it('streams SSE events for valid resume', async () => {
      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'world' } };
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'continue' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');

      const raw = await res.text();
      const events = parseSSE(raw);
      const eventTypes = events.map((e) => e.event);

      // No session-start event for resume (only sent on new conversations)
      expect(eventTypes).not.toContain('session-start');

      // Should contain token and done from handleMessage
      expect(eventTypes).toContain('token');
      expect(eventTypes).toContain('done');

      // Token event should carry the expected delta
      const tokenEvent = events.find((e) => e.event === 'token');
      expect((tokenEvent!.data as { delta: string }).delta).toBe('world');
    });

    it('reuses existing AgentSession if already active', async () => {
      // Pre-register an active session
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'continue' }),
      });

      expect(res.status).toBe(200);
      // AgentSession.create should NOT have been called — reused existing
      expect(mockAgentSessionCreate).not.toHaveBeenCalled();
    });

    it('streams error event on handleMessage exception', async () => {
      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'partial' } };
        throw new Error('stream blew up');
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'trigger error' }),
      });

      expect(res.status).toBe(200);
      const raw = await res.text();
      const events = parseSSE(raw);
      const errorEvent = events.find((e) => e.event === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.data as { message: string }).message).toBe('Internal server error');
    });

    it('returns 409 when session is busy', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      mockSession.busy = true;
      sm.setAgentSession('existing-session', mockSession as never);

      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('Session is busy');

      // Reset for other tests
      mockSession.busy = false;
    });

    it('returns 410 when AgentSession.resume throws SessionNotFoundError', async () => {
      mockAgentSessionResume.mockRejectedValue(new SessionNotFoundError('/tmp/missing'));

      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toBe('Session expired, please start a new conversation');
    });

    it('passes per-request model and thinkingEnabled to handleMessage on resume', async () => {
      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          model: 'gpt-4o',
          thinkingEnabled: true,
        }),
      });

      expect(res.status).toBe(200);

      // Per-request params should be passed to handleMessage
      expect(mockHandleMessage).toHaveBeenCalledTimes(1);
      const msgOpts = mockHandleMessage.mock.calls[0][1] as Record<string, unknown>;
      expect(msgOpts.model).toBe('gpt-4o');
      expect(msgOpts.thinkingEnabled).toBe(true);
    });

    it('uses stored session model for lazy creation on resume', async () => {
      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionResume).toHaveBeenCalledTimes(1);

      // Session resume receives sessionDir as first arg
      const callArg = mockAgentSessionResume.mock.calls[0][0] as string;
      expect(callArg).toContain('existing-session');
    });

    it('resumes from explicit sessionDir even when session is not in the standard tree', async () => {
      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      // Session lives in an explicit "notebook" dir — invisible to the
      // standard {root}/sessions tree; identity comes from its meta.yaml.
      const explicitDir = join(tempDir, 'notebook-sessions', 'my-session');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(explicitDir, { recursive: true });
      await writeMeta(
        explicitDir,
        {
          id: 'my-session',
          workspacePath: join(tempDir, 'workspace'),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          agentName: 'test-agent',
          runnerConfig: { model: 'test-model' },
        },
        defaultNodeHostEnv,
      );

      const res = await fetch(`${getUrl()}/api/chat/some-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', sessionDir: explicitDir }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionResume).toHaveBeenCalledTimes(1);
      expect(mockAgentSessionResume.mock.calls[0][0]).toBe(explicitDir);

      // Identity resolved from the explicit dir's meta.yaml
      const opts = mockAgentSessionResume.mock.calls[0][1] as {
        workspacePath: string;
        agentName: string;
      };
      expect(opts.workspacePath).toBe(join(tempDir, 'workspace'));
      expect(opts.agentName).toBe('test-agent');
    });

    it('returns 404 when explicit sessionDir has no meta.yaml', async () => {
      const res = await fetch(`${getUrl()}/api/chat/some-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          sessionDir: join(tempDir, 'missing-session-dir'),
        }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Session not found');
    });

    it('reloads crew subAgents on resume when meta.runnerConfig.crewId is set', async () => {
      // Seed a crew on disk so loadCrewConfig + crewToRunnerOptions produce subAgents
      const crewsDir = join(tempDir, 'crews');
      const crewDir = join(crewsDir, 'resume-crew');
      const { mkdir, writeFile: wf } = await import('node:fs/promises');
      await mkdir(join(crewDir, 'agents'), { recursive: true });
      await wf(
        join(crewDir, 'CREW.md'),
        '---\nname: resume-crew\nprimary-agent: orchestrator\n---\n\nMemory.\n'
      );
      await wf(
        join(crewDir, 'agents', 'orchestrator.md'),
        '---\nname: orchestrator\n---\n\nLead.\n'
      );
      await wf(
        join(crewDir, 'agents', 'researcher.md'),
        '---\nname: researcher\n---\n\nResearch.\n'
      );

      // Create a session whose meta.yaml carries crewId, so resume detects it
      const store = (
        fastify as unknown as { sessionManager: SessionManager }
      ).sessionManager.getSessionStore(join(tempDir, 'workspace'));
      await store.createWithId('crew-resume-session', 'orchestrator');
      await store.updateMeta('crew-resume-session', {
        runnerConfig: { model: 'test-model', crewId: 'resume-crew' },
      });
      (fastify as unknown as { sessionManager: SessionManager }).sessionManager.registerSession(
        'crew-resume-session',
        join(tempDir, 'workspace')
      );

      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/crew-resume-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'follow up' }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionResume).toHaveBeenCalledTimes(1);

      // The options passed to AgentSession.resume should contain the
      // subAgents rebuilt from the crew config (researcher is non-primary).
      const resumeOpts = mockAgentSessionResume.mock.calls[0][1] as {
        subAgents?: Array<{ name: string }>;
      };
      expect(resumeOpts.subAgents).toBeDefined();
      expect(resumeOpts.subAgents!.map((s) => s.name)).toEqual(['researcher']);
    });
  });

  // ─── POST /api/crews/:id/chat (NEW crew conversation) ───

  describe('POST /api/crews/:id/chat', () => {
    beforeEach(async () => {
      // Seed a demo crew with primary (orchestrator) + worker (researcher)
      const crewsDir = join(tempDir, 'crews');
      const crewDir = join(crewsDir, 'demo-crew');
      const { mkdir, writeFile: wf } = await import('node:fs/promises');
      await mkdir(join(crewDir, 'agents'), { recursive: true });
      await wf(
        join(crewDir, 'CREW.md'),
        '---\nname: demo-crew\nprimary-agent: orchestrator\n---\n\nShared crew memory.\n'
      );
      await wf(
        join(crewDir, 'agents', 'orchestrator.md'),
        '---\nname: orchestrator\ndescription: primary coordinator\n---\n\nOrchestrate.\n'
      );
      await wf(
        join(crewDir, 'agents', 'researcher.md'),
        '---\nname: researcher\ndescription: research helper\n---\n\nResearch topics.\n'
      );
    });

    it('returns 400 when message missing', async () => {
      const res = await fetch(`${getUrl()}/api/crews/demo-crew/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath: '/tmp' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('returns 400 when workspacePath missing', async () => {
      const res = await fetch(`${getUrl()}/api/crews/demo-crew/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('workspacePath is required');
    });

    it('returns 404 when crew not found', async () => {
      const res = await fetch(`${getUrl()}/api/crews/nonexistent-crew/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Crew not found');
    });

    it('streams SSE events for valid crew chat', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'crew reply' } };
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/crews/demo-crew/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp/test-ws' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');

      const raw = await res.text();
      const events = parseSSE(raw);
      const eventTypes = events.map((e) => e.event);

      expect(eventTypes).toContain('session-start');
      expect(eventTypes).toContain('token');
      expect(eventTypes).toContain('done');

      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);
    });

    it('passes crewId, subAgents, primary agent name, and crew system prompt to AgentSession.create', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/crews/demo-crew/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp/test-ws' }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);

      const callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;

      // crewId is persisted to runnerConfig snapshot
      expect(callArg.crewId).toBe('demo-crew');
      // agentName is the primary agent of the crew
      expect(callArg.agentName).toBe('orchestrator');
      // subAgents are non-primary agents (researcher)
      const subAgents = callArg.subAgents as Array<{ name: string }>;
      expect(Array.isArray(subAgents)).toBe(true);
      expect(subAgents.map((s) => s.name)).toEqual(['researcher']);
      // agentInstructions carry the composed crew system prompt (memory + primary instructions + catalog)
      const instructions = callArg.agentInstructions as string;
      expect(instructions).toContain('Shared crew memory');
      expect(instructions).toContain('Orchestrate');
      // BUILTIN_SKILLS_DIR is appended
      expect(callArg.skills).toEqual({ dirs: [expect.any(String)] });
    });

    it('emits session-start, forwards client disconnect to agentSession.stop()', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      let unblock: () => void = () => {};
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'partial' } };
        await new Promise<void>((resolve) => {
          unblock = resolve;
        });
        yield { event: 'done', data: {} };
      });

      const controller = new AbortController();
      const res = await fetch(`${getUrl()}/api/crews/demo-crew/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp/test-ws' }),
        signal: controller.signal,
      });

      const reader = res.body!.getReader();
      await reader.read();
      controller.abort();
      try {
        await reader.read();
      } catch {
        // expected
      }

      await new Promise((r) => setTimeout(r, 100));
      expect(mockSession.stop).toHaveBeenCalledTimes(1);
      unblock();
    });
  });
});
