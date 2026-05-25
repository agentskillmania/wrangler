/**
 * @fileoverview Integration test configuration for wrangler-devtool
 *
 * Reuses the same .env variables as wrangler integration tests:
 * - ENABLE_INTEGRATION_TESTS=true to enable
 * - OPENAI_API_KEY for the LLM provider
 * - OPENAI_BASE_URL (optional) for custom endpoints
 * - PROVIDER (optional, default: 'openai')
 * - MODEL (optional, default: 'gpt-3.5-turbo')
 */

import type { ILLMProvider } from '@agentskillmania/colts';
import { createLLMClient } from '../../src/llm.js';

export interface TestConfig {
  apiKey: string;
  baseUrl?: string;
  provider: string;
  testModel: string;
  enabled: boolean;
  llmClient?: ILLMProvider;
}

function loadConfig(): TestConfig {
  const enabled = process.env.ENABLE_INTEGRATION_TESTS === 'true';

  const apiKey = process.env.OPENAI_API_KEY || '';
  const baseUrl = process.env.OPENAI_BASE_URL;
  const provider = process.env.PROVIDER || 'openai';
  const testModel = process.env.MODEL || 'gpt-3.5-turbo';

  if (enabled && !apiKey) {
    console.warn(
      '[wrangler-devtool Integration Tests] Warning: ENABLE_INTEGRATION_TESTS is true but OPENAI_API_KEY is not set.'
    );
  }

  let llmClient: ILLMProvider | undefined;
  if (enabled && apiKey) {
    llmClient = createLLMClient({
      provider,
      apiKey,
      model: testModel,
      baseUrl,
    });
  }

  return {
    apiKey,
    baseUrl,
    provider,
    testModel,
    enabled,
    llmClient,
  };
}

export const testConfig: TestConfig = loadConfig();

/** Run test only when condition is true, skip otherwise */
export const itif = (condition: boolean) => (condition ? it : it.skip);
