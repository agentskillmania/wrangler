// packages/wrangler-devtool/src/agents/crew-composer.ts
// Crew Composer — generates or modifies crew definitions

import { getLLMClient } from '../llm.js';
import { requireLLMConfig } from '../config.js';
import { runAgent } from './orchestrator.js';
import type { AgentOutput, AgentOptions } from './types.js';

/**
 * Run the Crew Composer to generate or modify a crew definition.
 */
export async function runCrewComposer(
  prompt: string,
  existingContent?: string,
  options?: AgentOptions
): Promise<AgentOutput> {
  const config = await requireLLMConfig();
  const client = getLLMClient(config);
  const model = options?.model ?? config.model;
  return runAgent(client, model, 'crew-composer', prompt, existingContent, options);
}
