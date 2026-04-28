// packages/core/src/create-runner.ts

import { AgentRunner, calculatorTool, createAskHumanTool } from '@agentskillmania/colts';
import type { RunnerOptions, Tool } from '@agentskillmania/colts';
import { resolveLLMConfig } from './llm-config.js';
import type { ResolvedLLMConfig } from './llm-config.js';
import { SessionStore } from './session/session-store.js';
import { createSessionMiddleware } from './middleware/session-middleware.js';
import type { WranglerOptions } from './types.js';

import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ZodTypeAny } from 'zod';

const DEFAULT_SESSION_BASE_DIR = join(homedir(), '.agentskillmania', 'wrangler', 'sessions');

/**
 * Widen Tool<TParams> to Tool<ZodTypeAny>.
 *
 * Tool<TParams> is invariant in TParams because TParams appears in both
 * covariant (parameters) and contravariant (execute args via z.infer)
 * positions. TypeScript cannot determine assignability, so it rejects
 * Tool<ZodObject<...>> → Tool<ZodTypeAny> despite being safe at runtime
 * (Zod validates parameters before execute() is called).
 */
function widenTool<T extends ZodTypeAny>(tool: Tool<T>): Tool<ZodTypeAny> {
  return tool as unknown as Tool<ZodTypeAny>;
}

/**
 * Creates a configured AgentRunner.
 *
 * Factory function returning a bare AgentRunner instance.
 * Automatically injects session middleware and built-in tools.
 *
 * @param options - Configuration options
 * @returns Configured AgentRunner
 * @throws When LLM configuration is invalid
 */
export function createRunner(options: WranglerOptions): AgentRunner {
  const llmConfig: ResolvedLLMConfig = resolveLLMConfig(options.llm);

  const builtinTools: Tool<ZodTypeAny>[] = [widenTool(calculatorTool)];
  if (options.askHumanHandler) {
    builtinTools.push(widenTool(createAskHumanTool(options.askHumanHandler)));
  }

  const sessionBaseDir = options.sessionBaseDir ?? DEFAULT_SESSION_BASE_DIR;
  const store = new SessionStore(sessionBaseDir, options.workspacePath);
  const sessionMw = createSessionMiddleware(store, options.model);

  const runnerOptions: RunnerOptions = {
    model: options.model,
    ...llmConfig,
    tools: builtinTools,
    systemPrompt: options.systemPrompt,
    requestTimeout: options.requestTimeout,
    maxSteps: options.maxSteps,
    compressor: options.compression,
    skillProvider: options.skillProvider,
    skillDirectories: options.skillDirectories,
    subAgents: options.subAgents,
    thinkingEnabled: options.thinkingEnabled,
    middleware: [sessionMw],
  };

  return new AgentRunner(runnerOptions);
}
