// packages/wrangler-devtool/src/agents/skill-designer.ts
// Skill Designer — generates or modifies skill definitions

import { runGenerationWithLoop, createGenerationRunner } from './orchestrator.js';
import type { AgentOutput, AgentRunOptions } from './types.js';
import type { RunnerConfig } from './orchestrator.js';
import type { EnhancedRunner } from '@agentskillmania/wrangler';
import type { AgentState } from '@agentskillmania/colts';

/**
 * Run the Skill Designer to generate or modify a skill definition.
 */
export async function runSkillDesigner(
  prompt: string,
  existingContent: string | undefined,
  config: RunnerConfig & AgentRunOptions
): Promise<AgentOutput> {
  const result = await runGenerationWithLoop(
    'skill-designer',
    prompt,
    { llmClient: config.llmClient, workspacePath: config.workspacePath, model: config.model },
    existingContent,
    config
  );
  return result.output;
}

/**
 * Create a skill designer runner for streaming usage.
 */
export async function createSkillDesignerRunner(
  config: RunnerConfig
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  return createGenerationRunner('skill-designer', config);
}
