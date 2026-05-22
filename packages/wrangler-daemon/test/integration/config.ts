/**
 * Integration test configuration for wrangler-daemon.
 *
 * Reads environment variables from root .env file (loaded by vitest.config.ts).
 * Tests are gated by ENABLE_INTEGRATION_TESTS=true.
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
      '[wrangler-daemon Integration Tests] ENABLE_INTEGRATION_TESTS is true but OPENAI_API_KEY is not set.'
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

/** Conditionally run tests based on a condition */
export const itif = (condition: boolean) => (condition ? it : it.skip);
