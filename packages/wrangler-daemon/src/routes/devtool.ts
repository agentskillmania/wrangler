import { DevTool } from '@agentskillmania/wrangler-devtool';
import type { FileChange } from '@agentskillmania/wrangler-devtool';
import type { FastifyInstance } from 'fastify';

import type { ConfigManager } from '../core/config-manager.js';
import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Create a DevTool instance from daemon config.
 */
function createDevTool(configManager: ConfigManager): DevTool {
  const config = configManager.get();
  return new DevTool({ llm: config.llm });
}

/**
 * Devtool API routes — expose wrangler-devtool capabilities as HTTP endpoints.
 *
 * Each route handler creates a DevTool instance directly from daemon config.
 * No caching or lazy initialization.
 */
export async function devtoolRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const getConfig = () => decorated.configManager;

  /**
   * POST /api/devtool/agent/generate
   *
   * Generate or modify an agent definition using LLM.
   * Body: { prompt: string, existingContent?: string, model?: string }
   */
  fastify.post('/api/devtool/agent/generate', async (request, reply) => {
    const body = request.body as { prompt?: string; existingContent?: string; model?: string };
    if (!body.prompt) {
      return reply.code(400).send({ error: 'prompt is required' });
    }

    try {
      const devtool = createDevTool(getConfig());
      const options = body.model ? { model: body.model } : undefined;
      const result = await devtool.runAgentArchitect(body.prompt, body.existingContent, options);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });

  /**
   * POST /api/devtool/skill/generate
   *
   * Generate or modify a skill definition using LLM.
   * Body: { prompt: string, existingContent?: string, model?: string }
   */
  fastify.post('/api/devtool/skill/generate', async (request, reply) => {
    const body = request.body as { prompt?: string; existingContent?: string; model?: string };
    if (!body.prompt) {
      return reply.code(400).send({ error: 'prompt is required' });
    }

    try {
      const devtool = createDevTool(getConfig());
      const options = body.model ? { model: body.model } : undefined;
      const result = await devtool.runSkillDesigner(body.prompt, body.existingContent, options);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });

  /**
   * POST /api/devtool/crew/generate
   *
   * Generate or modify a crew definition using LLM.
   * Body: { prompt: string, existingContent?: string, model?: string }
   */
  fastify.post('/api/devtool/crew/generate', async (request, reply) => {
    const body = request.body as { prompt?: string; existingContent?: string; model?: string };
    if (!body.prompt) {
      return reply.code(400).send({ error: 'prompt is required' });
    }

    try {
      const devtool = createDevTool(getConfig());
      const options = body.model ? { model: body.model } : undefined;
      const result = await devtool.runCrewComposer(body.prompt, body.existingContent, options);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });

  /**
   * POST /api/devtool/review
   *
   * Review an agent, skill, or crew definition.
   * Body: { targetPath: string, content: string, prompt?: string, model?: string }
   */
  fastify.post('/api/devtool/review', async (request, reply) => {
    const body = request.body as {
      targetPath?: string;
      content?: string;
      prompt?: string;
      model?: string;
    };
    if (!body.targetPath || !body.content) {
      return reply.code(400).send({ error: 'targetPath and content are required' });
    }

    try {
      const devtool = createDevTool(getConfig());
      const options = body.model ? { model: body.model } : undefined;
      const result = await devtool.runReviewer(body.targetPath, body.content, body.prompt, options);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });

  /**
   * POST /api/devtool/workspace/init
   *
   * Initialize a new wrangler project.
   * Body: { path: string, type: 'agent' | 'crew', noGit?: boolean }
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
      const devtool = createDevTool(getConfig());
      await devtool.initProject(body.path, {
        type: body.type as 'agent' | 'crew',
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
      const devtool = createDevTool(getConfig());
      const filePath = await devtool.createTemplate(
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
      const devtool = createDevTool(getConfig());
      const options: Record<string, unknown> = {};
      if (body.cwd) options.cwd = body.cwd;
      if (body.dryRun) options.dryRun = body.dryRun;
      const result = await devtool.applyChanges(
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
      const devtool = createDevTool(getConfig());
      const options: Record<string, unknown> = {};
      if (body.case) options.case = body.case;
      if (body.hardOnly) options.hardOnly = body.hardOnly;
      const result = await devtool.runTests(body.targetPath, options);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });
}
