/**
 * @fileoverview 从 provider 列表解析默认模型——纯函数，无 llm-client 运行时依赖。
 */

import type { LLMProviderEntry } from '@agentskillmania/llm-client';

/**
 * Resolve the default model identifier from a provider list.
 *
 * Skips keyless providers (empty apiKey — they cannot serve requests) and
 * uses the first model of the first provider WITH a key. Falls back to the
 * first provider when none has a key, undefined for an empty list.
 * (R2P-231, aligned with Rust c90cbd9's resolve_default_model fallback
 * chain, minus the defaultProvider tier which the TS config lacks.)
 *
 * @param providers - Provider list
 * @returns Default model id
 */
export function resolveDefaultModel(providers: LLMProviderEntry[]): string {
  const withKey = providers.find((p) => p.apiKey);
  return (withKey ?? providers[0])?.models[0]?.modelId;
}
