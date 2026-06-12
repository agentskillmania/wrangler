/**
 * @fileoverview Unit tests for agent CRUD routes
 *
 * Tests the /api/agents endpoints:
 * - GET /api/agents — list all agents
 * - GET /api/agents/:id — get agent detail
 * - POST /api/agents — create agent
 * - DELETE /api/agents/:id — delete agent
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { agentRoutes } from '../../../src/routes/agents.js';

describe('Unit: Agent CRUD Routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let agentsDir: string;
  let manager: ResourceManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-agent-routes-'));
    agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    fastify = Fastify();
    fastify.decorate('resourceManager', manager);
    await fastify.register(agentRoutes);
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

  // Test 1: GET /api/agents returns empty list when no agents
  it('GET /api/agents returns empty list when no agents', async () => {
    const res = await fetch(`${getUrl()}/api/agents`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  // Test 2: GET /api/agents returns created agents
  it('GET /api/agents returns created agents', async () => {
    await manager.createAgent({ name: 'test-agent', instructions: 'A test agent.' });

    const res = await fetch(`${getUrl()}/api/agents`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: 'test-agent',
      name: 'test-agent',
    });
  });

  // Test 3: GET /api/agents/:id returns agent detail
  it('GET /api/agents/:id returns agent detail', async () => {
    await manager.createAgent({
      name: 'coder',
      instructions: 'You are a coding assistant.',
    });

    const res = await fetch(`${getUrl()}/api/agents/coder`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.id).toBe('coder');
    expect(body.instructions).toContain('coding assistant');
    expect(body).toHaveProperty('path');
  });

  // Test 4: GET /api/agents/:id returns error for non-existent agent
  it('GET /api/agents/:id returns error for non-existent agent', async () => {
    const res = await fetch(`${getUrl()}/api/agents/non-existent`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'Agent not found' });
  });

  // Test 5: POST /api/agents creates agent with name only
  it('POST /api/agents creates agent with name only', async () => {
    const res = await fetch(`${getUrl()}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new-agent' }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ id: 'new-agent' });

    // Verify agent directory exists
    expect(existsSync(join(agentsDir, 'new-agent'))).toBe(true);
    expect(existsSync(join(agentsDir, 'new-agent', 'AGENT.md'))).toBe(true);
  });

  // Test 6: POST /api/agents creates agent with name and instructions
  it('POST /api/agents creates agent with name and instructions', async () => {
    const res = await fetch(`${getUrl()}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'instructed-agent',
        instructions: 'You are an expert.',
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ id: 'instructed-agent' });
  });

  // Test 7: POST /api/agents returns error when name missing
  it('POST /api/agents returns error when name missing', async () => {
    const res = await fetch(`${getUrl()}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions: 'No name provided' }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'name is required' });
  });

  it('POST /api/agents returns error when name contains path traversal', async () => {
    const res = await fetch(`${getUrl()}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '../escaped' }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.error).toContain('path separators or traversal sequences');
  });

  // Test 8: DELETE /api/agents/:id removes agent
  it('DELETE /api/agents/:id removes agent', async () => {
    // Create an agent first
    await fetch(`${getUrl()}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'delete-me' }),
    });

    expect(existsSync(join(agentsDir, 'delete-me'))).toBe(true);

    const delRes = await fetch(`${getUrl()}/api/agents/delete-me`, { method: 'DELETE' });
    expect(delRes.ok).toBe(true);
    const delBody = await delRes.json();
    expect(delBody).toEqual({ ok: true });

    expect(existsSync(join(agentsDir, 'delete-me'))).toBe(false);
  });

  // Test 9: DELETE /api/agents/:id is idempotent
  it('DELETE /api/agents/:id is idempotent', async () => {
    const res = await fetch(`${getUrl()}/api/agents/non-existent`, { method: 'DELETE' });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  // Test 10: POST /api/agents with traversal name must not escape agents dir
  it('POST /api/agents with traversal name must not escape agents dir', async () => {
    const res = await fetch(`${getUrl()}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '../../escaped-agent' }),
    });
    const body = await res.json();

    // Either the route rejects the name, or at minimum the directory
    // must NOT be created outside agentsDir
    const escapedPath = join(tempDir, 'escaped-agent');
    expect(existsSync(escapedPath)).toBe(false);

    // If it did create something, it must be inside agentsDir
    if (body.id) {
      expect(existsSync(join(agentsDir, body.id))).toBe(true);
    }
  });
});
