// packages/wrangler-devtool/src/agents/session-curator.ts
// Session Curator — conversation summarizer

import { runCurator, createCuratorRunner } from './orchestrator.js';
import type { SessionSummary, AgentRunOptions } from './types.js';
import type { RunnerConfig } from './orchestrator.js';
import type { EnhancedRunner } from '@agentskillmania/wrangler';
import type { AgentState } from '@agentskillmania/colts';

/**
 * Run the Session Curator to summarize conversation text.
 */
export async function runSessionCurator(
  text: string,
  config: RunnerConfig & AgentRunOptions
): Promise<SessionSummary> {
  return runCurator(text, {
    llmClient: config.llmClient,
    workspacePath: config.workspacePath,
    model: config.model,
  });
}

/**
 * Create a curator runner for streaming usage.
 */
export async function createCuratorRunnerWrapper(
  config: RunnerConfig
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  return createCuratorRunner(config);
}
