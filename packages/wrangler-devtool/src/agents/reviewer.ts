// packages/wrangler-devtool/src/agents/reviewer.ts
// Code Reviewer — LLM-based qualitative review (read-only)

import type { AgentState } from '@agentskillmania/colts';
import type { EnhancedRunner } from '@agentskillmania/wrangler';

import { runReview, createReviewRunner } from './orchestrator.js';
import type { RunnerConfig } from './orchestrator.js';
import type { ReviewReport, AgentRunOptions } from './types.js';

/**
 * Run the Code Reviewer on a target file's content.
 */
export async function runReviewer(
  targetPath: string,
  content: string,
  prompt: string | undefined,
  config: RunnerConfig & AgentRunOptions
): Promise<ReviewReport> {
  const reviewContent = `Review the following wrangler definition file (${targetPath}):\n\n\`\`\`markdown\n${content}\n\`\`\`\n${prompt ? `\nAdditional focus: ${prompt}` : ''}`;
  return runReview(reviewContent, {
    llmClient: config.llmClient,
    workspacePath: config.workspacePath,
    model: config.model,
  });
}

/**
 * Create a reviewer runner for streaming usage.
 */
export async function createReviewerRunner(
  config: RunnerConfig
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  return createReviewRunner(config);
}
