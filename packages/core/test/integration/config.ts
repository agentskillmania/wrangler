/**
 * Integration test configuration for wrangler
 *
 * Reuses the same .env variables as colts integration tests:
 * - ENABLE_INTEGRATION_TESTS=true to enable
 * - OPENAI_API_KEY for the LLM provider
 * - OPENAI_BASE_URL (optional) for custom endpoints
 * - PROVIDER (optional, default: 'openai')
 * - MODEL (optional, default: 'gpt-3.5-turbo')
 */

export interface TestConfig {
  apiKey: string;
  baseUrl?: string;
  provider: string;
  testModel: string;
  enabled: boolean;
}

function loadConfig(): TestConfig {
  const enabled = process.env.ENABLE_INTEGRATION_TESTS === 'true';

  if (enabled && !process.env.OPENAI_API_KEY) {
    console.warn(
      '[Wrangler Integration Tests] Warning: ENABLE_INTEGRATION_TESTS is true but OPENAI_API_KEY is not set.'
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
