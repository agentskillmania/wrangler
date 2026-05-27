import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { SpecStore } from '@agentskillmania/wrangler';
import { specRoutes } from '../../../src/routes/specs.js';

let sessionsDir: string;

vi.mock('../../../src/constants.js', () => ({
  get SESSIONS_DIR() {
    return sessionsDir;
  },
}));

describe('Spec API Routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let workspacePath: string;
  let specStore: SpecStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-spec-test-'));
    sessionsDir = join(tempDir, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    workspacePath = join(tempDir, 'workspace');
    specStore = new SpecStore(sessionsDir, workspacePath);

    fastify = Fastify();
    fastify.register(specRoutes);
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
  });
});
