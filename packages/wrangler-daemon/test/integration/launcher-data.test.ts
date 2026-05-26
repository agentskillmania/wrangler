/**
 * US-C9: Launcher Data — integration tests.
 *
 * As a developer, I want to get launcher data (agents, skills, sessions)
 * in one call so that I can populate the initial UI.
 *
 * Route: src/routes/launcher.ts (launcherRoutes)
 * Decorations: resourceManager (ResourceManager), sessionManager (SessionManager)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SessionStore } from '@agentskillmania/wrangler';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { SessionManager } from '../../src/core/session-manager.js';
import { launcherRoutes } from '../../src/routes/launcher.js';

describe('US-C9: Launcher Data', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let agentsDir: string;
  let skillsDir: string;
  let sessionsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-launcher-data-'));
    agentsDir = join(tempDir, 'agents');
    skillsDir = join(tempDir, 'skills');
    sessionsDir = join(tempDir, 'sessions');

    const resourceManager = new ResourceManager(agentsDir, skillsDir, join(tempDir, 'crews'));
    await resourceManager.init();

    const sessionManager = new SessionManager(sessionsDir);

    fastify = Fastify();
    fastify.decorate('resourceManager', resourceManager);
    fastify.decorate('sessionManager', sessionManager);
    fastify.register(launcherRoutes);
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

  /**
   * AC1: GET /api/launcher returns { agents, skills, sessions } combined.
   */
  it('GET /api/launcher returns { agents, skills, sessions } combined', async () => {
    const res = await fetch(`${getUrl()}/api/launcher`);
    expect(res.ok).toBe(true);
    const body = await res.json();

    expect(body).toHaveProperty('agents');
    expect(body).toHaveProperty('skills');
    expect(body).toHaveProperty('sessions');
    expect(Array.isArray(body.agents)).toBe(true);
    expect(Array.isArray(body.skills)).toBe(true);
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  /**
   * AC2: Includes agents created via ResourceManager.
   */
  it('includes agents created via ResourceManager', async () => {
    const resourceManager = (fastify as any).resourceManager as ResourceManager;

    await resourceManager.createAgent({
      name: 'greeter',
      instructions: 'You are a helpful greeter agent.',
    });
    await resourceManager.createAgent({
      name: 'coder',
      instructions: 'You write code.',
    });

    const res = await fetch(`${getUrl()}/api/launcher`);
    expect(res.ok).toBe(true);
    const body = await res.json();

    expect(body.agents).toHaveLength(2);
    const ids = body.agents.map((a: any) => a.id);
    expect(ids).toContain('greeter');
    expect(ids).toContain('coder');
  });

  /**
   * AC2: Includes skills created via ResourceManager.
   */
  it('includes skills created via ResourceManager', async () => {
    const resourceManager = (fastify as any).resourceManager as ResourceManager;

    await resourceManager.createSkill({
      name: 'code-review',
      description: 'Reviews code for quality and correctness.',
    });
    await resourceManager.createSkill({
      name: 'summarize',
      description: 'Summarizes text concisely.',
    });

    const res = await fetch(`${getUrl()}/api/launcher`);
    expect(res.ok).toBe(true);
    const body = await res.json();

    expect(body.skills).toHaveLength(2);
    const ids = body.skills.map((s: any) => s.id);
    expect(ids).toContain('code-review');
    expect(ids).toContain('summarize');
  });

  /**
   * AC3: Includes sessions registered via SessionManager (using SessionStore for disk creation).
   */
  it('includes sessions registered via SessionManager', async () => {
    const sessionManager = (fastify as any).sessionManager as SessionManager;

    const ws1 = join(tempDir, 'workspace-a');
    const ws2 = join(tempDir, 'workspace-b');

    const store1 = new SessionStore(sessionsDir, ws1);
    const store2 = new SessionStore(sessionsDir, ws2);
    await store1.createWithId('session-alpha', 'deepseek-chat', 'agent-a');
    await store2.createWithId('session-beta', 'gpt-4o', 'agent-b');

    sessionManager.registerSession('session-alpha', ws1);
    sessionManager.registerSession('session-beta', ws2);

    const res = await fetch(`${getUrl()}/api/launcher`);
    expect(res.ok).toBe(true);
    const body = await res.json();

    expect(body.sessions).toHaveLength(2);
    const sessionIds = body.sessions.map((s: any) => s.id);
    expect(sessionIds).toContain('session-alpha');
    expect(sessionIds).toContain('session-beta');
  });

  /**
   * AC1: Returns empty arrays when no resources exist.
   */
  it('returns empty arrays when no resources have been created', async () => {
    const res = await fetch(`${getUrl()}/api/launcher`);
    expect(res.ok).toBe(true);
    const body = await res.json();

    expect(body.agents).toEqual([]);
    expect(body.skills).toEqual([]);
    expect(body.sessions).toEqual([]);
  });

  /**
   * AC1 + AC2 + AC3: Combined response includes all three resource types together.
   */
  it('returns agents, skills, and sessions together in a single response', async () => {
    const resourceManager = (fastify as any).resourceManager as ResourceManager;
    const sessionManager = (fastify as any).sessionManager as SessionManager;

    // Create one of each resource type
    await resourceManager.createAgent({
      name: 'combined-agent',
      instructions: 'Combined test agent.',
    });
    await resourceManager.createSkill({
      name: 'combined-skill',
      description: 'Combined test skill.',
    });

    const ws = join(tempDir, 'ws-combined');
    const store = new SessionStore(sessionsDir, ws);
    await store.createWithId('combined-session', 'deepseek-chat', 'combined-agent');
    sessionManager.registerSession('combined-session', ws);

    const res = await fetch(`${getUrl()}/api/launcher`);
    expect(res.ok).toBe(true);
    const body = await res.json();

    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].id).toBe('combined-agent');

    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].id).toBe('combined-skill');

    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe('combined-session');
  });
});
