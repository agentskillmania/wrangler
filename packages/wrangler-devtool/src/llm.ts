// packages/wrangler-devtool/src/llm.ts
// LLM client setup — thin wrapper around @agentskillmania/llm-client

import { LLMClient } from '@agentskillmania/llm-client';

import type { LLMConfig } from './config.js';

/**
 * Create a new LLMClient from configuration.
 */
export function createLLMClient(config: LLMConfig): LLMClient {
  const client = new LLMClient(config.baseUrl ? { baseUrl: config.baseUrl } : undefined);
  const concurrency = config.maxConcurrency ?? 5;
  client.registerProvider({ name: config.provider, maxConcurrency: concurrency });
  client.registerApiKey({
    key: config.apiKey,
    provider: config.provider,
    maxConcurrency: concurrency,
    models: [{ modelId: config.model, maxConcurrency: concurrency }],
  });
  return client;
}
