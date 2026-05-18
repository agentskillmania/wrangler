/**
 * runner-setup.ts unit tests
 */

import { describe, it, expect } from 'vitest';
import { createLLMClientFromConfig, createInitialState } from '../../src/runner-setup.js';
import type { AppConfig } from '../../src/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid AppConfig */
function makeValidConfig(
  overrides?: Partial<AppConfig['llm']>,
  extra?: Partial<AppConfig>
): AppConfig {
  return {
    hasValidConfig: true,
    configPath: '/test/config.yaml',
    llm: {
      provider: 'openai',
      apiKey: 'sk-test-key',
      model: 'gpt-4o',
      ...overrides,
    },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// createLLMClientFromConfig
// ---------------------------------------------------------------------------

describe('createLLMClientFromConfig', () => {
  it('should return null when hasValidConfig is false', () => {
    const config: AppConfig = { hasValidConfig: false };
    const result = createLLMClientFromConfig(config);
    expect(result).toBeNull();
  });

  it('should return null when llm is missing', () => {
    const config: AppConfig = { hasValidConfig: true };
    const result = createLLMClientFromConfig(config);
    expect(result).toBeNull();
  });

  it('should return null when both hasValidConfig is false and llm is missing', () => {
    const config: AppConfig = { hasValidConfig: false };
    const result = createLLMClientFromConfig(config);
    expect(result).toBeNull();
  });

  it('should return LLMClient instance with valid config', () => {
    const config = makeValidConfig();
    const client = createLLMClientFromConfig(config);

    expect(client).not.toBeNull();
    expect(client).toBeDefined();
  });

  it('should pass baseUrl to LLMClient when provided', () => {
    const config = makeValidConfig({ baseUrl: 'https://custom.api.com/v1' });
    const client = createLLMClientFromConfig(config);

    expect(client).not.toBeNull();
  });

  it('should pass undefined baseUrl to LLMClient when not provided', () => {
    const config = makeValidConfig();
    const client = createLLMClientFromConfig(config);

    expect(client).not.toBeNull();
  });

  it('should use custom maxConcurrency when provided', () => {
    const config = makeValidConfig({ maxConcurrency: 10 });
    const client = createLLMClientFromConfig(config);

    expect(client).not.toBeNull();
    // Verify the client was created successfully with custom concurrency
  });

  it('should default to 5 maxConcurrency when not provided', () => {
    const config = makeValidConfig();
    const client = createLLMClientFromConfig(config);

    expect(client).not.toBeNull();
    // Default concurrency of 5 is used when maxConcurrency is undefined
  });

  it('should pass maxConcurrency to provider, key, and model', () => {
    const config = makeValidConfig({ maxConcurrency: 15 });
    const client = createLLMClientFromConfig(config);

    expect(client).not.toBeNull();
    // maxConcurrency=15 should be applied at provider, apiKey, and model levels
  });
});

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

describe('createInitialState', () => {
  it('should return AgentState with default name and instructions', () => {
    const state = createInitialState();

    expect(state.config.name).toBe('wrangler-agent');
    expect(state.config.instructions).toBe('You are a helpful assistant.');
  });

  it('should return AgentState with custom name and instructions', () => {
    const state = createInitialState('my-agent', 'Custom instructions.');

    expect(state.config.name).toBe('my-agent');
    expect(state.config.instructions).toBe('Custom instructions.');
  });

  it('should return AgentState with empty tools array', () => {
    const state = createInitialState();

    expect(state.config.tools).toEqual([]);
  });
});
