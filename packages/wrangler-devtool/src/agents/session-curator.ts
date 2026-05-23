// packages/wrangler-devtool/src/agents/session-curator.ts
// Session Curator — conversation summarizer

import { createLLMClient } from '../llm.js';
import { requireLLMConfig } from '../config.js';
import { runSessionCuratorAgent } from './orchestrator.js';
import type { SessionSummary, AgentOptions } from './types.js';

/**
 * Run the Session Curator to summarize conversation text.
 *
 * Takes any text (conversation transcript, dialogue, etc.) and returns
 * a concise title and description.
 */
export async function runSessionCurator(
  text: string,
  options?: AgentOptions
): Promise<SessionSummary> {
  const config = await requireLLMConfig();
  const client = createLLMClient(config);
  const model = options?.model ?? config.model;
  return runSessionCuratorAgent(client, model, text, options);
}
