// packages/wrangler-devtool/src/agents/crew-composer.ts
// Crew Composer — generates or modifies crew definitions

import { runGenerationWithLoop, createGenerationRunner } from './orchestrator.js';
import type { AgentOutput, AgentRunOptions } from './types.js';
import type { RunnerConfig } from './orchestrator.js';
import type { EnhancedRunner } from '@agentskillmania/wrangler';
import type { AgentState } from '@agentskillmania/colts';

/**
 * Run the Crew Composer to generate or modify a crew definition.
 */
export async function runCrewComposer(
  prompt: string,
  existingContent: string | undefined,
  config: RunnerConfig & AgentRunOptions
): Promise<AgentOutput> {
  const result = await runGenerationWithLoop(
    'crew-composer',
    prompt,
    { llmClient: config.llmClient, workspacePath: config.workspacePath, model: config.model },
    existingContent,
    config
  );
  return result.output;
}

/**
 * Create a crew composer runner for streaming usage.
 */
export async function createCrewComposerRunner(
  config: RunnerConfig
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  return createGenerationRunner('crew-composer', config);
}
