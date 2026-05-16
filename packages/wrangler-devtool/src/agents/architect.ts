// packages/wrangler-devtool/src/agents/architect.ts
// Agent Architect — generates or modifies agent definitions

import { getLLMClient } from '../llm.js';
import { requireLLMConfig } from '../config.js';
import { runAgent } from './orchestrator.js';
import type { AgentOutput, AgentOptions } from './types.js';

/**
 * Run the Agent Architect to generate or modify an agent definition.
 */
export async function runAgentArchitect(
  prompt: string,
  existingContent?: string,
  options?: AgentOptions
): Promise<AgentOutput> {
  const config = await requireLLMConfig();
  const client = getLLMClient(config);
  const model = options?.model ?? config.model;
  return runAgent(client, model, 'architect', prompt, existingContent, options);
}
