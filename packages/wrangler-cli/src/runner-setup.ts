/**
 * @fileoverview LLM client and initial state factory from AppConfig
 *
 * Provides two factory functions used by the App component:
 * - createLLMClientFromConfig: builds and configures an LLMClient with provider + apiKey
 * - createInitialStateFromConfig: builds an initial AgentState for a fresh session
 *
 * The actual EnhancedRunner.create() call is deferred to the App component
 * because workspacePath is determined at runtime via mode detection.
 *
 * Adapted from colts-cli's runner-setup pattern.
 */

import { LLMClient } from '@agentskillmania/llm-client';
import { createAgentState } from '@agentskillmania/colts';
import type { AgentState } from '@agentskillmania/colts';
import type { AppConfig } from './config.js';

/** Default concurrency for provider-level scheduling */
const DEFAULT_PROVIDER_CONCURRENCY = 5;

/** Default concurrency for api-key-level scheduling */
const DEFAULT_KEY_CONCURRENCY = 5;

/** Default concurrency for individual model scheduling */
const DEFAULT_MODEL_CONCURRENCY = 5;

/**
 * Create a configured LLMClient from AppConfig
 *
 * Registers one provider and one API key derived from config.llm.
 * Returns null if config is missing required LLM fields.
 *
 * @param config - Validated application config
 * @returns LLMClient instance, or null if config is invalid
 */
export function createLLMClientFromConfig(config: AppConfig): LLMClient | null {
  if (!config.hasValidConfig || !config.llm) return null;

  const { provider, apiKey, model, baseUrl } = config.llm;

  const client = new LLMClient({ baseUrl });

  client.registerProvider({
    name: provider,
    maxConcurrency: DEFAULT_PROVIDER_CONCURRENCY,
  });

  client.registerApiKey({
    key: apiKey,
    provider,
    maxConcurrency: DEFAULT_KEY_CONCURRENCY,
    models: [{ modelId: model, maxConcurrency: DEFAULT_MODEL_CONCURRENCY }],
  });

  return client;
}

/**
 * Create initial AgentState from AppConfig
 *
 * Builds a fresh agent state with name and instructions from config.agent.
 * Returns null if config is missing required LLM fields.
 *
 * @param config - Validated application config
 * @returns AgentState instance, or null if config is invalid
 */
export function createInitialStateFromConfig(config: AppConfig): AgentState | null {
  if (!config.hasValidConfig || !config.llm) return null;

  return createAgentState({
    name: config.agent?.name ?? 'wrangler-agent',
    instructions: config.agent?.instructions ?? 'You are a helpful assistant.',
    tools: [],
  });
}
