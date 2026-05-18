/**
 * @fileoverview LLM client and initial state factory from AppConfig
 *
 * Provides two factory functions used by the App component:
 * - createLLMClientFromConfig: builds and configures an LLMClient with provider + apiKey
 * - createInitialState: builds an initial AgentState for a fresh session
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

/** Default concurrency when not specified in config */
const DEFAULT_CONCURRENCY = 5;

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

  const { provider, apiKey, model, baseUrl, maxConcurrency } = config.llm;
  const concurrency = maxConcurrency ?? DEFAULT_CONCURRENCY;

  const client = new LLMClient({ baseUrl });

  client.registerProvider({
    name: provider,
    maxConcurrency: concurrency,
  });

  client.registerApiKey({
    key: apiKey,
    provider,
    maxConcurrency: concurrency,
    models: [{ modelId: model, maxConcurrency: concurrency }],
  });

  return client;
}

/**
 * Create initial AgentState from AppConfig
 *
 * Builds a fresh agent state with hardcoded defaults.
 * Agent name/instructions come from directory detection (AgentLoader),
 * not from config. This function provides fallback defaults.
 *
 * @param agentName - Agent name (from directory detection or fallback)
 * @param instructions - Agent instructions (from directory detection or fallback)
 * @returns AgentState instance
 */
export function createInitialState(
  agentName: string = 'wrangler-agent',
  instructions: string = 'You are a helpful assistant.'
): AgentState {
  return createAgentState({
    name: agentName,
    instructions,
    tools: [],
  });
}
