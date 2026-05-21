// packages/wrangler-devtool/src/agents/reviewer.ts
// Code Reviewer — LLM-based qualitative review (read-only)

import { createLLMClient } from '../llm.js';
import { requireLLMConfig } from '../config.js';
import { runReviewAgent } from './orchestrator.js';
import type { ReviewReport, AgentOptions } from './types.js';

/**
 * Run the Code Reviewer on a target file's content.
 */
export async function runReviewer(
  targetPath: string,
  content: string,
  prompt?: string,
  options?: AgentOptions
): Promise<ReviewReport> {
  const config = await requireLLMConfig();
  const client = createLLMClient(config);
  const model = options?.model ?? config.model;

  const reviewPrompt = `Review the following wrangler definition file (${targetPath}):\n\n\`\`\`markdown\n${content}\n\`\`\`\n${prompt ? `\nAdditional focus: ${prompt}` : ''}`;

  return runReviewAgent(client, model, reviewPrompt, options);
}
