/**
 * Integration test configuration for wrangler-cli
 *
 * Reuses the same .env variables as wrangler integration tests:
 * - ENABLE_INTEGRATION_TESTS=true to enable
 * - OPENAI_API_KEY for the LLM provider
 * - OPENAI_BASE_URL (optional) for custom endpoints
 * - PROVIDER (optional, default: 'openai')
 * - MODEL (optional, default: 'gpt-3.5-turbo')
 */

import dotenv from 'dotenv';

// Load .env for integration tests only
dotenv.config({ path: '../../.env' });

export interface TestConfig {
  apiKey: string;
  baseUrl?: string;
  provider: string;
  testModel: string;
  enabled: boolean;
}

function loadConfig(): TestConfig {
  const enabled = process.env.ENABLE_INTEGRATION_TESTS === 'true' && !!process.env.OPENAI_API_KEY;

  if (process.env.ENABLE_INTEGRATION_TESTS === 'true' && !process.env.OPENAI_API_KEY) {
    console.warn(
      '[Wrangler-Cli Integration Tests] Warning: ENABLE_INTEGRATION_TESTS is true but OPENAI_API_KEY is not set; skipping LLM integration tests.'
    );
  }

  return {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL,
    provider: process.env.PROVIDER || 'openai',
    testModel: process.env.MODEL || 'gpt-3.5-turbo',
    enabled,
  };
}

export const testConfig: TestConfig = loadConfig();

/** Run test only when condition is true, skip otherwise */
export const itif = (condition: boolean) => (condition ? it : it.skip);
