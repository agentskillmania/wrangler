import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMConfig } from '../../src/config.js';

const mockRegisterProvider = vi.fn();
const mockRegisterApiKey = vi.fn();
const mockConstructor = vi.fn();

vi.mock('@agentskillmania/llm-client', () => ({
  LLMClient: class {
    constructor(options: unknown) {
      mockConstructor(options);
    }
    registerProvider(config: unknown) {
      mockRegisterProvider(config);
    }
    registerApiKey(config: unknown) {
      mockRegisterApiKey(config);
    }
    getStats() {
      return { activeRequests: 0, queueSize: 0 };
    }
  },
}));

import { createLLMClient } from '../../src/llm.js';

describe('createLLMClient', () => {
  beforeEach(() => {
    mockRegisterProvider.mockClear();
    mockRegisterApiKey.mockClear();
    mockConstructor.mockClear();
  });

  it('registers provider, apiKey and model with basic config', () => {
    const config: LLMConfig = {
      providers: [
        {
          name: 'openai',
          apiKey: 'sk-test',
          models: [{ modelId: 'gpt-4o' }],
        },
      ],
    };

    createLLMClient(config);

    expect(mockConstructor).toHaveBeenCalledWith(undefined);
    expect(mockRegisterProvider).toHaveBeenCalledWith({ name: 'openai', maxConcurrency: 10 });
    expect(mockRegisterApiKey).toHaveBeenCalledWith({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 10,
      models: [{ modelId: 'gpt-4o', maxConcurrency: 3 }],
    });
  });

  it('passes baseUrl through to provider registration', () => {
    const config: LLMConfig = {
      providers: [
        {
          name: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://custom.example.com',
          models: [{ modelId: 'gpt-4o' }],
        },
      ],
    };

    createLLMClient(config);

    expect(mockConstructor).toHaveBeenCalledWith(undefined);
    expect(mockRegisterProvider).toHaveBeenCalledWith({
      name: 'openai',
      baseUrl: 'https://custom.example.com',
      maxConcurrency: 10,
    });
  });

  it('uses custom maxConcurrency when provided', () => {
    const config: LLMConfig = {
      providers: [
        {
          name: 'anthropic',
          apiKey: 'sk-ant-test',
          maxConcurrency: 10,
          models: [{ modelId: 'claude-3', maxConcurrency: 10 }],
        },
      ],
    };

    createLLMClient(config);

    expect(mockRegisterProvider).toHaveBeenCalledWith({ name: 'anthropic', maxConcurrency: 10 });
    expect(mockRegisterApiKey).toHaveBeenCalledWith({
      key: 'sk-ant-test',
      provider: 'anthropic',
      maxConcurrency: 10,
      models: [{ modelId: 'claude-3', maxConcurrency: 10 }],
    });
  });

  it('defaults maxConcurrency when not specified', () => {
    const config: LLMConfig = {
      providers: [
        {
          name: 'openai',
          apiKey: 'sk-default',
          models: [{ modelId: 'gpt-4o' }],
        },
      ],
    };

    createLLMClient(config);

    expect(mockRegisterProvider).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrency: 10 })
    );
    expect(mockRegisterApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        maxConcurrency: 10,
        models: [{ modelId: 'gpt-4o', maxConcurrency: 3 }],
      })
    );
  });

  it('passes all optional fields to the client', () => {
    const config: LLMConfig = {
      providers: [
        {
          name: 'google',
          apiKey: 'sk-full-test',
          baseUrl: 'https://custom.google.com',
          maxConcurrency: 3,
          models: [
            {
              modelId: 'gemini-pro',
              maxConcurrency: 3,
              contextWindow: 128000,
              maxTokens: 8192,
              reasoning: true,
            },
          ],
        },
      ],
    };

    createLLMClient(config);

    expect(mockConstructor).toHaveBeenCalledWith(undefined);
    expect(mockRegisterProvider).toHaveBeenCalledWith({
      name: 'google',
      baseUrl: 'https://custom.google.com',
      maxConcurrency: 3,
    });
    expect(mockRegisterApiKey).toHaveBeenCalledWith({
      key: 'sk-full-test',
      provider: 'google',
      maxConcurrency: 3,
      models: [
        {
          modelId: 'gemini-pro',
          maxConcurrency: 3,
          contextWindow: 128000,
          maxTokens: 8192,
          reasoning: true,
        },
      ],
    });
  });
});
