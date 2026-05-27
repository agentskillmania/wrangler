import type { FastifyInstance } from 'fastify';
import { SpecStore } from '@agentskillmania/wrangler';
import type { SpecStatus } from '@agentskillmania/wrangler';
import { SESSIONS_DIR } from '../constants.js';

function getSpecStore(workspacePath: string): SpecStore {
  return new SpecStore(SESSIONS_DIR, workspacePath);
}

export async function specRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/specs?workspacePath=... */
  fastify.get('/api/specs', async (request) => {
    const query = request.query as { workspacePath?: string };
    if (!query.workspacePath) return { error: 'workspacePath query param is required' };
    const store = getSpecStore(query.workspacePath);
    const docs = await store.list();
    return {
      specs: docs.map((d) => ({
        id: `${d.meta.name}-v${d.meta.version}`,
        name: d.meta.name,
        version: d.meta.version,
        status: d.meta.status,
        createdAt: d.meta.createdAt,
        updatedAt: d.meta.updatedAt,
      })),
    };
  });

  /** GET /api/specs/:name/:version?workspacePath=... */
  fastify.get('/api/specs/:name/:version', async (request) => {
    const { name, version } = request.params as { name: string; version: string };
    const query = request.query as { workspacePath?: string };
    if (!query.workspacePath) return { error: 'workspacePath query param is required' };
    const store = getSpecStore(query.workspacePath);
    const doc = await store.get(name, Number(version));
    if (!doc) return { error: 'Spec not found' };
    return { meta: doc.meta, body: doc.body };
  });

  /** POST /api/specs — body: { workspacePath, name, body } */
  fastify.post('/api/specs', async (request) => {
    const body = request.body as { workspacePath?: string; name?: string; body?: string };
    if (!body.workspacePath || !body.name) {
      return { error: 'workspacePath and name are required' };
    }
    const store = getSpecStore(body.workspacePath);
    const now = new Date().toISOString();
    await store.save({
      meta: {
        name: body.name,
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

  /** PATCH /api/specs/:name/:version/status — body: { workspacePath, status } */
  fastify.patch('/api/specs/:name/:version/status', async (request) => {
    const { name, version } = request.params as { name: string; version: string };
    const body = request.body as { workspacePath?: string; status?: string };
    if (!body.workspacePath || !body.status) {
      return { error: 'workspacePath and status are required' };
    }
    const store = getSpecStore(body.workspacePath);
    try {
      await store.updateStatus(name, Number(version), body.status as SpecStatus);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { error: message };
    }
  });
}
