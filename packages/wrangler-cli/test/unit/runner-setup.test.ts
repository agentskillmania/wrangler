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
function makeValidConfig(overrides?: Partial<AppConfig['llm']>): AppConfig {
  return {
    hasValidConfig: true,
    configPath: '/test/config.yaml',
    llm: {
      provider: 'openai',
      apiKey: 'sk-test-key',
      model: 'gpt-4o',
      ...overrides,
    },
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
