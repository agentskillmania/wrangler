// packages/wrangler-devtool/src/agents/session-curator.ts
// Session Curator — session management helpers

import { createLLMClient } from '../llm.js';
import { requireLLMConfig } from '../config.js';
import { runAgent } from './orchestrator.js';
import type { AgentOutput, AgentOptions } from './types.js';

/**
 * Run the Session Curator for session-related operations.
 *
 * Currently a thin wrapper around the orchestrator. Future phases may
 * expand this with specialized session analysis capabilities.
 */
export async function runSessionCurator(
  prompt: string,
  existingContent?: string,
  options?: AgentOptions
): Promise<AgentOutput> {
  const config = await requireLLMConfig();
  const client = createLLMClient(config);
  const model = options?.model ?? config.model;
  return runAgent(client, model, 'session-curator', prompt, existingContent, options);
}
