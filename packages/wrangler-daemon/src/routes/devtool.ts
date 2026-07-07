import { initProject, createTemplate, applyChanges, runTests } from '@agentskillmania/wrangler-devtool';
import type { FileChange } from '@agentskillmania/wrangler-devtool';
import type { FastifyInstance } from 'fastify';

import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Devtool API routes — expose wrangler-devtool capabilities as HTTP endpoints.
 *
 * Only non-AI operations are exposed here (scaffolding, file changes, tests).
 * AI generation/review was removed when devtool's agents module was dropped;
 * upper-layer applications should use AgentSession + load_skill instead.
 */
export async function devtoolRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  void decorated; // configManager no longer needed without the DevTool facade

  /**
   * POST /api/devtool/workspace/init
   *
   * Initialize a new wrangler project.
   * Body: { path: string, type: 'agent' | 'crew' | 'skill', noGit?: boolean }
   */
  fastify.post('/api/devtool/workspace/init', async (request, reply) => {
    const body = request.body as { path?: string; type?: string; noGit?: boolean };
    if (!body.path || !body.type) {
      return reply.code(400).send({ error: 'path and type are required' });
    }

    const validTypes = ['agent', 'crew', 'skill'];
    if (!validTypes.includes(body.type)) {
      return reply.code(400).send({ error: 'type must be agent, crew, or skill' });
    }

    try {
      await initProject(body.path, {
        type: body.type as 'agent' | 'crew' | 'skill',
        noGit: body.noGit,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });

  /**
   * POST /api/devtool/template
   *
   * Create a new template file (agent, skill, crew, or session).
   * Body: { type: string, name: string, cwd: string }
   */
  fastify.post('/api/devtool/template', async (request, reply) => {
    const body = request.body as { type?: string; name?: string; cwd?: string };
    if (!body.type || !body.name || !body.cwd) {
      return reply.code(400).send({ error: 'type, name, and cwd are required' });
    }

    const validTypes = ['agent', 'skill', 'crew', 'session'];
    if (!validTypes.includes(body.type)) {
      return reply.code(400).send({ error: 'type must be agent, skill, crew, or session' });
    }

    try {
      const filePath = await createTemplate(
        body.type as 'agent' | 'skill' | 'crew' | 'session',
        body.name,
        body.cwd
      );
      return { filePath };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });

  /**
   * POST /api/devtool/changes/apply
   *
   * Apply structured file changes to disk.
   * Body: { changes: FileChange[], cwd?: string, dryRun?: boolean }
   */
  fastify.post('/api/devtool/changes/apply', async (request, reply) => {
    const body = request.body as {
      changes?: unknown[];
      cwd?: string;
      dryRun?: boolean;
    };
    if (!body.changes || !Array.isArray(body.changes) || body.changes.length === 0) {
      return reply.code(400).send({ error: 'changes array is required' });
    }

    try {
      const options: Record<string, unknown> = {};
      if (body.cwd) options.cwd = body.cwd;
      if (body.dryRun) options.dryRun = body.dryRun;
      const result = await applyChanges(
        body.changes as FileChange[],
        Object.keys(options).length > 0 ? options : undefined
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });

  /**
   * POST /api/devtool/test/run
   *
   * Run test cases against agent or crew definitions.
   * Body: { targetPath: string, case?: string, hardOnly?: boolean }
   */
  fastify.post('/api/devtool/test/run', async (request, reply) => {
    const body = request.body as { targetPath?: string; case?: string; hardOnly?: boolean };
    if (!body.targetPath) {
      return reply.code(400).send({ error: 'targetPath is required' });
    }

    try {
      const options: Record<string, unknown> = {};
      if (body.case) options.case = body.case;
      if (body.hardOnly) options.hardOnly = body.hardOnly;
      const result = await runTests(body.targetPath, options);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });
}
