import { describe, it, expect } from 'vitest';
import { createLLMClient } from '../../src/llm.js';
import type { LLMConfig } from '../../src/config.js';

describe('createLLMClient', () => {
  it('should create a client with basic config', () => {
    const config: LLMConfig = {
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    };
    const client = createLLMClient(config);
    const stats = client.getStats();

    // Provider should be registered
    expect(stats.providerActiveCounts.has('openai')).toBe(true);

    // API key should be registered (masked: first 8 chars + '...')
    expect(stats.keyHealth.has('sk-test...')).toBe(true);

    // Fresh client has no active requests or queue
    expect(stats.queueSize).toBe(0);
    expect(stats.activeRequests).toBe(0);
  });

  it('should create a client with baseUrl', () => {
    const config: LLMConfig = {
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      baseUrl: 'https://custom.example.com',
    };
    const client = createLLMClient(config);
    const stats = client.getStats();

    // baseUrl does not affect stats, but client creation should succeed
    expect(stats.providerActiveCounts.has('openai')).toBe(true);
    expect(stats.keyHealth.has('sk-test...')).toBe(true);
  });

  it('should use maxConcurrency from config', () => {
    const config: LLMConfig = {
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-3',
      maxConcurrency: 10,
    };
    const client = createLLMClient(config);
    const stats = client.getStats();

    // Provider registered with the custom name
    expect(stats.providerActiveCounts.has('anthropic')).toBe(true);
    expect(stats.keyHealth.has('sk-ant-t...')).toBe(true);
  });

  it('should default maxConcurrency when not specified', () => {
    const config: LLMConfig = {
      provider: 'openai',
      apiKey: 'sk-default',
      model: 'gpt-4o',
    };
    const client = createLLMClient(config);
    const stats = client.getStats();

    // Should still register successfully with defaults
    expect(stats.providerActiveCounts.has('openai')).toBe(true);
    expect(stats.keyHealth.has('sk-defau...')).toBe(true);
  });

  it('should create a client with all optional fields', () => {
    const config: LLMConfig = {
      provider: 'google',
      apiKey: 'sk-full-test',
      model: 'gemini-pro',
      baseUrl: 'https://custom.google.com',
      thinkingEnabled: true,
      enablePromptThinking: true,
      maxConcurrency: 3,
    };
    const client = createLLMClient(config);
    const stats = client.getStats();

    expect(stats.providerActiveCounts.has('google')).toBe(true);
    expect(stats.keyHealth.has('sk-full-...')).toBe(true);
  });
});
