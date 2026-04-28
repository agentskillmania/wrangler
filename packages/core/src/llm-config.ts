// packages/core/src/llm-config.ts

import type { ILLMProvider, LLMQuickInit } from '@agentskillmania/colts';
import type { WranglerLLMConfig } from './types.js';

/**
 * LLM 配置解析结果 — 对应 colts RunnerOptions 的两种 LLM 模式
 */
export interface ResolvedLLMConfig {
  llmClient?: ILLMProvider;
  llm?: LLMQuickInit;
}

/**
 * 将 WranglerLLMConfig 解析为 colts RunnerOptions 可用的格式
 *
 * @param config - 用户提供的 LLM 配置
 * @returns colts 可接受的 LLM 配置对象
 * @throws 当 llmClient 和 apiKey 都未提供，或同时提供时
 */
export function resolveLLMConfig(config: WranglerLLMConfig): ResolvedLLMConfig {
  if (config.llmClient && config.apiKey) {
    throw new Error('Cannot provide both llmClient and apiKey in WranglerLLMConfig');
  }

  if (config.llmClient) {
    return { llmClient: config.llmClient };
  }

  if (config.apiKey) {
    return {
      llm: {
        apiKey: config.apiKey,
        provider: config.provider,
        baseUrl: config.baseUrl,
        maxConcurrency: config.maxConcurrency,
      },
    };
  }

  throw new Error('Must provide either llmClient or apiKey in WranglerLLMConfig');
}
