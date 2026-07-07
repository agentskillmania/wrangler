// packages/wrangler-devtool/src/agents/skill-designer.ts
// Skill Designer — generates or modifies skill definitions

import type { AgentState } from '@agentskillmania/colts';
import type { EnhancedRunner } from '@agentskillmania/wrangler';

import { createGenerationAgent } from './generation-agent.js';
import type { RunnerConfig } from './orchestrator.js';
import type { AgentOutput, AgentRunOptions } from './types.js';

const skillDesigner = createGenerationAgent('skill-designer');

/** @inheritDoc GenerationAgent.run */
export async function runSkillDesigner(
  prompt: string,
  existingContent: string | undefined,
  config: RunnerConfig & AgentRunOptions
): Promise<AgentOutput> {
  return skillDesigner.run(prompt, existingContent, config);
}

/** @inheritDoc GenerationAgent.createRunner */
export async function createSkillDesignerRunner(
  config: RunnerConfig
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  return skillDesigner.createRunner(config);
}
