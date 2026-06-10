import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SessionStore } from '@agentskillmania/wrangler';
import { SessionManager } from '../../src/core/session-manager.js';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { ConfigManager } from '../../src/core/config-manager.js';
import { chatRoutes } from '../../src/routes/chat.js';

/**
 * Integration tests for US-C4: Agent Chat Interaction.
 *
 * User Story:
 *   As a developer, I want to start or resume a chat conversation with an
 *   agent via SSE streaming so that I can interact with agents in real-time.
 *
 * Acceptance Criteria:
 *   1. POST /api/agents/:name/chat — starts a new conversation with SSE events
 *      (400 without message/workspacePath, 404 for unknown agent)
 *   2. POST /api/chat/:sessionId — resumes an existing conversation
 *      (400 without message, 404 for unknown session)
 *   3. GET /api/chat/:sessionId/messages — returns persisted message history
 *   4. POST /api/chat/:sessionId/stop — aborts active execution
 *   5. POST /api/chat/:sessionId/respond — resolves pending AskHuman prompts
 *   6. GET /api/chat/commands — lists available slash commands
 */
describe('US-C4: Agent Chat Interaction', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let sessionsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-chat-interaction-'));
    sessionsDir = join(tempDir, 'sessions');
    const sessionManager = new SessionManager(sessionsDir);
    const configManager = new ConfigManager(join(tempDir, 'config.yaml'));
    const resourceManager = new ResourceManager(
      join(tempDir, 'agents'),
      join(tempDir, 'skills'),
      join(tempDir, 'crews')
    );
    await configManager.init();
    await resourceManager.init();

    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.register(chatRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await fastify.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Resolve the base URL of the running test server */
  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  /**
   * Create a session on disk via SessionStore and register it with
   * SessionManager.  This mirrors what happens when a real agent run
   * auto-creates a session.
   */
  async function createTestSession(wsPath: string, id: string, agentName: string): Promise<void> {
    const manager = (fastify as any).sessionManager as SessionManager;
    const store = new SessionStore(sessionsDir, wsPath);
    await store.createWithId(id, agentName);
    manager.registerSession(id, wsPath);
  }

  // ──────────────────────────────────────────────────────────────────────
  // AC-1: POST /api/agents/:name/chat — new conversation
  // ──────────────────────────────────────────────────────────────────────

  describe('AC-1: Start new conversation (POST /api/agents/:name/chat)', () => {
    it('returns 400 when message is missing', async () => {
      const res = await fetch(`${getUrl()}/api/agents/some-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath: '/tmp/workspace' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('returns 400 when message is whitespace-only', async () => {
      const res = await fetch(`${getUrl()}/api/agents/some-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '   ',
          workspacePath: '/tmp/workspace',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('returns 400 when workspacePath is missing', async () => {
      const res = await fetch(`${getUrl()}/api/agents/some-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('workspacePath is required');
    });

    it('returns 400 when workspacePath is whitespace-only', async () => {
      const res = await fetch(`${getUrl()}/api/agents/some-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '   ' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('workspacePath is required');
    });

    it('returns 404 for unknown agent', async () => {
      const res = await fetch(`${getUrl()}/api/agents/nonexistent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/workspace',
        }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Agent not found');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // AC-2: POST /api/chat/:sessionId — resume conversation
  // ──────────────────────────────────────────────────────────────────────

  describe('AC-2: Resume conversation (POST /api/chat/:sessionId)', () => {
    it('returns 400 when message is missing', async () => {
      const res = await fetch(`${getUrl()}/api/chat/test-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('returns 400 when message is whitespace-only', async () => {
      const res = await fetch(`${getUrl()}/api/chat/test-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '   ' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('returns 404 for unknown session', async () => {
      const res = await fetch(`${getUrl()}/api/chat/nonexistent-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Session not found');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // AC-3: GET /api/chat/:sessionId/messages — message history
  // ──────────────────────────────────────────────────────────────────────

  describe('AC-3: Message history (GET /api/chat/:sessionId/messages)', () => {
    it('returns error for unknown session', async () => {
      const res = await fetch(`${getUrl()}/api/chat/nonexistent/messages`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Session not found');
    });

    it('returns empty messages array for new session', async () => {
      const wsPath = join(tempDir, 'workspace');
      await createTestSession(wsPath, 'empty-msg-session', 'test-agent');

      const res = await fetch(`${getUrl()}/api/chat/empty-msg-session/messages`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.messages).toEqual([]);
    });

    it('returns persisted entries written via SessionStore', async () => {
      const wsPath = join(tempDir, 'workspace');
      await createTestSession(wsPath, 'history-session', 'test-agent');

      // Write entries directly through SessionStore (simulates what a real
      // agent run would persist on disk).
      const manager = (fastify as any).sessionManager as SessionManager;
      const store = manager.getSessionStore(wsPath);
      await store.appendEntry('history-session', {
        id: 'msg-1',
        role: 'user',
        content: 'What is the weather today?',
        timestamp: new Date().toISOString(),
      });
      await store.appendEntry('history-session', {
        id: 'msg-2',
        role: 'assistant',
        content: 'It looks sunny with a high of 72F.',
        timestamp: new Date().toISOString(),
      });
      await store.appendEntry('history-session', {
        id: 'msg-3',
        role: 'user',
        content: 'Thanks!',
        timestamp: new Date().toISOString(),
      });

      const res = await fetch(`${getUrl()}/api/chat/history-session/messages`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.messages).toHaveLength(3);
      expect(body.messages[0]).toMatchObject({
        id: 'msg-1',
        role: 'user',
        content: 'What is the weather today?',
      });
      expect(body.messages[1]).toMatchObject({
        id: 'msg-2',
        role: 'assistant',
        content: 'It looks sunny with a high of 72F.',
      });
      expect(body.messages[2]).toMatchObject({
        id: 'msg-3',
        role: 'user',
        content: 'Thanks!',
      });
    });

    it('returns messages in insertion order', async () => {
      const wsPath = join(tempDir, 'workspace');
      await createTestSession(wsPath, 'order-session', 'test-agent');

      const manager = (fastify as any).sessionManager as SessionManager;
      const store = manager.getSessionStore(wsPath);

      // Write multiple entries rapidly to test ordering stability
      for (let i = 0; i < 5; i++) {
        await store.appendEntry('order-session', {
          id: `seq-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `message ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      const res = await fetch(`${getUrl()}/api/chat/order-session/messages`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.messages).toHaveLength(5);
      const ids = body.messages.map((m: any) => m.id);
      expect(ids).toEqual(['seq-0', 'seq-1', 'seq-2', 'seq-3', 'seq-4']);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // AC-4: POST /api/chat/:sessionId/stop — abort execution
  // ──────────────────────────────────────────────────────────────────────

  describe('AC-4: Stop execution (POST /api/chat/:sessionId/stop)', () => {
    it('returns ok for any session id', async () => {
      const res = await fetch(`${getUrl()}/api/chat/any-session/stop`, {
        method: 'POST',
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('is a no-op for a non-existent session', async () => {
      const res = await fetch(`${getUrl()}/api/chat/nonexistent/stop`, { method: 'POST' });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('invokes stop() on an active AgentSession', async () => {
      const wsPath = join(tempDir, 'workspace');
      await createTestSession(wsPath, 'stop-session', 'test-agent');

      let stopped = false;
      const mockAgentSession = {
        stop: () => {
          stopped = true;
        },
        handleMessage: async function* () {
          yield { event: 'done', data: {} };
        },
        respondHumanInput: () => false,
      };

      const manager = (fastify as any).sessionManager as SessionManager;
      manager.setAgentSession('stop-session', mockAgentSession as any);

      const res = await fetch(`${getUrl()}/api/chat/stop-session/stop`, { method: 'POST' });
      expect(res.ok).toBe(true);
      expect(stopped).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('does not throw when AgentSession is not registered', async () => {
      // Session exists on disk but has no active AgentSession
      const wsPath = join(tempDir, 'workspace');
      await createTestSession(wsPath, 'idle-session', 'test-agent');

      // Should succeed — the route checks getAgentSession which returns null
      const res = await fetch(`${getUrl()}/api/chat/idle-session/stop`, { method: 'POST' });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // AC-5: POST /api/chat/:sessionId/respond — resolve AskHuman
  // ──────────────────────────────────────────────────────────────────────

  describe('AC-5: Respond to AskHuman (POST /api/chat/:sessionId/respond)', () => {
    it('returns error when requestId is missing', async () => {
      const res = await fetch(`${getUrl()}/api/chat/test/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('requestId is required');
    });

    it('returns error for inactive (no AgentSession) session', async () => {
      const res = await fetch(`${getUrl()}/api/chat/test/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'r1', response: 'yes' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Session not found or not yet active');
    });

    it('returns error when request id is not found in pending map', async () => {
      const wsPath = join(tempDir, 'workspace');
      await createTestSession(wsPath, 'respond-session', 'test-agent');

      const mockAgentSession = {
        respondHumanInput: (_requestId: string, _response: unknown) => false,
        stop: () => {},
      };
      const manager = (fastify as any).sessionManager as SessionManager;
      manager.setAgentSession('respond-session', mockAgentSession as any);

      const res = await fetch(`${getUrl()}/api/chat/respond-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'r-unknown', response: 'answer' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Request not found or already answered');
    });

    it('resolves a pending AskHuman and returns ok', async () => {
      const wsPath = join(tempDir, 'workspace');
      await createTestSession(wsPath, 'resolve-session', 'test-agent');

      let capturedRequestId = '';
      let capturedResponse: unknown = null;
      const mockAgentSession = {
        respondHumanInput: (requestId: string, response: unknown) => {
          capturedRequestId = requestId;
          capturedResponse = response;
          return true;
        },
        stop: () => {},
      };
      const manager = (fastify as any).sessionManager as SessionManager;
      manager.setAgentSession('resolve-session', mockAgentSession as any);

      const res = await fetch(`${getUrl()}/api/chat/resolve-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'human-1234567890',
          response: 'My answer is 42',
        }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(capturedRequestId).toBe('human-1234567890');
      expect(capturedResponse).toBe('My answer is 42');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // AC-6: GET /api/chat/commands — slash commands
  // ──────────────────────────────────────────────────────────────────────

  describe('AC-6: List slash commands (GET /api/chat/commands)', () => {
    it('returns a non-empty command list', async () => {
      const res = await fetch(`${getUrl()}/api/chat/commands`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });

    it('each command has required fields (id, label, command, group)', async () => {
      const res = await fetch(`${getUrl()}/api/chat/commands`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      for (const cmd of body) {
        expect(cmd.id).toBeTruthy();
        expect(cmd.label).toBeTruthy();
        expect(cmd.command).toBeTruthy();
        expect(cmd.group).toBeTruthy();
      }
    });

    it('includes all expected slash commands', async () => {
      const res = await fetch(`${getUrl()}/api/chat/commands`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      const commandIds = body.map((c: any) => c.id);
      expect(commandIds).toContain('search');
      expect(commandIds).toContain('file');
      expect(commandIds).toContain('shell');
      expect(commandIds).toContain('todo');
      expect(commandIds).toContain('ask');
      expect(commandIds).toContain('think');
    });
  });
});
