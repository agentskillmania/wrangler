// packages/wrangler-devtool/src/agents/crew-composer.ts
// Crew Composer — generates or modifies crew definitions

import type { AgentState } from '@agentskillmania/colts';
import type { EnhancedRunner } from '@agentskillmania/wrangler';

import { createGenerationAgent } from './generation-agent.js';
import type { RunnerConfig } from './orchestrator.js';
import type { AgentOutput, AgentRunOptions } from './types.js';

const crewComposer = createGenerationAgent('crew-composer');

/** @inheritDoc GenerationAgent.run */
export async function runCrewComposer(
  prompt: string,
  existingContent: string | undefined,
  config: RunnerConfig & AgentRunOptions
): Promise<AgentOutput> {
  return crewComposer.run(prompt, existingContent, config);
}

/** @inheritDoc GenerationAgent.createRunner */
export async function createCrewComposerRunner(
  config: RunnerConfig
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  return crewComposer.createRunner(config);
}
