import { describe, it, expect } from 'vitest';
import { resolveLLMConfig } from '../../src/llm-config.js';
import type { WranglerLLMConfig } from '../../src/types.js';
import type { ILLMProvider } from '@agentskillmania/colts';

describe('resolveLLMConfig', () => {
  it('should return llmClient when provided', () => {
    const mockClient = {
      call: async () => ({ content: '', tokens: {} }),
      stream: async function* () {},
    } as unknown as ILLMProvider;

    const config: WranglerLLMConfig = { llmClient: mockClient };
    const result = resolveLLMConfig(config);

    expect(result).toEqual({ llmClient: mockClient });
  });

  it('should return LLMQuickInit when apiKey is provided', () => {
    const config: WranglerLLMConfig = {
      apiKey: 'test-key',
      provider: 'openai',
      baseUrl: 'https://api.example.com',
      maxConcurrency: 10,
    };
    const result = resolveLLMConfig(config);

    expect(result).toEqual({
      llm: {
        apiKey: 'test-key',
        provider: 'openai',
        baseUrl: 'https://api.example.com',
        maxConcurrency: 10,
      },
    });
  });

  it('should apply defaults for apiKey mode', () => {
    const config: WranglerLLMConfig = { apiKey: 'test-key' };
    const result = resolveLLMConfig(config);

    expect(result).toEqual({
      llm: {
        apiKey: 'test-key',
        provider: undefined,
        baseUrl: undefined,
        maxConcurrency: undefined,
      },
    });
  });

  it('should throw when neither llmClient nor apiKey is provided', () => {
    const config: WranglerLLMConfig = {};
    expect(() => resolveLLMConfig(config)).toThrow(
      'Must provide either llmClient or apiKey in WranglerLLMConfig'
    );
  });

  it('should throw when both llmClient and apiKey are provided', () => {
    const mockClient = {
      call: async () => ({ content: '', tokens: {} }),
      stream: async function* () {},
    } as unknown as ILLMProvider;

    const config: WranglerLLMConfig = {
      llmClient: mockClient,
      apiKey: 'test-key',
    };
    expect(() => resolveLLMConfig(config)).toThrow('Cannot provide both llmClient and apiKey');
  });
});
