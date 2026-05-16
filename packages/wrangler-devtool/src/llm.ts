// packages/wrangler-devtool/src/llm.ts
// LLM client setup — thin wrapper around @agentskillmania/llm-client

import { LLMClient } from '@agentskillmania/llm-client';
import type { LLMConfig } from './config.js';

let sharedClient: LLMClient | null = null;

/**
 * Create a new LLMClient from configuration.
 */
export function createLLMClient(config: LLMConfig): LLMClient {
  const client = new LLMClient(config.baseUrl ? { baseUrl: config.baseUrl } : undefined);
  client.registerProvider({ name: config.provider, maxConcurrency: 10 });
  client.registerApiKey({
    key: config.apiKey,
    provider: config.provider,
    maxConcurrency: 5,
    models: [{ modelId: config.model, maxConcurrency: 3 }],
  });
  return client;
}

/**
 * Get or create the shared LLMClient.
 */
export function getLLMClient(config: LLMConfig): LLMClient {
  if (!sharedClient) {
    sharedClient = createLLMClient(config);
  }
  return sharedClient;
}

/**
 * Reset the shared client (useful for testing).
 */
export function resetLLMClient(): void {
  sharedClient = null;
}
