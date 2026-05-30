import type { FastifyInstance } from 'fastify';

import type { DecoratedFastifyInstance } from '../types.js';

/**
 * Register model metadata routes.
 *
 * Provides endpoints for querying registered model metadata
 * (contextWindow, maxTokens, reasoning) from YAML config and active sessions.
 */
export async function modelRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const configManager = () => decorated.configManager;
  const sessionManager = () => decorated.sessionManager;

  /**
   * GET /api/models/:modelId/metadata
   *
   * Returns metadata for a registered model.
   * Checks active sessions first (rich data from LLMClient registry),
   * then falls back to YAML config metadata.
   */
  fastify.get('/api/models/:modelId/metadata', async (request, reply) => {
    const { modelId } = request.params as { modelId: string };

    // Strategy 1: Check active sessions for LLMClient-registered metadata
    for (const [, agentSession] of sessionManager().getAllAgentSessions()) {
      const meta = agentSession.llmClient.getModelMeta(modelId);
      if (meta) {
        return {
          modelId,
          contextWindow: meta.contextWindow,
          maxTokens: meta.maxTokens,
          reasoning: meta.reasoning,
        };
      }
    }

    // Strategy 2: Fall back to YAML config metadata for the configured model
    const config = configManager().get();
    if (config.llm.model === modelId) {
      return {
        modelId,
        contextWindow: config.llm.contextWindow ?? 0,
        maxTokens: config.llm.maxTokens ?? 0,
        reasoning: config.llm.reasoning ?? false,
      };
    }

    reply.code(404).send({ error: `Model '${modelId}' not found` });
  });
}
