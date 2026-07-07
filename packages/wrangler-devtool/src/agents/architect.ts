// packages/wrangler-devtool/src/agents/architect.ts
// Agent Architect — generates or modifies agent definitions

import type { AgentState } from '@agentskillmania/colts';
import type { EnhancedRunner } from '@agentskillmania/wrangler';

import { createGenerationAgent } from './generation-agent.js';
import type { RunnerConfig } from './orchestrator.js';
import type { AgentOutput, AgentRunOptions } from './types.js';

const architect = createGenerationAgent('architect');

/** @inheritDoc GenerationAgent.run */
export async function runAgentArchitect(
  prompt: string,
  existingContent: string | undefined,
  config: RunnerConfig & AgentRunOptions
): Promise<AgentOutput> {
  return architect.run(prompt, existingContent, config);
}

/** @inheritDoc GenerationAgent.createRunner */
export async function createArchitectRunner(
  config: RunnerConfig
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  return architect.createRunner(config);
}
