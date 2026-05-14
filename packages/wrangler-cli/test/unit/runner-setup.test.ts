/**
 * runner-setup.ts unit tests
 */

import { describe, it, expect, vi } from 'vitest';
import { createLLMClientFromConfig, createInitialStateFromConfig } from '../../src/runner-setup.js';
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
    agent: {
      name: 'test-agent',
      instructions: 'You are a test assistant.',
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
    // Client was constructed with baseUrl; verify no error thrown
  });

  it('should pass undefined baseUrl to LLMClient when not provided', () => {
    const config = makeValidConfig();
    // baseUrl is not in the override, so it's undefined
    const client = createLLMClientFromConfig(config);

    expect(client).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createInitialStateFromConfig
// ---------------------------------------------------------------------------

describe('createInitialStateFromConfig', () => {
  it('should return null when hasValidConfig is false', () => {
    const config: AppConfig = { hasValidConfig: false };
    const result = createInitialStateFromConfig(config);
    expect(result).toBeNull();
  });

  it('should return null when llm is missing', () => {
    const config: AppConfig = { hasValidConfig: true };
    const result = createInitialStateFromConfig(config);
    expect(result).toBeNull();
  });

  it('should return AgentState with correct name and instructions', () => {
    const config = makeValidConfig();
    const state = createInitialStateFromConfig(config);

    expect(state).not.toBeNull();
    // name/instructions are stored inside state.config (AgentConfig)
    expect(state!.config.name).toBe('test-agent');
    expect(state!.config.instructions).toBe('You are a test assistant.');
  });

  it('should use default name when agent is not configured', () => {
    const config: AppConfig = {
      hasValidConfig: true,
      configPath: '/test/config.yaml',
      llm: {
        provider: 'openai',
        apiKey: 'sk-test-key',
        model: 'gpt-4o',
      },
    };
    const state = createInitialStateFromConfig(config);

    expect(state).not.toBeNull();
    expect(state!.config.name).toBe('wrangler-agent');
  });

  it('should preserve empty instructions when agent instructions are empty string', () => {
    const config: AppConfig = {
      hasValidConfig: true,
      configPath: '/test/config.yaml',
      llm: {
        provider: 'openai',
        apiKey: 'sk-test-key',
        model: 'gpt-4o',
      },
      agent: {
        name: 'custom-agent',
        instructions: '',
      },
    };
    const state = createInitialStateFromConfig(config);

    expect(state).not.toBeNull();
    expect(state!.config.name).toBe('custom-agent');
    // ?? (nullish coalescing) does NOT trigger for empty string, only null/undefined
    expect(state!.config.instructions).toBe('');
  });

  it('should use default name and instructions when agent is missing entirely', () => {
    const config: AppConfig = {
      hasValidConfig: true,
      configPath: '/test/config.yaml',
      llm: {
        provider: 'openai',
        apiKey: 'sk-test-key',
        model: 'gpt-4o',
      },
    };
    const state = createInitialStateFromConfig(config);

    expect(state).not.toBeNull();
    expect(state!.config.name).toBe('wrangler-agent');
    expect(state!.config.instructions).toBe('You are a helpful assistant.');
  });

  it('should return AgentState with empty tools array', () => {
    const config = makeValidConfig();
    const state = createInitialStateFromConfig(config);

    expect(state).not.toBeNull();
    expect(state!.config.tools).toEqual([]);
  });
});
