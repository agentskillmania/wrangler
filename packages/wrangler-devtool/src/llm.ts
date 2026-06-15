// packages/wrangler-devtool/src/llm.ts
// LLM client setup — delegates to wrangler's multi-provider factory

import { LLMClient } from '@agentskillmania/llm-client';
import { createLLMClient as createWranglerLLMClient } from '@agentskillmania/wrangler';

import type { LLMConfig } from './config.js';

/**
 * Create a new LLMClient from multi-provider configuration.
 */
export function createLLMClient(config: LLMConfig): LLMClient {
  return createWranglerLLMClient(config.providers);
}
