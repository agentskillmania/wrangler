import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SpecStore } from '@agentskillmania/wrangler';
import { specRoutes } from '../../../src/routes/specs.js';

let specPlanDir: string;

vi.mock('../../../src/constants.js', () => ({
  get SPEC_PLAN_DIR() {
    return specPlanDir;
  },
}));

describe('Spec API Routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let workspacePath: string;
  let specStore: SpecStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-spec-test-'));
    specPlanDir = join(tempDir, 'spec-plan');
    await mkdir(specPlanDir, { recursive: true });
    workspacePath = join(tempDir, 'workspace');
    specStore = new SpecStore(join(specPlanDir, 'specs'));

    fastify = Fastify();
    await fastify.register(specRoutes);
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

  describe('GET /api/specs', () => {
    it('returns empty list when no specs', async () => {
      const res = await fetch(
        `${getUrl()}/api/specs?workspacePath=${encodeURIComponent(workspacePath)}`
      );

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.specs).toEqual([]);
    });

    it('returns error "workspacePath query param is required" when missing', async () => {
      const res = await fetch(`${getUrl()}/api/specs`);

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('workspacePath query param is required');
    });

    it('returns created specs with metadata', async () => {
      const now = new Date().toISOString();
      await specStore.save({
        meta: {
          name: 'test-spec',
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: now,
          updatedAt: now,
        },
        body: 'Test spec body',
      });

      const res = await fetch(
        `${getUrl()}/api/specs?workspacePath=${encodeURIComponent(workspacePath)}`
      );

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.specs).toHaveLength(1);
      expect(body.specs[0]).toMatchObject({
        id: 'test-spec-v1',
        name: 'test-spec',
        version: 1,
        status: 'draft',
      });
      expect(body.specs[0].createdAt).toBeDefined();
      expect(body.specs[0].updatedAt).toBeDefined();
    });
  });

  describe('GET /api/specs/:name/:version', () => {
    it('returns spec detail with meta and body', async () => {
      const now = new Date().toISOString();
      await specStore.save({
        meta: {
          name: 'test-spec',
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: now,
          updatedAt: now,
        },
        body: 'Test spec body',
      });

      const res = await fetch(
        `${getUrl()}/api/specs/test-spec/1?workspacePath=${encodeURIComponent(workspacePath)}`
      );

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.meta).toMatchObject({
        name: 'test-spec',
        version: 1,
        status: 'draft',
      });
      expect(body.body).toBe('Test spec body');
    });

    it('returns error when workspacePath missing', async () => {
      const res = await fetch(`${getUrl()}/api/specs/test-spec/1`);

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('workspacePath query param is required');
    });

    it('returns error "Spec not found" for non-existent', async () => {
      const res = await fetch(
        `${getUrl()}/api/specs/nonexistent/1?workspacePath=${encodeURIComponent(workspacePath)}`
      );

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Spec not found');
    });
  });

  describe('POST /api/specs', () => {
    it('creates spec with version 1 and status "draft"', async () => {
      const res = await fetch(`${getUrl()}/api/specs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath,
          name: 'new-spec',
          body: 'New spec content',
        }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body).toMatchObject({
        ok: true,
        name: 'new-spec',
        version: 1,
      });

      const spec = await specStore.get('new-spec', 1);
      expect(spec).not.toBeNull();
      expect(spec!.meta.status).toBe('draft');
      expect(spec!.body).toBe('New spec content');
    });

    it('returns error when workspacePath or name missing', async () => {
      const res = await fetch(`${getUrl()}/api/specs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'content' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('workspacePath and name are required');
    });

    it('creates spec with empty body when body omitted', async () => {
      const res = await fetch(`${getUrl()}/api/specs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, name: 'minimal-spec' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, name: 'minimal-spec', version: 1 });

      const spec = await specStore.get('minimal-spec', 1);
      expect(spec).not.toBeNull();
      expect(spec!.body).toBe('');
    });
  });

  describe('PUT /api/specs/:name/:version', () => {
    it('updates spec body', async () => {
      const now = new Date().toISOString();
      await specStore.save({
        meta: {
          name: 'test-spec',
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: now,
          updatedAt: now,
        },
        body: 'Original body',
      });

      const res = await fetch(`${getUrl()}/api/specs/test-spec/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, body: 'Updated body' }),
      });

      expect(res.ok).toBe(true);
      expect(await res.json()).toEqual({ ok: true });

      const spec = await specStore.get('test-spec', 1);
      expect(spec!.body).toBe('Updated body');
      expect(new Date(spec!.meta.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(now).getTime()
      );
    });

    it('returns error when workspacePath or body missing', async () => {
      const res = await fetch(`${getUrl()}/api/specs/test-spec/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('workspacePath and body are required');
    });

    it('returns error when spec not found', async () => {
      const res = await fetch(`${getUrl()}/api/specs/missing/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, body: 'x' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Spec not found');
    });
  });

  describe('PATCH /api/specs/:name/:version/status', () => {
    it('updates status from draft to approved', async () => {
      const now = new Date().toISOString();
      await specStore.save({
        meta: {
          name: 'test-spec',
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: now,
          updatedAt: now,
        },
        body: 'Test body',
      });

      const res = await fetch(`${getUrl()}/api/specs/test-spec/1/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath,
          status: 'approved',
        }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true });

      const spec = await specStore.get('test-spec', 1);
      expect(spec!.meta.status).toBe('approved');
    });

    it('returns error when workspacePath or status missing', async () => {
      const res = await fetch(`${getUrl()}/api/specs/test-spec/1/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('workspacePath and status are required');
    });

    it('returns error when updateStatus throws', async () => {
      const now = new Date().toISOString();
      await specStore.save({
        meta: {
          name: 'test-spec',
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: now,
          updatedAt: now,
        },
        body: 'Test body',
      });

      const res = await fetch(`${getUrl()}/api/specs/test-spec/1/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, status: 'superseded' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toContain('Invalid status transition');
    });
  });
});
