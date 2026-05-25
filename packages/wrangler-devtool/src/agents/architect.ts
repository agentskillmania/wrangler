// packages/wrangler-devtool/src/agents/architect.ts
// Agent Architect — generates or modifies agent definitions

import { runGenerationWithLoop, createGenerationRunner } from './orchestrator.js';
import type { AgentOutput, AgentRunOptions } from './types.js';
import type { RunnerConfig } from './orchestrator.js';
import type { EnhancedRunner } from '@agentskillmania/wrangler';
import type { AgentState } from '@agentskillmania/colts';

/**
 * Run the Agent Architect to generate or modify an agent definition.
 */
export async function runAgentArchitect(
  prompt: string,
  existingContent: string | undefined,
  config: RunnerConfig & AgentRunOptions
): Promise<AgentOutput> {
  const result = await runGenerationWithLoop(
    'architect',
    prompt,
    { llmClient: config.llmClient, workspacePath: config.workspacePath, model: config.model },
    existingContent,
    config
  );
  return result.output;
}

/**
 * Create an architect runner for streaming usage.
 */
export async function createArchitectRunner(
  config: RunnerConfig
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  return createGenerationRunner('architect', config);
}
