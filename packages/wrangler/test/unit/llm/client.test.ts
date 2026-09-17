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

  describe('key-aware default resolution (R2P-231, aligned with Rust c90cbd9)', () => {
    // 与 Rust resolve_default_model 兜底链对齐：第一个【有 key】的 provider
    // 优先；全部无 key 时回退列表第一个（保持旧状）；再无则 undefined。
    // 无 key 的 provider 发不出请求——不能让它抢占默认位（env 注入的
    // 空占位项排在前面时，默认请求全部打到空 key 上 401）。

    it('should skip the first provider when it has an empty apiKey', () => {
      const mixed: LLMProviderEntry[] = [
        { name: 'builtin-openai', apiKey: '', models: [{ modelId: 'gpt-4o' }] },
        { name: 'deepseek', apiKey: 'sk-x', models: [{ modelId: 'deepseek-chat' }] },
      ];
      expect(resolveDefaultModel(mixed)).toBe('deepseek-chat');
    });

    it('should fall back to the first provider when no provider has a key', () => {
      const allKeyless: LLMProviderEntry[] = [
        { name: 'a', apiKey: '', models: [{ modelId: 'model-a' }] },
        { name: 'b', apiKey: '', models: [{ modelId: 'model-b' }] },
      ];
      expect(resolveDefaultModel(allKeyless)).toBe('model-a');
    });

    it('should keep the first provider when it already has a key', () => {
      const keyed: LLMProviderEntry[] = [
        { name: 'openai', apiKey: 'sk-1', models: [{ modelId: 'gpt-4o' }] },
        { name: 'deepseek', apiKey: 'sk-2', models: [{ modelId: 'deepseek-chat' }] },
      ];
      expect(resolveDefaultModel(keyed)).toBe('gpt-4o');
    });

    it('should return undefined for an empty provider list', () => {
      expect(resolveDefaultModel([])).toBeUndefined();
    });
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
