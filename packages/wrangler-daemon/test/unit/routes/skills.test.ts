/**
 * @fileoverview Unit tests for skill CRUD routes
 *
 * Tests the /api/skills endpoints:
 * - GET /api/skills — list all skills
 * - GET /api/skills/:id — get skill detail
 * - POST /api/skills — create skill
 * - DELETE /api/skills/:id — delete skill
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { skillRoutes } from '../../../src/routes/skills.js';

describe('Unit: Skill CRUD Routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let skillsDir: string;
  let manager: ResourceManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-skill-routes-'));
    const agentsDir = join(tempDir, 'agents');
    skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    fastify = Fastify();
    fastify.decorate('resourceManager', manager);
    fastify.register(skillRoutes);
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

  // Test 1: GET /api/skills returns empty list when no skills
  it('GET /api/skills returns empty list when no skills', async () => {
    const res = await fetch(`${getUrl()}/api/skills`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  // Test 2: GET /api/skills returns created skills
  it('GET /api/skills returns created skills', async () => {
    await manager.createSkill({ name: 'test-skill', description: 'A test skill.' });

    const res = await fetch(`${getUrl()}/api/skills`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: 'test-skill',
      name: 'test-skill',
    });
  });

  // Test 3: GET /api/skills/:id returns skill detail
  it('GET /api/skills/:id returns skill detail', async () => {
    await manager.createSkill({
      name: 'search',
      description: 'Web search skill',
    });

    const res = await fetch(`${getUrl()}/api/skills/search`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.id).toBe('search');
    expect(body.description).toBe('Web search skill');
    expect(body).toHaveProperty('path');
    expect(body).toHaveProperty('files');
  });

  // Test 4: GET /api/skills/:id returns error for non-existent skill
  it('GET /api/skills/:id returns error for non-existent skill', async () => {
    const res = await fetch(`${getUrl()}/api/skills/non-existent`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'Skill not found' });
  });

  // Test 5: POST /api/skills creates skill with name only
  it('POST /api/skills creates skill with name only', async () => {
    const res = await fetch(`${getUrl()}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new-skill' }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ id: 'new-skill' });

    // Verify skill directory exists
    expect(existsSync(join(skillsDir, 'new-skill'))).toBe(true);
    expect(existsSync(join(skillsDir, 'new-skill', 'SKILL.md'))).toBe(true);
  });

  // Test 6: POST /api/skills creates skill with name and description
  it('POST /api/skills creates skill with name and description', async () => {
    const res = await fetch(`${getUrl()}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'described-skill',
        description: 'A described skill.',
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ id: 'described-skill' });
  });

  // Test 7: POST /api/skills returns error when name missing
  it('POST /api/skills returns error when name missing', async () => {
    const res = await fetch(`${getUrl()}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'No name provided' }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'name is required' });
  });

  // Test 8: DELETE /api/skills/:id removes skill
  it('DELETE /api/skills/:id removes skill', async () => {
    // Create a skill first
    await fetch(`${getUrl()}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'delete-me', description: 'Bye' }),
    });

    expect(existsSync(join(skillsDir, 'delete-me'))).toBe(true);

    const delRes = await fetch(`${getUrl()}/api/skills/delete-me`, { method: 'DELETE' });
    expect(delRes.ok).toBe(true);
    const delBody = await delRes.json();
    expect(delBody).toEqual({ ok: true });

    expect(existsSync(join(skillsDir, 'delete-me'))).toBe(false);
  });

  // Test 9: DELETE /api/skills/:id is idempotent
  it('DELETE /api/skills/:id is idempotent', async () => {
    const res = await fetch(`${getUrl()}/api/skills/non-existent`, { method: 'DELETE' });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  // Test 10: POST /api/skills with traversal name must not escape skills dir
  it('POST /api/skills with traversal name must not escape skills dir', async () => {
    const res = await fetch(`${getUrl()}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '../../escaped-skill' }),
    });
    const body = await res.json();

    const escapedPath = join(tempDir, 'escaped-skill');
    expect(existsSync(escapedPath)).toBe(false);

    if (body.id) {
      expect(existsSync(join(skillsDir, body.id))).toBe(true);
    }
  });
});
