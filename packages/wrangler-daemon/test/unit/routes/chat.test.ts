import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../../src/core/config-manager.js';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { SessionManager } from '../../../src/core/session-manager.js';
import { chatRoutes } from '../../../src/routes/chat.js';

// ─── Mock setup ───

const { mockAgentSessionCreate, mockHandleMessage } = vi.hoisted(() => ({
  mockAgentSessionCreate: vi.fn(),
  mockHandleMessage: vi.fn(),
}));

vi.mock('../../../src/core/agent-session.js', () => ({
  AgentSession: {
    create: mockAgentSessionCreate,
  },
}));

/** Shared mock session instance reused across SSE streaming tests. */
const mockSession = {
  sessionId: 'mock-session-123',
  busy: false,
  handleMessage: mockHandleMessage,
  stop: vi.fn(),
  respondHumanInput: vi.fn(),
  emitCockpitEvent: vi.fn(),
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
      `llm:\n  baseUrl: 'https://api.example.com'\n  apiKey: sk-test\n  model: test-model\nserver:\n  port: 3100\n  host: localhost\n`
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
    await store.createWithId('existing-session', 'test-model', 'test-agent');
    sessionManager.registerSession('existing-session', join(tempDir, 'workspace'));

    // Fastify with decorators
    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.decorate('sessionManager', sessionManager);
    fastify.register(chatRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });

    mockAgentSessionCreate.mockClear();
    mockHandleMessage.mockClear();
    mockSession.stop.mockClear();
    mockSession.respondHumanInput.mockClear();
    mockSession.emitCockpitEvent.mockClear();
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

    it('returns error for non-existent session', async () => {
      const res = await fetch(`${getUrl()}/api/chat/nonexistent-session/messages`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Session not found');
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
            skillDirs: ['./skills'],
            mcpConfigPaths: ['./mcp.json'],
            builtinTools: { shell: false, fileRead: true },
            enableSession: false,
            enableTodolist: false,
            enableCommands: false,
            sandbox: false,
            a2ui: { enabled: true },
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);

      const callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
      // Session-init: model comes from agent default, not per-request model
      expect(callArg.skillDirs).toEqual(['./skills']);
      expect(callArg.mcpConfigPaths).toEqual(['./mcp.json']);
      expect(callArg.builtinTools).toEqual({ shell: false, fileRead: true });
      expect(callArg.enableSession).toBe(false);
      expect(callArg.enableTodolist).toBe(false);
      expect(callArg.enableCommands).toBe(false);
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
      // test agent has no explicit model/skillDirs/mcpPaths, so defaults apply
      expect(callArg.model).toBeUndefined();
      expect(callArg.skillDirs).toEqual([]);
      expect(callArg.mcpConfigPaths).toEqual([]);
      expect(callArg.sandbox).toBe(false);

      // Per-request params not provided, so handleMessage gets undefined
      const msgOpts = mockHandleMessage.mock.calls[0][1] as Record<string, unknown>;
      expect(msgOpts.model).toBeUndefined();
      expect(msgOpts.thinkingEnabled).toBeUndefined();
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
      mockAgentSessionCreate.mockResolvedValue(mockSession);
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
      mockAgentSessionCreate.mockResolvedValue(mockSession);
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

    it('passes per-request model and thinkingEnabled to handleMessage on resume', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
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
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);

      // Session creation uses stored model from session info, not body config
      const callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.model).toBe('test-model'); // from session store, not body
    });
  });
});
