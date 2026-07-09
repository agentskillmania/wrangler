import { initProject, createTemplate, applyChanges, loadSuite, runEval, formatEvalReport, formatEvalJsonReport } from '@agentskillmania/wrangler-devtool';
import type { FileChange } from '@agentskillmania/wrangler-devtool';
import type { FastifyInstance } from 'fastify';

/**
 * Devtool API routes — expose wrangler-devtool capabilities as HTTP endpoints.
 *
 * Exposes scaffolding, file changes, and evaluation.
 * AI generation/review was removed when devtool's agents module was dropped;
 * upper-layer applications should use AgentSession + load_skill instead.
 */
export async function devtoolRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/devtool/project/init
   *
   * Initialize a new wrangler project.
   * Body: { projectDir: string, type: 'agent' | 'crew' | 'skill', noGit?: boolean }
   */
  fastify.post('/api/devtool/project/init', async (request, reply) => {
    const body = request.body as { projectDir?: string; type?: string; noGit?: boolean };
    if (!body.projectDir || !body.type) {
      return reply.code(400).send({ error: 'projectDir and type are required' });
    }

    const validTypes = ['agent', 'crew', 'skill'];
    if (!validTypes.includes(body.type)) {
      return reply.code(400).send({ error: 'type must be agent, crew, or skill' });
    }

    try {
      await initProject(body.projectDir, {
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
   * Body: { type: string, name: string, projectDir: string }
   */
  fastify.post('/api/devtool/template', async (request, reply) => {
    const body = request.body as { type?: string; name?: string; projectDir?: string };
    if (!body.type || !body.name || !body.projectDir) {
      return reply.code(400).send({ error: 'type, name, and projectDir are required' });
    }

    const validTypes = ['agent', 'skill', 'crew', 'session'];
    if (!validTypes.includes(body.type)) {
      return reply.code(400).send({ error: 'type must be agent, skill, crew, or session' });
    }

    try {
      const filePath = await createTemplate(
        body.type as 'agent' | 'skill' | 'crew' | 'session',
        body.name,
        body.projectDir
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
   * Body: { changes: FileChange[], projectDir?: string, dryRun?: boolean }
   */
  fastify.post('/api/devtool/changes/apply', async (request, reply) => {
    const body = request.body as {
      changes?: unknown[];
      projectDir?: string;
      dryRun?: boolean;
    };
    if (!body.changes || !Array.isArray(body.changes) || body.changes.length === 0) {
      return reply.code(400).send({ error: 'changes array is required' });
    }

    try {
      const options: Record<string, unknown> = {};
      if (body.projectDir) options.cwd = body.projectDir;
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
   * POST /api/devtool/eval/run
   *
   * Run an evaluation suite against an agent or skill.
   * Body: { suitePath: string, runs?: number, outputDir?: string, reporter?: 'console'|'json' }
   */
  fastify.post('/api/devtool/eval/run', async (request, reply) => {
    const body = request.body as {
      suitePath?: string;
      runs?: number;
      outputDir?: string;
      reporter?: string;
    };
    if (!body.suitePath) {
      return reply.code(400).send({ error: 'suitePath is required' });
    }

    try {
      const suite = await loadSuite(body.suitePath);
      const { report, outputDir } = await runEval(suite, {
        runs: body.runs,
        outputDir: body.outputDir,
        projectDir: body.suitePath,
      });

      const reporter = body.reporter ?? 'json';
      if (reporter === 'console') {
        return { output: formatEvalReport(report), outputDir, report };
      }
      return { output: formatEvalJsonReport(report), outputDir, report };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });
}
