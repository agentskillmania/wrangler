/**
 * @fileoverview LLM client factory for wrangler（Node 宿主用）。
 *
 * 装配逻辑在 llm-client 的 LLMClient.quickInit。此模块仅供 Node 宿主
 * （daemon）import——wrangler core 不 import 它（引擎不捆绑内置 LLM）。
 */

import type { LLMProviderEntry, LLMClient } from '@agentskillmania/llm-client';
import { LLMClient as LLMClientImpl } from '@agentskillmania/llm-client';

/**
 * Create an LLMClient from a list of providers.
 *
 * @param providers - Provider list (one apiKey per provider)
 * @returns Configured LLMClient
 */
export function createLLMClient(providers: LLMProviderEntry[]): LLMClient {
  return LLMClientImpl.quickInit({ providers });
}
