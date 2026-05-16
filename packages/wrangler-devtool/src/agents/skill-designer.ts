// packages/wrangler-devtool/src/agents/skill-designer.ts
// Skill Designer — generates or modifies skill definitions

import { getLLMClient } from '../llm.js';
import { requireLLMConfig } from '../config.js';
import { runAgent } from './orchestrator.js';
import type { AgentOutput, AgentOptions } from './types.js';

/**
 * Run the Skill Designer to generate or modify a skill definition.
 */
export async function runSkillDesigner(
  prompt: string,
  existingContent?: string,
  options?: AgentOptions
): Promise<AgentOutput> {
  const config = await requireLLMConfig();
  const client = getLLMClient(config);
  const model = options?.model ?? config.model;
  return runAgent(client, model, 'skill-designer', prompt, existingContent, options);
}
