/**
 * @fileoverview User Story: Agent Resource Management (Integration)
 *
 * As a developer
 * I want to manage agent resources (list, get detail, create, delete)
 * So that I can organize my agents on disk
 *
 * Acceptance Criteria:
 * 1. GET /api/agents returns list parsed from AGENT.md frontmatter
 * 2. GET /api/agents/:id returns AgentDetail with full parsed content
 * 3. POST /api/agents creates agent directory with valid AGENT.md
 * 4. DELETE /api/agents/:id removes the agent directory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { agentRoutes } from '../../src/routes/agents.js';

describe('Integration: Agent Resource Management', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-agent-res-'));
    agentsDir = join(tempDir, 'agents');
    const manager = new ResourceManager(agentsDir, join(tempDir, 'skills'), join(tempDir, 'crews'));
    await manager.init();

    fastify = Fastify();
    fastify.decorate('resourceManager', manager);
    fastify.register(agentRoutes);
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

  // ─── AC 3: Create agent → then verify on disk ──────────────

  it('creates agent via API and verifies AGENT.md on disk', async () => {
    const res = await fetch(`${getUrl()}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'review-bot',
        instructions: 'You review code.',
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.id).toBe('review-bot');

    // Verify AGENT.md exists on disk with correct frontmatter
    const agentMdPath = join(agentsDir, 'review-bot', 'AGENT.md');
    expect(existsSync(agentMdPath)).toBe(true);
    const content = await readFile(agentMdPath, 'utf-8');
    expect(content).toContain('name: review-bot');
    expect(content).toContain('You review code.');
  });

  // ─── AC 1: List agents after creating ──────────────────────

  it('lists agents with names parsed from AGENT.md frontmatter', async () => {
    // Create two agents
    await fetch(`${getUrl()}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'alpha', instructions: 'Agent alpha' }),
    });
    await fetch(`${getUrl()}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'beta', instructions: 'Agent beta' }),
    });

    const res = await fetch(`${getUrl()}/api/agents`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveLength(2);
    const names = body.map((a: { name: string }) => a.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  // ─── AC 2: Get agent detail ────────────────────────────────

  it('returns AgentDetail with parsed instructions for existing agent', async () => {
    // Create agent first
    await fetch(`${getUrl()}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'detail-bot', instructions: 'Detail instructions here' }),
    });

    const res = await fetch(`${getUrl()}/api/agents/detail-bot`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.name).toBe('detail-bot');
    expect(body.instructions).toContain('Detail instructions here');
    expect(body).toHaveProperty('path');
    expect(body).toHaveProperty('skillDirs');
    expect(body).toHaveProperty('mcpPaths');
    expect(body).toHaveProperty('skillCount');
  });

  it('returns error for non-existent agent', async () => {
    const res = await fetch(`${getUrl()}/api/agents/ghost`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.error).toBe('Agent not found');
  });

  // ─── AC 4: Delete agent ────────────────────────────────────

  it('deletes agent and removes directory from disk', async () => {
    await fetch(`${getUrl()}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'doomed', instructions: 'Will be deleted' }),
    });

    // Verify directory exists
    expect(existsSync(join(agentsDir, 'doomed'))).toBe(true);

    const delRes = await fetch(`${getUrl()}/api/agents/doomed`, { method: 'DELETE' });
    expect(delRes.ok).toBe(true);

    // Verify directory removed from disk
    expect(existsSync(join(agentsDir, 'doomed'))).toBe(false);

    // Verify agent no longer in list
    const listRes = await fetch(`${getUrl()}/api/agents`);
    const body = await listRes.json();
    expect(body).toHaveLength(0);
  });

  // ─── Full lifecycle ────────────────────────────────────────

  it('full lifecycle: create → list → get detail → delete', async () => {
    const url = getUrl();

    // 1. Create
    const createRes = await fetch(`${url}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'lifecycle', instructions: 'Lifecycle test' }),
    });
    expect(createRes.ok).toBe(true);

    // 2. List contains the agent
    const listRes = await fetch(`${url}/api/agents`);
    const listBody = await listRes.json();
    expect(listBody).toHaveLength(1);
    expect(listBody[0].name).toBe('lifecycle');

    // 3. Get detail
    const detailRes = await fetch(`${url}/api/agents/lifecycle`);
    expect(detailRes.ok).toBe(true);
    const detail = await detailRes.json();
    expect(detail.instructions).toContain('Lifecycle test');

    // 4. Delete
    await fetch(`${url}/api/agents/lifecycle`, { method: 'DELETE' });

    // 5. List is empty
    const finalRes = await fetch(`${url}/api/agents`);
    const finalBody = await finalRes.json();
    expect(finalBody).toHaveLength(0);
  });
});
