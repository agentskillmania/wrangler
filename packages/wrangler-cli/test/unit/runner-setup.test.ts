/**
 * runner-setup.ts unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLLMClientFromConfig, createInitialState } from '../../src/runner-setup.js';
import { LLMClient } from '@agentskillmania/llm-client';
import type { AppConfig } from '../../src/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid AppConfig with multi-provider shape */
function makeValidConfig(
  overrides?: Partial<AppConfig['llm']>,
  extra?: Partial<AppConfig>
): AppConfig {
  return {
    hasValidConfig: true,
    configPath: '/test/config.yaml',
    llm: {
      providers: [
        {
          name: 'openai',
          apiKey: 'sk-test-key',
          models: [{ modelId: 'gpt-4o' }],
        },
      ],
      ...overrides,
    },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// createLLMClientFromConfig
// ---------------------------------------------------------------------------

describe('createLLMClientFromConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when hasValidConfig is false', () => {
    const result = createLLMClientFromConfig({ hasValidConfig: false });
    expect(result).toBeNull();
  });

  it('returns null when llm is missing', () => {
    const result = createLLMClientFromConfig({ hasValidConfig: true });
    expect(result).toBeNull();
  });

  it('returns null when providers array is empty', () => {
    const result = createLLMClientFromConfig(makeValidConfig({ providers: [] }));
    expect(result).toBeNull();
  });

  it('creates client and registers provider + apiKey with correct values', () => {
    const registerProviderSpy = vi.spyOn(LLMClient.prototype, 'registerProvider');
    const registerApiKeySpy = vi.spyOn(LLMClient.prototype, 'registerApiKey');

    const config = makeValidConfig();
    createLLMClientFromConfig(config);

    expect(registerProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'openai',
        maxConcurrency: 10,
      })
    );

    expect(registerApiKeySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'sk-test-key',
        provider: 'openai',
        maxConcurrency: 10,
        models: expect.arrayContaining([
          expect.objectContaining({ modelId: 'gpt-4o', maxConcurrency: 3 }),
        ]),
      })
    );
  });

  it('passes custom baseUrl to LLMClient registration', () => {
    const registerProviderSpy = vi.spyOn(LLMClient.prototype, 'registerProvider');

    const config = makeValidConfig({
      providers: [
        {
          name: 'openai',
          apiKey: 'sk-test-key',
          baseUrl: 'https://custom.api.com/v1',
          models: [{ modelId: 'gpt-4o' }],
        },
      ],
    });
    createLLMClientFromConfig(config);

    expect(registerProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'openai',
        baseUrl: 'https://custom.api.com/v1',
      })
    );
  });

  it('uses custom maxConcurrency when provided', () => {
    const registerProviderSpy = vi.spyOn(LLMClient.prototype, 'registerProvider');

    const config = makeValidConfig({
      providers: [
        {
          name: 'openai',
          apiKey: 'sk-test-key',
          maxConcurrency: 10,
          models: [{ modelId: 'gpt-4o' }],
        },
      ],
    });
    createLLMClientFromConfig(config);

    expect(registerProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrency: 10 })
    );
  });

  it('defaults to 10 provider and 3 model maxConcurrency when not provided', () => {
    const registerProviderSpy = vi.spyOn(LLMClient.prototype, 'registerProvider');
    const registerApiKeySpy = vi.spyOn(LLMClient.prototype, 'registerApiKey');

    const config = makeValidConfig();
    createLLMClientFromConfig(config);

    expect(registerProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrency: 10 })
    );
    expect(registerApiKeySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        models: expect.arrayContaining([
          expect.objectContaining({ modelId: 'gpt-4o', maxConcurrency: 3 }),
        ]),
      })
    );
  });

  it('registers multiple providers', () => {
    const registerProviderSpy = vi.spyOn(LLMClient.prototype, 'registerProvider');
    const registerApiKeySpy = vi.spyOn(LLMClient.prototype, 'registerApiKey');

    const config = makeValidConfig({
      providers: [
        {
          name: 'openai',
          apiKey: 'sk-openai',
          models: [{ modelId: 'gpt-4o' }],
        },
        {
          name: 'anthropic',
          apiKey: 'sk-anthropic',
          models: [{ modelId: 'claude-3' }],
        },
      ],
    });
    createLLMClientFromConfig(config);

    expect(registerProviderSpy).toHaveBeenCalledTimes(2);
    expect(registerApiKeySpy).toHaveBeenCalledTimes(2);
    expect(registerProviderSpy).toHaveBeenCalledWith(expect.objectContaining({ name: 'openai' }));
    expect(registerProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'anthropic' })
    );
  });
});

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

describe('createInitialState', () => {
  it('returns AgentState with default name and instructions', () => {
    const state = createInitialState();

    expect(state.config.name).toBe('wrangler-agent');
    expect(state.config.instructions).toBe('You are a helpful assistant.');
  });

  it('returns AgentState with custom name and instructions', () => {
    const state = createInitialState('my-agent', 'Custom instructions.');

    expect(state.config.name).toBe('my-agent');
    expect(state.config.instructions).toBe('Custom instructions.');
  });

  it('returns AgentState with empty tools array', () => {
    const state = createInitialState();

    expect(state.config.tools).toEqual([]);
  });
});
