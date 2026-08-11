/**
 * @fileoverview LLM client factory for wrangler
 *
 * Builds an {@link LLMClient} from a list of providers in the colts
 * `LLMQuickInit` format. Each provider has exactly one API key and a list
 * of models.
 */

import type { LLMProviderEntry } from '@agentskillmania/colts';
import { LLMClient } from '@agentskillmania/llm-client';

/**
 * Create an LLMClient from a list of providers.
 *
 * @param providers - Provider list (one apiKey per provider)
 * @returns Configured LLMClient
 */
export function createLLMClient(providers: LLMProviderEntry[]): LLMClient {
  const client = new LLMClient();

  for (const provider of providers) {
    const providerConcurrency = provider.maxConcurrency ?? 5;

    client.registerProvider({
      name: provider.name,
      baseUrl: provider.baseUrl,
      maxConcurrency: providerConcurrency,
    });

    client.registerApiKey({
      key: provider.apiKey,
      provider: provider.name,
      maxConcurrency: providerConcurrency,
      models: provider.models.map((model) => ({
        modelId: model.modelId,
        maxConcurrency: model.maxConcurrency ?? 3,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        reasoning: model.reasoning,
        input: model.input,
      })),
    });
  }

  return client;
}

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
