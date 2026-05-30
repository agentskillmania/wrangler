/**
 * @fileoverview User Story: Per-Request Configuration (Integration)
 *
 * As a developer using the daemon API
 * I want to send per-request model and thinkingEnabled parameters
 * So that I can dynamically control LLM behavior without recreating sessions
 *
 * Acceptance Criteria:
 * 1. POST /api/agents/:name/chat accepts top-level model and thinkingEnabled
 * 2. POST /api/chat/:sessionId accepts per-request model and thinkingEnabled
 * 3. GET /api/models/:modelId/metadata returns YAML config metadata
 * 4. GET /api/models/:modelId/metadata returns 404 for unknown model
 * 5. Model metadata defaults to 0/false when YAML has no optional fields
 * 6. Resume chat ignores session-init fields, only uses per-request params
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../src/core/config-manager.js';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { SessionManager } from '../../src/core/session-manager.js';
import { chatRoutes } from '../../src/routes/chat.js';
import { modelRoutes } from '../../src/routes/models.js';
import { testConfig, itif } from './config.js';

/**
 * Helper: parse SSE text into structured events.
 */
function parseSSE(raw: string): Array<{ event: string; data: unknown }> {
  const results: Array<{ event: string; data: unknown }> = [];
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

describe('Integration: Per-Request Configuration', () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-per-req-'));

    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  baseUrl: '${testConfig.baseUrl || ''}'\n  apiKey: ${testConfig.apiKey}\n  model: ${testConfig.testModel}\n  contextWindow: 128000\n  maxTokens: 4096\n  reasoning: false\nserver:\n  port: 3100\n  host: localhost\n`
    );

    const configManager = new ConfigManager(configPath);
    await configManager.init();

    // Create agents directory with a test agent
    const agentsDir = join(tempDir, 'agents');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, 'test-agent.md'),
      `---\nname: test-agent\ndescription: A test agent\n---\nYou are a helpful test assistant. Answer briefly.`
    );

    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    const resourceManager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await resourceManager.init();

    const sessionsDir = join(tempDir, 'sessions');
    const sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.decorate('sessionManager', sessionManager);
    fastify.register(chatRoutes);
    fastify.register(modelRoutes);
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

  // ─── Model metadata endpoint (no LLM needed) ────────────────

  describe('GET /api/models/:modelId/metadata', () => {
    it('returns metadata for the configured model from YAML', async () => {
      const res = await fetch(`${getUrl()}/api/models/${testConfig.testModel}/metadata`);
      expect(res.ok).toBe(true);
      const body = await res.json();

      // Schema validation
      expect(body.modelId).toBe(testConfig.testModel);
      expect(typeof body.contextWindow).toBe('number');
      expect(typeof body.maxTokens).toBe('number');
      expect(typeof body.reasoning).toBe('boolean');

      // Constraint validation (values from YAML config)
      expect(body.contextWindow).toBe(128000);
      expect(body.maxTokens).toBe(4096);
      expect(body.reasoning).toBe(false);
    });

    it('returns 404 for unknown model', async () => {
      const res = await fetch(`${getUrl()}/api/models/nonexistent-gpt-99/metadata`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('not found');
    });
  });

  // ─── Chat API validation (no LLM needed) ────────────────────

  describe('POST /api/agents/:name/chat — validation', () => {
    it('returns 400 when message is missing', async () => {
      const res = await fetch(`${getUrl()}/api/agents/test-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath: '/tmp' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('returns 400 when workspacePath is missing', async () => {
      const res = await fetch(`${getUrl()}/api/agents/test-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('workspacePath is required');
    });

    it('returns 404 for unknown agent', async () => {
      const res = await fetch(`${getUrl()}/api/agents/nonexistent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Agent not found');
    });
  });

  describe('POST /api/chat/:sessionId — validation', () => {
    it('returns 400 when message is missing', async () => {
      const res = await fetch(`${getUrl()}/api/chat/fake-session`, {
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
  });

  // ─── End-to-end chat flow (needs real LLM) ──────────────────

  describe('POST /api/agents/:name/chat — end-to-end', () => {
    itif(testConfig.enabled)(
      'creates session and streams SSE with per-request params',
      async () => {
        const workspaceDir = join(tempDir, 'workspace');
        await mkdir(workspaceDir, { recursive: true });

        const res = await fetch(`${getUrl()}/api/agents/test-agent/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Say exactly: hello world',
            workspacePath: workspaceDir,
            thinkingEnabled: false,
            model: testConfig.testModel,
          }),
        });

        // Validate SSE stream
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/event-stream');

        const raw = await res.text();
        const events = parseSSE(raw);
        const eventTypes = events.map((e) => e.event);

        // Must contain session-start with a sessionId
        expect(eventTypes).toContain('session-start');
        const startEvent = events.find((e) => e.event === 'session-start');
        const sessionId = (startEvent!.data as { sessionId: string }).sessionId;
        expect(sessionId).toBeTruthy();

        // Must contain done event
        expect(eventTypes).toContain('done');
      }
    );
  });

  // ─── Resume chat with per-request model (needs real LLM) ────

  describe('POST /api/chat/:sessionId — resume with per-request model', () => {
    itif(testConfig.enabled)(
      'sends per-request model and thinkingEnabled to resumed session',
      async () => {
        const workspaceDir = join(tempDir, 'workspace');
        await mkdir(workspaceDir, { recursive: true });

        // Step 1: Create a session via new chat
        const createRes = await fetch(`${getUrl()}/api/agents/test-agent/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Say exactly: pong',
            workspacePath: workspaceDir,
          }),
        });

        expect(createRes.status).toBe(200);
        const createRaw = await createRes.text();
        const createEvents = parseSSE(createRaw);
        const startEvent = createEvents.find((e) => e.event === 'session-start');
        const sessionId = (startEvent!.data as { sessionId: string }).sessionId;

        // Step 2: Resume session with per-request params
        const resumeRes = await fetch(`${getUrl()}/api/chat/${sessionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Say exactly: world',
            thinkingEnabled: true,
            model: testConfig.testModel,
          }),
        });

        expect(resumeRes.status).toBe(200);
        expect(resumeRes.headers.get('content-type')).toBe('text/event-stream');

        const resumeRaw = await resumeRes.text();
        const resumeEvents = parseSSE(resumeRaw);
        const resumeEventTypes = resumeEvents.map((e) => e.event);

        // Resume should NOT send session-start (session already exists)
        expect(resumeEventTypes).not.toContain('session-start');
        // Must contain done
        expect(resumeEventTypes).toContain('done');
      }
    );
  });
});
