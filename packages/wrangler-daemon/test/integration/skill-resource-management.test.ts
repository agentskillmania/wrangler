/**
 * @fileoverview User Story: Skill Resource Management (Integration)
 *
 * As a developer
 * I want to manage skill resources (list, get detail, create, delete)
 * So that I can organize skills on disk
 *
 * Acceptance Criteria:
 * 1. GET /api/skills returns list of skills
 * 2. GET /api/skills/:id returns SkillDetail with file listing
 * 3. POST /api/skills creates a skill directory with SKILL.md
 * 4. DELETE /api/skills/:id removes the skill directory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ResourceManager } from '../../src/core/resource-manager.js';
import { skillRoutes } from '../../src/routes/skills.js';

describe('Integration: Skill Resource Management', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-skill-res-'));
    skillsDir = join(tempDir, 'skills');
    const manager = new ResourceManager(join(tempDir, 'agents'), skillsDir, join(tempDir, 'crews'));
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

  // ─── AC 3: Create skill → then verify on disk ──────────────

  it('creates skill via API and verifies SKILL.md on disk', async () => {
    const res = await fetch(`${getUrl()}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'code-review',
        description: 'Reviews code for quality',
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.id).toBe('code-review');

    // Verify SKILL.md exists on disk with correct frontmatter
    const skillMdPath = join(skillsDir, 'code-review', 'SKILL.md');
    expect(existsSync(skillMdPath)).toBe(true);
    const content = await readFile(skillMdPath, 'utf-8');
    expect(content).toContain('name: code-review');
    expect(content).toContain('description: Reviews code for quality');
  });

  // ─── AC 1: List skills after creating ──────────────────────

  it('lists skills with names parsed from SKILL.md frontmatter', async () => {
    // Create two skills
    await fetch(`${getUrl()}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'alpha', description: 'Skill alpha' }),
    });
    await fetch(`${getUrl()}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'beta', description: 'Skill beta' }),
    });

    const res = await fetch(`${getUrl()}/api/skills`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveLength(2);
    const names = body.map((s: { name: string }) => s.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  // ─── AC 2: Get skill detail with file listing ──────────────

  it('returns SkillDetail with files array for existing skill', async () => {
    // Create skill first
    await fetch(`${getUrl()}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'detail-skill',
        description: 'Detail test skill',
      }),
    });

    const res = await fetch(`${getUrl()}/api/skills/detail-skill`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.name).toBe('detail-skill');
    expect(body.description).toBe('Detail test skill');
    expect(body).toHaveProperty('path');
    expect(body).toHaveProperty('files');
    expect(Array.isArray(body.files)).toBe(true);

    // SKILL.md should appear in the file listing
    const fileNames = body.files.map((f: { name: string }) => f.name);
    expect(fileNames).toContain('SKILL.md');
  });

  it('returns error for non-existent skill', async () => {
    const res = await fetch(`${getUrl()}/api/skills/ghost`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.error).toBe('Skill not found');
  });

  // ─── AC 4: Delete skill ────────────────────────────────────

  it('deletes skill and removes directory from disk', async () => {
    await fetch(`${getUrl()}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'doomed', description: 'Will be deleted' }),
    });

    // Verify directory exists
    expect(existsSync(join(skillsDir, 'doomed'))).toBe(true);

    const delRes = await fetch(`${getUrl()}/api/skills/doomed`, { method: 'DELETE' });
    expect(delRes.ok).toBe(true);

    // Verify directory removed from disk
    expect(existsSync(join(skillsDir, 'doomed'))).toBe(false);

    // Verify skill no longer in list
    const listRes = await fetch(`${getUrl()}/api/skills`);
    const body = await listRes.json();
    expect(body).toHaveLength(0);
  });

  // ─── Full lifecycle ────────────────────────────────────────

  it('full lifecycle: create → list → detail → delete', async () => {
    const url = getUrl();

    // 1. Create
    const createRes = await fetch(`${url}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'lifecycle',
        description: 'Lifecycle test skill',
      }),
    });
    expect(createRes.ok).toBe(true);

    // 2. List contains the skill
    const listRes = await fetch(`${url}/api/skills`);
    const listBody = await listRes.json();
    expect(listBody).toHaveLength(1);
    expect(listBody[0].name).toBe('lifecycle');

    // 3. Get detail
    const detailRes = await fetch(`${url}/api/skills/lifecycle`);
    expect(detailRes.ok).toBe(true);
    const detail = await detailRes.json();
    expect(detail.name).toBe('lifecycle');
    expect(detail.description).toBe('Lifecycle test skill');
    expect(detail.files.length).toBeGreaterThanOrEqual(1);

    // 4. Delete
    await fetch(`${url}/api/skills/lifecycle`, { method: 'DELETE' });

    // 5. List is empty
    const finalRes = await fetch(`${url}/api/skills`);
    const finalBody = await finalRes.json();
    expect(finalBody).toHaveLength(0);
  });
});
