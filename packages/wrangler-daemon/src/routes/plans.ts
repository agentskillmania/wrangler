import { join } from 'node:path';

import { PlanStore, defaultNodeHostEnv } from '@agentskillmania/wrangler';
import type { PlanStatus } from '@agentskillmania/wrangler';
import type { FastifyInstance } from 'fastify';

import { SPEC_PLAN_DIR } from '../constants.js';

function getPlanStore(_workspacePath: string): PlanStore {
  // daemon is Node-only — inject the Node HostEnv explicitly (the library
  // store requires it and never defaults, so it stays browser-portable).
  return new PlanStore(join(SPEC_PLAN_DIR, 'plans'), defaultNodeHostEnv);
}

export async function planRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/plans?workspacePath=... */
  fastify.get('/api/plans', async (request) => {
    const query = request.query as { workspacePath?: string };
    if (!query.workspacePath) return { error: 'workspacePath query param is required' };
    const store = getPlanStore(query.workspacePath);
    const docs = await store.list();
    return {
      plans: docs.map((d) => ({
        id: `${d.meta.name}-v${d.meta.version}`,
        name: d.meta.name,
        specName: d.meta.specName,
        specVersion: d.meta.specVersion,
        version: d.meta.version,
        status: d.meta.status,
        createdAt: d.meta.createdAt,
        updatedAt: d.meta.updatedAt,
      })),
    };
  });

  /** GET /api/plans/:name/:specVersion/:version?workspacePath=... */
  fastify.get('/api/plans/:name/:specVersion/:version', async (request) => {
    const { name, specVersion, version } = request.params as {
      name: string;
      specVersion: string;
      version: string;
    };
    const query = request.query as { workspacePath?: string };
    if (!query.workspacePath) return { error: 'workspacePath query param is required' };
    const store = getPlanStore(query.workspacePath);
    const doc = await store.get(name, Number(specVersion), Number(version));
    if (!doc) return { error: 'Plan not found' };
    return { meta: doc.meta, body: doc.body };
  });

  /** POST /api/plans — body: { workspacePath, name, specName, specVersion?, body? } */
  fastify.post('/api/plans', async (request) => {
    const body = request.body as {
      workspacePath?: string;
      name?: string;
      specName?: string;
      specVersion?: number;
      body?: string;
    };
    if (!body.workspacePath || !body.name || !body.specName) {
      return { error: 'workspacePath, name, and specName are required' };
    }
    const store = getPlanStore(body.workspacePath);
    const now = new Date().toISOString();
    await store.save({
      meta: {
        name: body.name,
        specName: body.specName,
        specVersion: body.specVersion ?? 1,
        version: 1,
        status: 'draft',
        workspacePath: body.workspacePath,
        createdAt: now,
        updatedAt: now,
      },
      body: body.body ?? '',
    });
    return { ok: true, name: body.name, version: 1 };
  });

  /** PUT /api/plans/:name/:specVersion/:version — body: { workspacePath, body } */
  fastify.put('/api/plans/:name/:specVersion/:version', async (request) => {
    const { name, specVersion, version } = request.params as {
      name: string;
      specVersion: string;
      version: string;
    };
    const body = request.body as { workspacePath?: string; body?: string };
    if (!body.workspacePath || body.body === undefined) {
      return { error: 'workspacePath and body are required' };
    }
    const store = getPlanStore(body.workspacePath);
    const existing = await store.get(name, Number(specVersion), Number(version));
    if (!existing) return { error: 'Plan not found' };
    await store.save({
      meta: { ...existing.meta, updatedAt: new Date().toISOString() },
      body: body.body,
    });
    return { ok: true };
  });

  /** PATCH /api/plans/:name/:specVersion/:version/status — body: { workspacePath, status } */
  fastify.patch('/api/plans/:name/:specVersion/:version/status', async (request) => {
    const { name, specVersion, version } = request.params as {
      name: string;
      specVersion: string;
      version: string;
    };
    const body = request.body as { workspacePath?: string; status?: string };
    if (!body.workspacePath || !body.status) {
      return { error: 'workspacePath and status are required' };
    }
    const store = getPlanStore(body.workspacePath);
    try {
      await store.updateStatus(
        name,
        Number(specVersion),
        Number(version),
        body.status as PlanStatus
      );
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { error: message };
    }
  });
}
