import { describe, it, expect, beforeEach } from 'vitest';
import { createLLMClient, getLLMClient, resetLLMClient } from '../../src/llm.js';
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
    expect(stats).toMatchObject({ queueSize: 0 });
    expect(typeof client.call).toBe('function');
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
    expect(stats).toMatchObject({ queueSize: 0 });
    expect(typeof client.call).toBe('function');
  });
});

describe('getLLMClient', () => {
  beforeEach(() => {
    resetLLMClient();
  });

  it('should return the same shared client', () => {
    const config: LLMConfig = {
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    };
    const client1 = getLLMClient(config);
    const client2 = getLLMClient(config);
    expect(client1).toBe(client2);
  });

  it('should create a new client after reset', () => {
    const config: LLMConfig = {
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    };
    const client1 = getLLMClient(config);
    resetLLMClient();
    const client2 = getLLMClient(config);
    expect(client1).not.toBe(client2);
  });
});
