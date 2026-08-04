import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { PlanStore } from '@agentskillmania/wrangler';
import { planRoutes } from '../../../src/routes/plans.js';

let specPlanDir: string;

vi.mock('../../../src/constants.js', () => ({
  get SPEC_PLAN_DIR() {
    return specPlanDir;
  },
}));

describe('Plan API Routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let workspacePath: string;
  let planStore: PlanStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-plan-test-'));
    specPlanDir = join(tempDir, 'spec-plan');
    await mkdir(specPlanDir, { recursive: true });
    workspacePath = join(tempDir, 'workspace');
    planStore = new PlanStore(join(specPlanDir, 'plans'));

    fastify = Fastify();
    await fastify.register(planRoutes);
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

  describe('GET /api/plans', () => {
    it('returns empty list when no plans', async () => {
      const res = await fetch(
        `${getUrl()}/api/plans?workspacePath=${encodeURIComponent(workspacePath)}`
      );

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.plans).toEqual([]);
    });

    it('returns error when workspacePath missing', async () => {
      const res = await fetch(`${getUrl()}/api/plans`);

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('workspacePath query param is required');
    });

    it('returns created plans with metadata', async () => {
      const now = new Date().toISOString();
      await planStore.save({
        meta: {
          name: 'test-plan',
          specName: 'test-spec',
          specVersion: 1,
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: now,
          updatedAt: now,
        },
        body: 'Test plan body',
      });

      const res = await fetch(
        `${getUrl()}/api/plans?workspacePath=${encodeURIComponent(workspacePath)}`
      );

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.plans).toHaveLength(1);
      expect(body.plans[0]).toMatchObject({
        id: 'test-plan-v1',
        name: 'test-plan',
        specName: 'test-spec',
        specVersion: 1,
        version: 1,
        status: 'draft',
      });
      expect(body.plans[0].createdAt).toBeDefined();
      expect(body.plans[0].updatedAt).toBeDefined();
    });
  });

  describe('GET /api/plans/:name/:specVersion/:version', () => {
    it('returns plan detail', async () => {
      const now = new Date().toISOString();
      await planStore.save({
        meta: {
          name: 'test-plan',
          specName: 'test-spec',
          specVersion: 1,
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: now,
          updatedAt: now,
        },
        body: 'Test plan body',
      });

      const res = await fetch(
        `${getUrl()}/api/plans/test-plan/1/1?workspacePath=${encodeURIComponent(workspacePath)}`
      );

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.meta).toMatchObject({
        name: 'test-plan',
        specName: 'test-spec',
        specVersion: 1,
        version: 1,
        status: 'draft',
      });
      expect(body.body).toBe('Test plan body');
    });

    it('returns error when workspacePath missing', async () => {
      const res = await fetch(`${getUrl()}/api/plans/test-plan/1/1`);

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('workspacePath query param is required');
    });

    it('returns error "Plan not found" for non-existent', async () => {
      const res = await fetch(
        `${getUrl()}/api/plans/nonexistent/1/1?workspacePath=${encodeURIComponent(workspacePath)}`
      );

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Plan not found');
    });
  });

  describe('POST /api/plans', () => {
    it('creates plan with version 1', async () => {
      const res = await fetch(`${getUrl()}/api/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath,
          name: 'new-plan',
          specName: 'test-spec',
          specVersion: 1,
          body: 'New plan content',
        }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body).toMatchObject({
        ok: true,
        name: 'new-plan',
        version: 1,
      });

      const plan = await planStore.get('new-plan', 1, 1);
      expect(plan).not.toBeNull();
      expect(plan!.meta.specName).toBe('test-spec');
      expect(plan!.meta.specVersion).toBe(1);
      expect(plan!.body).toBe('New plan content');
    });

    it('returns error when required fields missing (workspacePath, name, specName)', async () => {
      const res = await fetch(`${getUrl()}/api/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'content' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('workspacePath, name, and specName are required');
    });

    it('creates plan with default specVersion and empty body when omitted', async () => {
      const res = await fetch(`${getUrl()}/api/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, name: 'minimal-plan', specName: 'test-spec' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, name: 'minimal-plan', version: 1 });

      const plan = await planStore.get('minimal-plan', 1, 1);
      expect(plan).not.toBeNull();
      expect(plan!.meta.specVersion).toBe(1);
      expect(plan!.body).toBe('');
    });
  });

  describe('PUT /api/plans/:name/:specVersion/:version', () => {
    it('updates plan body', async () => {
      const now = new Date().toISOString();
      await planStore.save({
        meta: {
          name: 'test-plan',
          specName: 'test-spec',
          specVersion: 1,
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: now,
          updatedAt: now,
        },
        body: 'Original body',
      });

      const res = await fetch(`${getUrl()}/api/plans/test-plan/1/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, body: 'Updated body' }),
      });

      expect(res.ok).toBe(true);
      expect(await res.json()).toEqual({ ok: true });

      const plan = await planStore.get('test-plan', 1, 1);
      expect(plan!.body).toBe('Updated body');
      expect(new Date(plan!.meta.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(now).getTime()
      );
    });

    it('returns error when workspacePath or body missing', async () => {
      const res = await fetch(`${getUrl()}/api/plans/test-plan/1/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('workspacePath and body are required');
    });

    it('returns error when plan not found', async () => {
      const res = await fetch(`${getUrl()}/api/plans/missing/1/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, body: 'x' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Plan not found');
    });
  });

  describe('PATCH /api/plans/:name/:specVersion/:version/status', () => {
    it('updates status from draft to approved', async () => {
      const now = new Date().toISOString();
      await planStore.save({
        meta: {
          name: 'test-plan',
          specName: 'test-spec',
          specVersion: 1,
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: now,
          updatedAt: now,
        },
        body: 'Test body',
      });

      const res = await fetch(`${getUrl()}/api/plans/test-plan/1/1/status`, {
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

      const plan = await planStore.get('test-plan', 1, 1);
      expect(plan!.meta.status).toBe('approved');
    });

    it('returns error when params missing', async () => {
      const res = await fetch(`${getUrl()}/api/plans/test-plan/1/1/status`, {
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
      await planStore.save({
        meta: {
          name: 'test-plan',
          specName: 'test-spec',
          specVersion: 1,
          version: 1,
          status: 'draft',
          workspacePath,
          createdAt: now,
          updatedAt: now,
        },
        body: 'Test body',
      });

      const res = await fetch(`${getUrl()}/api/plans/test-plan/1/1/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, status: 'executing' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toContain('Invalid status transition');
    });
  });
});
