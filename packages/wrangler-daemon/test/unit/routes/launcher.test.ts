/**
 * @fileoverview Unit tests for launcher data route
 *
 * Tests the /api/launcher endpoint:
 * - GET /api/launcher — returns { agents, skills, sessions }
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { SessionManager } from '../../../src/core/session-manager.js';
import { launcherRoutes } from '../../../src/routes/launcher.js';

describe('Unit: Launcher Routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let resourceManager: ResourceManager;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-launcher-routes-'));

    const agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    const sessionsDir = join(tempDir, 'sessions');

    resourceManager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await resourceManager.init();

    sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

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

  // Test 1: GET /api/launcher returns empty arrays when nothing created
  it('GET /api/launcher returns empty arrays when nothing created', async () => {
    const res = await fetch(`${getUrl()}/api/launcher`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({
      agents: [],
      skills: [],
      sessions: [],
    });
  });

  // Test 2: GET /api/launcher returns agents, skills, and sessions
  it('GET /api/launcher returns agents, skills, and sessions', async () => {
    // Create an agent
    await resourceManager.createAgent({ name: 'launcher-agent', instructions: 'Test' });

    // Create a skill
    await resourceManager.createSkill({ name: 'launcher-skill', description: 'Test skill' });

    // Create a session via SessionManager
    const wsPath = join(tempDir, 'workspace');
    sessionManager.registerSession('launcher-session', wsPath);
    const store = sessionManager.getSessionStore(wsPath);
    await store.createWithId('launcher-session', 'test-model', 'test-agent');

    const res = await fetch(`${getUrl()}/api/launcher`);
    expect(res.ok).toBe(true);
    const body = await res.json();

    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].id).toBe('launcher-agent');

    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].id).toBe('launcher-skill');

    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe('launcher-session');
  });

  // Test 3: GET /api/launcher with existing resources returns populated lists
  it('GET /api/launcher with multiple resources returns all items', async () => {
    // Create multiple agents
    await resourceManager.createAgent({ name: 'agent-a', instructions: 'A' });
    await resourceManager.createAgent({ name: 'agent-b', instructions: 'B' });

    // Create a skill
    await resourceManager.createSkill({ name: 'skill-x', description: 'X' });

    const res = await fetch(`${getUrl()}/api/launcher`);
    expect(res.ok).toBe(true);
    const body = await res.json();

    expect(body.agents).toHaveLength(2);
    expect(body.skills).toHaveLength(1);
    expect(body.sessions).toHaveLength(0);
  });
});
