/**
 * LLM client factory tests
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMClient } from '@agentskillmania/llm-client';
import { createLLMClient } from '../../../src/llm/client.js';
import { resolveDefaultModel } from '../../../src/llm/resolve-model.js';
import type { LLMProviderEntry } from '@agentskillmania/colts';

describe('llm client factory', () => {
  const providers: LLMProviderEntry[] = [
    {
      name: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      maxConcurrency: 10,
      models: [
        {
          modelId: 'gpt-4o',
          maxConcurrency: 3,
          contextWindow: 128000,
          maxTokens: 4096,
          reasoning: true,
          input: ['text'],
        },
      ],
    },
  ];

  it('should resolve default model from first provider and first model', () => {
    expect(resolveDefaultModel(providers)).toBe('gpt-4o');
  });

  it('should return an LLMClient instance', () => {
    const client = createLLMClient(providers);
    expect(client).toBeInstanceOf(LLMClient);
  });

  it('should register provider with name, baseUrl and maxConcurrency', () => {
    const registerProviderSpy = vi.spyOn(LLMClient.prototype, 'registerProvider');
    const registerApiKeySpy = vi.spyOn(LLMClient.prototype, 'registerApiKey');

    createLLMClient(providers);

    expect(registerProviderSpy).toHaveBeenCalledTimes(1);
    expect(registerProviderSpy).toHaveBeenCalledWith({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      maxConcurrency: 10,
    });

    expect(registerApiKeySpy).toHaveBeenCalledTimes(1);
    expect(registerApiKeySpy).toHaveBeenCalledWith({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 10,
      models: [
        {
          modelId: 'gpt-4o',
          maxConcurrency: 3,
          contextWindow: 128000,
          maxTokens: 4096,
          reasoning: true,
          input: ['text'],
        },
      ],
    });

    registerProviderSpy.mockRestore();
    registerApiKeySpy.mockRestore();
  });

  it('should support multiple providers', () => {
    const multiProviders: LLMProviderEntry[] = [
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
    ];

    const registerProviderSpy = vi.spyOn(LLMClient.prototype, 'registerProvider');
    const registerApiKeySpy = vi.spyOn(LLMClient.prototype, 'registerApiKey');

    createLLMClient(multiProviders);

    expect(registerProviderSpy).toHaveBeenCalledTimes(2);
    expect(registerApiKeySpy).toHaveBeenCalledTimes(2);

    registerProviderSpy.mockRestore();
    registerApiKeySpy.mockRestore();
  });
});
