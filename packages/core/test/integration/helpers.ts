/**
 * Integration test helpers for wrangler
 */

import { LLMClient } from '@agentskillmania/llm-client';
import { testConfig } from './config.js';

/**
 * Create a real LLM client configured for integration tests.
 */
export function createRealLLMClient(): LLMClient {
  const client = new LLMClient({
    baseUrl: testConfig.baseUrl,
  });

  if (testConfig.enabled) {
    client.registerProvider({
      name: testConfig.provider,
      maxConcurrency: 5,
    });

    client.registerApiKey({
      key: testConfig.apiKey,
      provider: testConfig.provider,
      maxConcurrency: 3,
      models: [
        {
          modelId: testConfig.testModel,
          maxConcurrency: 2,
        },
      ],
    });
  }

  return client;
}
