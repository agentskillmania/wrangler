/**
 * @fileoverview Unit tests for crew CRUD routes
 *
 * Tests the /api/crews endpoints:
 * - GET /api/crews — list all crews
 * - GET /api/crews/:id — get crew detail
 * - POST /api/crews — create crew
 * - DELETE /api/crews/:id — delete crew
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { crewRoutes } from '../../../src/routes/crews.js';

describe('Unit: Crew CRUD Routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let crewsDir: string;
  let manager: ResourceManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-crew-routes-'));
    const agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    crewsDir = join(tempDir, 'crews');
    manager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await manager.init();

    fastify = Fastify();
    fastify.decorate('resourceManager', manager);
    fastify.register(crewRoutes);
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

  // Test 1: GET /api/crews returns empty list when no crews
  it('GET /api/crews returns empty list when no crews', async () => {
    const res = await fetch(`${getUrl()}/api/crews`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  // Test 2: GET /api/crews returns created crews with name/description/agentCount/skillCount
  it('GET /api/crews returns created crews with name/description/agentCount/skillCount', async () => {
    // Create a crew with agents and skills on disk
    const crewName = 'test-crew';
    const crewDir = join(crewsDir, crewName);
    await mkdir(crewDir, { recursive: true });
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---\nname: ${crewName}\ndescription: Test crew description\n---\n\n# Test Crew\n`,
      'utf-8'
    );

    // Create agents directory with some agent files
    const agentsDir = join(crewDir, 'agents');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, 'agent1.md'), '# Agent 1', 'utf-8');
    await writeFile(join(agentsDir, 'agent2.md'), '# Agent 2', 'utf-8');

    // Create skills directory with some skill directories
    const skillsDir = join(crewDir, 'skills');
    await mkdir(skillsDir, { recursive: true });
    await mkdir(join(skillsDir, 'skill1'), { recursive: true });
    await writeFile(join(skillsDir, 'skill1', 'SKILL.md'), '# Skill 1', 'utf-8');
    await mkdir(join(skillsDir, 'skill2'), { recursive: true });
    await writeFile(join(skillsDir, 'skill2', 'SKILL.md'), '# Skill 2', 'utf-8');

    const res = await fetch(`${getUrl()}/api/crews`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: crewName,
      name: crewName,
      description: 'Test crew description',
      agentCount: 0,
      skillCount: 2,
    });
    expect(body[0]).toHaveProperty('path');
  });

  // Test 3: GET /api/crews/:id returns crew detail with agents and skills lists
  it('GET /api/crews/:id returns crew detail with agents and skills lists', async () => {
    // Create a crew with agents and skills
    const crewName = 'detail-crew';
    const crewDir = join(crewsDir, crewName);
    await mkdir(crewDir, { recursive: true });
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---\nname: ${crewName}\ndescription: Detail test\nprimary-agent: agent1\n---\n\n# Detail Crew\n`,
      'utf-8'
    );

    // Create agents
    const agentsDir = join(crewDir, 'agents');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, 'agent1.md'), '# Agent 1', 'utf-8');
    await writeFile(join(agentsDir, 'agent2.md'), '# Agent 2', 'utf-8');

    // Create skills
    const skillsDir = join(crewDir, 'skills');
    await mkdir(skillsDir, { recursive: true });
    await mkdir(join(skillsDir, 'skill1'), { recursive: true });
    await writeFile(join(skillsDir, 'skill1', 'SKILL.md'), '# Skill 1', 'utf-8');

    const res = await fetch(`${getUrl()}/api/crews/${crewName}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toMatchObject({
      id: crewName,
      name: crewName,
      description: 'Detail test',
      primaryAgent: 'agent1',
    });
    expect(body).toHaveProperty('path');
    expect(body).toHaveProperty('crewMd');
    expect(body.agents).toHaveLength(2);
    expect(body.agents).toContainEqual({ name: 'agent1', fileName: 'agent1.md' });
    expect(body.agents).toContainEqual({ name: 'agent2', fileName: 'agent2.md' });
    expect(body.skills).toHaveLength(1);
    expect(body.skills).toContainEqual({ name: 'skill1', dirName: 'skill1' });
  });

  // Test 4: GET /api/crews/:id returns error "Crew not found" for non-existent crew
  it('GET /api/crews/:id returns error "Crew not found" for non-existent crew', async () => {
    const res = await fetch(`${getUrl()}/api/crews/non-existent`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'Crew not found' });
  });

  // Test 5: POST /api/crews creates crew with name only (minimal body)
  it('POST /api/crews creates crew with name only (minimal body)', async () => {
    const res = await fetch(`${getUrl()}/api/crews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'minimal-crew' }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ id: 'minimal-crew' });

    // Verify crew directory exists
    expect(existsSync(join(crewsDir, 'minimal-crew'))).toBe(true);
    expect(existsSync(join(crewsDir, 'minimal-crew', 'CREW.md'))).toBe(true);
  });

  // Test 6: POST /api/crews creates crew with all options
  it('POST /api/crews creates crew with all options (description + primaryAgent + instructions)', async () => {
    const res = await fetch(`${getUrl()}/api/crews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'full-crew',
        description: 'Full featured crew',
        primaryAgent: 'primary-agent',
        instructions: 'These are the crew instructions',
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ id: 'full-crew' });

    // Verify CREW.md content
    const detailRes = await fetch(`${getUrl()}/api/crews/full-crew`);
    const detail = await detailRes.json();
    expect(detail.name).toBe('full-crew');
    expect(detail.description).toBe('Full featured crew');
    expect(detail.primaryAgent).toBe('primary-agent');
    expect(detail.crewMd).toContain('These are the crew instructions');
  });

  // Test 7: POST /api/crews returns error "name is required" when name missing
  it('POST /api/crews returns error "name is required" when name missing', async () => {
    const res = await fetch(`${getUrl()}/api/crews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'No name provided' }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'name is required' });
  });

  // Test 8: DELETE /api/crews/:id removes crew directory from disk
  it('DELETE /api/crews/:id removes crew directory from disk', async () => {
    // Create a crew first
    await fetch(`${getUrl()}/api/crews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'delete-me' }),
    });

    // Verify directory exists
    expect(existsSync(join(crewsDir, 'delete-me'))).toBe(true);

    // Delete the crew
    const delRes = await fetch(`${getUrl()}/api/crews/delete-me`, { method: 'DELETE' });
    expect(delRes.ok).toBe(true);
    const delBody = await delRes.json();
    expect(delBody).toEqual({ ok: true });

    // Verify directory removed from disk
    expect(existsSync(join(crewsDir, 'delete-me'))).toBe(false);
  });

  // Test 9: DELETE /api/crews/:id is idempotent (doesn't error on non-existent crew)
  it('DELETE /api/crews/:id is idempotent (does not error on non-existent crew)', async () => {
    const res = await fetch(`${getUrl()}/api/crews/non-existent`, { method: 'DELETE' });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  // Test 10: POST /api/crews overwrites existing crew with same name
  it('POST /api/crews overwrites existing crew with same name', async () => {
    const url = getUrl();

    // Create a crew with initial description
    await fetch(`${url}/api/crews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'dup-crew',
        description: 'Original description',
      }),
    });

    // Overwrite with a different description
    const overwriteRes = await fetch(`${url}/api/crews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'dup-crew',
        description: 'Overwritten description',
      }),
    });
    expect(overwriteRes.ok).toBe(true);
    const overwriteBody = await overwriteRes.json();
    expect(overwriteBody).toEqual({ id: 'dup-crew' });

    // Verify the description was overwritten
    const detailRes = await fetch(`${url}/api/crews/dup-crew`);
    const detail = await detailRes.json();
    expect(detail.description).toBe('Overwritten description');
  });

  // Test 11: POST /api/crews creates crew after deleting previous with same name
  it('POST /api/crews creates crew after deleting previous with same name', async () => {
    const url = getUrl();

    // Create a crew
    await fetch(`${url}/api/crews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dup-crew', description: 'First version' }),
    });

    // Delete it
    await fetch(`${url}/api/crews/dup-crew`, { method: 'DELETE' });
    expect(existsSync(join(crewsDir, 'dup-crew'))).toBe(false);

    // Create again with same name
    const reCreateRes = await fetch(`${url}/api/crews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dup-crew', description: 'Second version' }),
    });
    expect(reCreateRes.ok).toBe(true);
    const reCreateBody = await reCreateRes.json();
    expect(reCreateBody).toEqual({ id: 'dup-crew' });

    // Verify it exists with the new description
    const detailRes = await fetch(`${url}/api/crews/dup-crew`);
    const detail = await detailRes.json();
    expect(detail.description).toBe('Second version');
  });

  // Test 12: POST /api/crews with traversal name must not escape crews dir
  it('POST /api/crews with traversal name must not escape crews dir', async () => {
    const res = await fetch(`${getUrl()}/api/crews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '../../escaped-crew' }),
    });
    const body = await res.json();

    const escapedPath = join(tempDir, 'escaped-crew');
    expect(existsSync(escapedPath)).toBe(false);

    if (body.id) {
      expect(existsSync(join(crewsDir, body.id))).toBe(true);
    }
  });

  // Test 13: Full lifecycle: create → list contains it → get detail → delete → list empty
  it('full lifecycle: create → list contains it → get detail → delete → list empty', async () => {
    const url = getUrl();

    // 1. Create
    const createRes = await fetch(`${url}/api/crews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'lifecycle-crew',
        description: 'Lifecycle test crew',
      }),
    });
    expect(createRes.ok).toBe(true);
    const createBody = await createRes.json();
    expect(createBody.id).toBe('lifecycle-crew');

    // 2. List contains the crew
    const listRes = await fetch(`${url}/api/crews`);
    const listBody = await listRes.json();
    expect(listBody).toHaveLength(1);
    expect(listBody[0]).toMatchObject({
      id: 'lifecycle-crew',
      name: 'lifecycle-crew',
      description: 'Lifecycle test crew',
    });

    // 3. Get detail
    const detailRes = await fetch(`${url}/api/crews/lifecycle-crew`);
    expect(detailRes.ok).toBe(true);
    const detail = await detailRes.json();
    expect(detail.name).toBe('lifecycle-crew');
    expect(detail.description).toBe('Lifecycle test crew');

    // 4. Delete
    const delRes = await fetch(`${url}/api/crews/lifecycle-crew`, { method: 'DELETE' });
    expect(delRes.ok).toBe(true);

    // 5. List is empty
    const finalRes = await fetch(`${url}/api/crews`);
    const finalBody = await finalRes.json();
    expect(finalBody).toEqual([]);
  });
});
