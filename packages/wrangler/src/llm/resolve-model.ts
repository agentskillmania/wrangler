/**
 * @fileoverview 从 provider 列表解析默认模型——纯函数，无 llm-client 运行时依赖。
 */

import type { LLMProviderEntry } from '@agentskillmania/llm-client';

/**
 * Resolve the default model identifier from a provider list.
 *
 * Uses the first model of the first provider.
 *
 * @param providers - Provider list
 * @returns Default model id
 */
export function resolveDefaultModel(providers: LLMProviderEntry[]): string {
  return providers[0]?.models[0]?.modelId;
}
