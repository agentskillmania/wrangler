/**
 * @fileoverview User Story: Crew chat end-to-end via daemon HTTP API (Integration)
 *
 * As a daemon client
 * I want to start a conversation driven by a crew config
 * So that the primary agent can delegate sub-tasks to worker sub-agents
 * and I see the delegation events stream through SSE in real time
 *
 * Acceptance Criteria:
 * 1. POST /api/crews/:id/chat creates a session and streams SSE
 * 2. The SSE stream contains subagent-* events proving the primary agent
 *    delegated to the worker sub-agent (subagent-start, subagent-token,
 *    subagent-end)
 * 3. POST /api/chat/:sessionId resumes the crew session and the resumed
 *    session still has the delegate tool wired (subagent-* events fire again)
 *
 * Tests use the real LLM via .env (no mocks). Gated by
 * ENABLE_INTEGRATION_TESTS=true. The fixture is a minimal crew whose
 * orchestrator is instructed to delegate every user question verbatim,
 * and whose researcher is instructed to answer with a fixed keyword —
 * so the test verifies the *event-flow pathway*, not sub-agent intelligence.
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

describe('Integration: Crew chat', () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-crew-chat-'));

    // LLM config from .env (no mocks)
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  providers:\n    - name: ${testConfig.provider}\n      apiKey: ${testConfig.apiKey}\n${testConfig.baseUrl ? `      baseUrl: '${testConfig.baseUrl}'\n` : ''}      models:\n        - modelId: ${testConfig.testModel}\n          contextWindow: 128000\n          maxTokens: 4096\n          reasoning: false\nserver:\n  port: 3100\n  host: localhost\n`
    );
    const configManager = new ConfigManager(configPath);
    await configManager.init();

    // Build a minimal crew on disk:
    //   - primary: orchestrator (forced to delegate every question)
    //   - worker:  researcher (answers with a fixed keyword)
    const agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    const crewDir = join(crewsDir, 'delegate-crew');
    await mkdir(join(crewDir, 'agents'), { recursive: true });

    await writeFile(
      join(crewDir, 'CREW.md'),
      [
        '---',
        'name: delegate-crew',
        'primary-agent: orchestrator',
        '---',
        '',
        '# delegate-crew',
        '',
        'A crew whose orchestrator must delegate every user question to the researcher.',
        '',
      ].join('\n')
    );

    await writeFile(
      join(crewDir, 'agents', 'orchestrator.md'),
      [
        '---',
        'name: orchestrator',
        'description: routes every user question to the researcher',
        '---',
        '',
        'You are the orchestrator. For EVERY user question, you MUST call the',
        '`delegate` tool with name="researcher" and pass the user question as the',
        'task. Do not answer the question yourself. After the researcher returns,',
        'reply with a one-line summary that includes the token "DELEGATED".',
      ].join('\n')
    );

    await writeFile(
      join(crewDir, 'agents', 'researcher.md'),
      [
        '---',
        'name: researcher',
        'description: answers questions with a fixed marker',
        '---',
        '',
        'You are the researcher. Answer the delegated task briefly. Your answer',
        'must include the token "RESEARCHER_OK".',
      ].join('\n')
    );

    const resourceManager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await resourceManager.init();

    const sessionsDir = join(tempDir, 'sessions');
    const sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.decorate('sessionManager', sessionManager);
    await fastify.register(chatRoutes);
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

  itif(testConfig.enabled)(
    'POST /api/crews/:id/chat streams subagent-* events for a delegation round',
    { timeout: 180_000 } as never,
    async () => {
      const workspaceDir = join(tempDir, 'workspace');
      await mkdir(workspaceDir, { recursive: true });

      const res = await fetch(`${getUrl()}/api/crews/delegate-crew/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'What is 2+2? Delegate this to the researcher.',
          workspacePath: workspaceDir,
          thinkingEnabled: false,
          model: testConfig.testModel,
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');

      const raw = await res.text();
      const events = parseSSE(raw);
      const eventTypes = events.map((e) => e.event);

      // Session lifecycle
      expect(eventTypes).toContain('session-start');
      const startEvent = events.find((e) => e.event === 'session-start');
      const sessionId = (startEvent!.data as { sessionId: string }).sessionId;
      expect(sessionId).toBeTruthy();

      expect(eventTypes).toContain('done');

      // Sub-agent delegation pathway — the core assertion of this test.
      // If any of these are missing, the daemon crew integration is broken.
      expect(eventTypes).toContain('subagent-start');
      expect(eventTypes).toContain('subagent-token');
      expect(eventTypes).toContain('subagent-end');

      // The sub-agent's tokens must carry the fixed marker, proving the
      // researcher (not the orchestrator) produced the streamed output.
      const subagentTokens = events
        .filter((e) => e.event === 'subagent-token')
        .map((e) => (e.data as { delta?: string }).delta ?? '')
        .join('');
      expect(subagentTokens).toMatch(/RESEARCHER_OK/);

      // subagent-end must carry structured metrics (tokens + duration)
      const subagentEnd = events.find((e) => e.event === 'subagent-end');
      expect(subagentEnd).toBeDefined();
      const endData = subagentEnd!.data as Record<string, unknown>;
      expect(endData.tokens).toBeDefined();
      expect((endData.tokens as { input: number }).input).toBeGreaterThanOrEqual(0);
      expect(endData.duration).toBeDefined();
      expect(endData.duration as number).toBeGreaterThanOrEqual(0);
    }
  );

  itif(testConfig.enabled)(
    'POST /api/chat/:sessionId resumes a crew session and delegation still fires',
    { timeout: 180_000 } as never,
    async () => {
      const workspaceDir = join(tempDir, 'workspace');
      await mkdir(workspaceDir, { recursive: true });

      // Step 1: open a new crew chat to create the session.
      const firstRes = await fetch(`${getUrl()}/api/crews/delegate-crew/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Say hello. Delegate this to the researcher.',
          workspacePath: workspaceDir,
          thinkingEnabled: false,
          model: testConfig.testModel,
        }),
      });
      expect(firstRes.status).toBe(200);
      const firstRaw = await firstRes.text();
      const firstEvents = parseSSE(firstRaw);
      const startEvent = firstEvents.find((e) => e.event === 'session-start');
      const sessionId = (startEvent!.data as { sessionId: string }).sessionId;
      expect(sessionId).toBeTruthy();

      // Evict the in-memory AgentSession so the next /api/chat/:sessionId
      // call is forced down the AgentSession.resume path (which is what
      // step 7's crewId reload addresses). Without this eviction, the
      // daemon would just reuse the still-active runner and never reload
      // crew config — masking any resume-path regression.
      const sm = (
        fastify as unknown as {
          sessionManager: SessionManager & {
            activeSessions: Map<string, unknown>;
          };
        }
      ).sessionManager;
      sm.activeSessions.delete(sessionId);
      // Sanity check: eviction worked.
      expect(sm.activeSessions.has(sessionId)).toBe(false);

      // Step 2: resume the session with a follow-up that should also delegate.
      const resumeRes = await fetch(`${getUrl()}/api/chat/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'One more: what is 3+3? Delegate to the researcher.',
          thinkingEnabled: false,
          model: testConfig.testModel,
        }),
      });

      expect(resumeRes.status).toBe(200);
      const resumeRaw = await resumeRes.text();
      const resumeEvents = parseSSE(resumeRaw);
      const resumeEventTypes = resumeEvents.map((e) => e.event);

      expect(resumeEventTypes).toContain('done');
      // The resumed session must still have the delegate tool wired
      // (this is what step 7's crewId reload makes possible).
      expect(resumeEventTypes).toContain('subagent-start');
      expect(resumeEventTypes).toContain('subagent-token');
      expect(resumeEventTypes).toContain('subagent-end');

      const subagentTokens = resumeEvents
        .filter((e) => e.event === 'subagent-token')
        .map((e) => (e.data as { delta?: string }).delta ?? '')
        .join('');
      expect(subagentTokens).toMatch(/RESEARCHER_OK/);
    }
  );
});
