// packages/wrangler-devtool/src/agents/generation-agent.ts
// Shared factory for the three isomorphic generation agents
// (architect, crew-composer, skill-designer).

import type { AgentState } from '@agentskillmania/colts';
import type { EnhancedRunner } from '@agentskillmania/wrangler';

import { runGenerationWithLoop, createGenerationRunner } from './orchestrator.js';
import type { RunnerConfig } from './orchestrator.js';
import type { AgentOutput, AgentRunOptions } from './types.js';

/**
 * The public surface of a generation agent.
 */
export interface GenerationAgent {
  /** Run the agent with the iterative review loop and return its output. */
  run: (
    prompt: string,
    existingContent: string | undefined,
    config: RunnerConfig & AgentRunOptions
  ) => Promise<AgentOutput>;
  /** Create a runner for streaming usage. */
  createRunner: (config: RunnerConfig) => Promise<{ runner: EnhancedRunner; state: AgentState }>;
}

/**
 * Create a generation agent bound to a specific prompt template.
 *
 * The three built-in agents (architect, crew-composer, skill-designer) are
 * identical except for their `promptName`, so this factory captures their
 * shared behavior and each call site only needs to supply the prompt.
 */
export function createGenerationAgent(promptName: string): GenerationAgent {
  return {
    run: async (prompt, existingContent, config) => {
      const result = await runGenerationWithLoop(
        promptName,
        prompt,
        { llmClient: config.llmClient, workspacePath: config.workspacePath, model: config.model },
        existingContent,
        config
      );
      return result.output;
    },
    createRunner: (config) => createGenerationRunner(promptName, config),
  };
}
