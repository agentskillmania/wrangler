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
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    };

    createLLMClient(config);

    expect(mockConstructor).toHaveBeenCalledWith(undefined);
    expect(mockRegisterProvider).toHaveBeenCalledWith({ name: 'openai', maxConcurrency: 5 });
    expect(mockRegisterApiKey).toHaveBeenCalledWith({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4o', maxConcurrency: 5 }],
    });
  });

  it('passes baseUrl through to LLMClient constructor', () => {
    const config: LLMConfig = {
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      baseUrl: 'https://custom.example.com',
    };

    createLLMClient(config);

    expect(mockConstructor).toHaveBeenCalledWith({ baseUrl: 'https://custom.example.com' });
  });

  it('uses custom maxConcurrency when provided', () => {
    const config: LLMConfig = {
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-3',
      maxConcurrency: 10,
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

  it('defaults maxConcurrency to 5 when not specified', () => {
    const config: LLMConfig = {
      provider: 'openai',
      apiKey: 'sk-default',
      model: 'gpt-4o',
    };

    createLLMClient(config);

    expect(mockRegisterProvider).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrency: 5 })
    );
    expect(mockRegisterApiKey).toHaveBeenCalledWith(expect.objectContaining({ maxConcurrency: 5 }));
  });

  it('passes all optional fields to the client', () => {
    const config: LLMConfig = {
      provider: 'google',
      apiKey: 'sk-full-test',
      model: 'gemini-pro',
      baseUrl: 'https://custom.google.com',
      thinkingEnabled: true,
      enablePromptThinking: true,
      maxConcurrency: 3,
    };

    createLLMClient(config);

    expect(mockConstructor).toHaveBeenCalledWith({ baseUrl: 'https://custom.google.com' });
    expect(mockRegisterProvider).toHaveBeenCalledWith({ name: 'google', maxConcurrency: 3 });
    expect(mockRegisterApiKey).toHaveBeenCalledWith({
      key: 'sk-full-test',
      provider: 'google',
      maxConcurrency: 3,
      models: [{ modelId: 'gemini-pro', maxConcurrency: 3 }],
    });
  });
});
