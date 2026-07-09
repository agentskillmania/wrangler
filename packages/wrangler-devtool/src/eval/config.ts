/**
 * @fileoverview LLM configuration for the judge evaluator.
 *
 * The judge uses a separate LLM config from the agent being evaluated, so you
 * can judge a cheap model's output with a stronger model. Config is read from
 * the project's wrangler.yaml (or global config) — same format wrangler uses.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { LLMQuickInit } from '@agentskillmania/colts';

/** Result of loading judge LLM config. */
export interface EvalLlmConfig {
  /** LLM provider config (same shape as wrangler's llm field). */
  llm: LLMQuickInit;
}

/**
 * Search for an LLM config in standard locations:
 *   1. projectDir/wrangler.yaml
 *   2. projectDir/eval-config.yaml
 *   3. ~/.agentskillmania/wrangler/config.yaml (global)
 *
 * The first file with an `llm.providers` section wins.
 */
export async function loadEvalLlmConfig(projectDir?: string): Promise<EvalLlmConfig> {
  const searchPaths: string[] = [];
  if (projectDir) {
    searchPaths.push(join(projectDir, 'wrangler.yaml'));
    searchPaths.push(join(projectDir, 'eval-config.yaml'));
  }
  searchPaths.push(join(homedir(), '.agentskillmania', 'wrangler', 'config.yaml'));

  const yaml = await import('js-yaml');
  for (const p of searchPaths) {
    try {
      const raw = await readFile(p, 'utf-8');
      const parsed = yaml.load(raw) as Record<string, unknown> | undefined;
      const llm = parsed?.llm as LLMQuickInit | undefined;
      if (llm?.providers?.length) {
        return { llm };
      }
    } catch {
      // File doesn't exist or isn't readable — try next.
    }
  }

  throw new Error(
    'No LLM config found for eval judge. Create wrangler.yaml or eval-config.yaml with an llm.providers section.'
  );
}
