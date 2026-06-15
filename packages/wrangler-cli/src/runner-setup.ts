/**
 * @fileoverview LLM client and initial state factory from AppConfig
 *
 * Provides two factory functions used by the App component:
 * - createLLMClientFromConfig: builds and configures an LLMClient from config.llm.providers
 * - createInitialState: builds an initial AgentState for a fresh session
 *
 * The actual EnhancedRunner.create() call is deferred to the App component
 * because workspacePath is determined at runtime via mode detection.
 *
 * Adapted from colts-cli's runner-setup pattern.
 */

import { createAgentState } from '@agentskillmania/colts';
import type { AgentState } from '@agentskillmania/colts';
import type { LLMClient } from '@agentskillmania/llm-client';
import { createLLMClient } from '@agentskillmania/wrangler';

import type { AppConfig } from './config.js';

/**
 * Create a configured LLMClient from AppConfig
 *
 * Registers providers and API keys derived from config.llm.providers.
 * Returns null if config is missing required LLM fields.
 *
 * @param config - Validated application config
 * @returns LLMClient instance, or null if config is invalid
 */
export function createLLMClientFromConfig(config: AppConfig): LLMClient | null {
  if (!config.hasValidConfig || !config.llm?.providers?.length) return null;

  return createLLMClient(config.llm.providers);
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
